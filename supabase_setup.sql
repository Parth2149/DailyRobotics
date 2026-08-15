-- Supabase Database Setup for Android ADB Twitter Automator
-- Run this script in the Supabase SQL Editor (https://database.supabase.com)

-- 1. Create the pending_tweets table
CREATE TABLE IF NOT EXISTS pending_tweets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. Create index on status for faster polling
CREATE INDEX IF NOT EXISTS idx_pending_tweets_status ON pending_tweets(status);
CREATE INDEX IF NOT EXISTS idx_pending_tweets_created_at ON pending_tweets(created_at DESC);

-- 3. Enable Row Level Security (RLS)
ALTER TABLE pending_tweets ENABLE ROW LEVEL SECURITY;

-- 4. Create policy to allow all reads (required for Python poller and Next.js UI)
CREATE POLICY "Allow read access to all users" 
ON pending_tweets FOR SELECT 
TO anon, authenticated, service_role
USING (true);

-- 5. Create policy to allow insert access (required for Next.js form)
CREATE POLICY "Allow inserts for all users" 
ON pending_tweets FOR INSERT 
TO anon, authenticated, service_role
WITH CHECK (true);

-- 6. Create policy to allow updates (required for Python controller to set status to 'posted')
CREATE POLICY "Allow updates for all users" 
ON pending_tweets FOR UPDATE 
TO anon, authenticated, service_role
USING (true)
WITH CHECK (true);

-- 7. Enable Realtime subscription updates for client UI tracking
ALTER PUBLICATION supabase_realtime ADD TABLE pending_tweets;
