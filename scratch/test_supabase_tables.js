const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Read and parse .env.local
const envPath = path.join(__dirname, '../.env.local');
if (!fs.existsSync(envPath)) {
  console.error('Error: .env.local file not found!');
  process.exit(1);
}

const envContent = fs.readFileSync(envPath, 'utf8');
const envVars = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)\s*$/);
  if (match) {
    let value = match[2].trim();
    // Remove wrapping quotes if any
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    envVars[match[1]] = value;
  }
});

const supabaseUrl = envVars['NEXT_PUBLIC_SUPABASE_URL'];
const supabaseAnonKey = envVars['NEXT_PUBLIC_SUPABASE_ANON_KEY'];
const supabaseServiceKey = envVars['SUPABASE_SERVICE_ROLE_KEY'];

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Error: NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY is not defined in .env.local!');
  process.exit(1);
}

console.log('Supabase Connection Info:');
console.log('URL:', supabaseUrl);
console.log('Anon Key length:', supabaseAnonKey.length);
if (supabaseServiceKey) {
  console.log('Service Role Key length:', supabaseServiceKey.length);
} else {
  console.log('Service Role Key: NOT CONFIGURED');
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function checkTables() {
  console.log('\n--- 1. Testing "posts" table connection ---');
  try {
    const { data, error, count } = await supabase
      .from('posts')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Failed to fetch posts count:', error.message);
    } else {
      console.log('✅ Connection to "posts" table successful!');
      console.log(`📊 Number of rows in "posts": ${count}`);
    }
  } catch (err) {
    console.error('❌ Crash testing "posts" connection:', err.message || err);
  }

  console.log('\n--- 2. Testing "pending_tweets" table connection ---');
  try {
    const { data, error, count } = await supabase
      .from('pending_tweets')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      console.error('❌ Failed to fetch pending_tweets count:', error.message);
      console.log('👉 This usually means the table does not exist yet. Please run the SQL schema in Step 1 in your Supabase SQL Editor.');
    } else {
      console.log('✅ Connection to "pending_tweets" table successful!');
      console.log(`📊 Number of rows in "pending_tweets": ${count}`);
      
      // Let's print the latest 2 entries if any
      const { data: latest, error: fetchErr } = await supabase
        .from('pending_tweets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(2);
        
      if (fetchErr) {
        console.error('❌ Error fetching latest rows:', fetchErr.message);
      } else if (latest && latest.length > 0) {
        console.log('\n🔍 Latest queued entries:');
        latest.forEach(tweet => {
          console.log(`- [${tweet.status.toUpperCase()}] ID: ${tweet.id.slice(0, 8)} | Text: "${tweet.content}" (Created: ${tweet.created_at})`);
        });
      } else {
        console.log('ℹ No rows currently in pending_tweets table.');
      }
    }
  } catch (err) {
    console.error('❌ Crash testing "pending_tweets" connection:', err.message || err);
  }
}

checkTables();
