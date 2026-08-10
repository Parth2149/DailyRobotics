// Test script to simulate an incoming Spark webhook to the Next.js server.
// Usage: node test_api.js
// Make sure the server is running (npm run dev) before executing this script.

const http = require('http');

const payload = JSON.stringify({
  text: "Daily Robotics Update:\n1. Google DeepMind releases a new agentic coding assistant called Antigravity. Read more at [Wikipedia](https://en.wikipedia.org/wiki/Robotics).\n2. Agile Robotics announces a $150M Series B round to scale production of their bipedal warehouse robot."
});

const options = {
  hostname: 'localhost',
  port: 2121,
  path: '/api/webhook/spark',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload)
  }
};

console.log('Sending webhook request to http://localhost:2121/api/webhook/spark...');
const req = http.request(options, (res) => {
  let data = '';
  res.on('data', (chunk) => {
    data += chunk;
  });
  
  res.on('end', () => {
    console.log('Response Status:', res.statusCode);
    console.log('Response Body:', data);
    try {
      const json = JSON.parse(data);
      if (json.success) {
        console.log('\nSUCCESS! Webhook request accepted.');
        console.log('Post ID created:', json.postId);
        console.log('Status is:', json.status);
        console.log('\nChecking background processing...');
        console.log('Please refresh the dashboard at http://localhost:2121 to see the result!');
      } else {
        console.log('\nFAILURE:', json.error || 'Unknown error');
      }
    } catch (e) {
      console.log('\nError parsing response:', e.message);
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
  console.log('Make sure the Next.js server is running by executing: npm run dev');
});

req.write(payload);
req.end();
