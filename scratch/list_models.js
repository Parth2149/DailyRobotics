// Standalone script to query the Google Gemini API models endpoint using the user's API Key.
// Usage: node list_models.js

async function main() {
  const apiKey = 'AQ.Ab8RN6LnCadTvkZlc5-4IvQ2DnH6W421dF6noI1kFw2rKPTA0Q';
  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  console.log('Fetching available models from Google API...');
  try {
    const res = await fetch(url);
    if (!res.ok) {
      const errText = await res.text();
      console.error(`HTTP Error ${res.status}: ${errText}`);
      return;
    }
    const data = await res.json();
    console.log('Success! List of available models:');
    if (data.models) {
      data.models.forEach(model => {
        console.log(`- Name: ${model.name} (Supports: ${model.supportedGenerationMethods.join(', ')})`);
      });
    } else {
      console.log('No models returned. Response payload:', data);
    }
  } catch (err) {
    console.error('Network error calling API:', err);
  }
}

main();
