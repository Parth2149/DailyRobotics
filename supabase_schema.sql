-- Supabase Database Schema Setup for DailyRobotics
-- Run these commands in the SQL Editor of your Supabase project (https://database.supabase.com)

-- 1. Create the status enum type if it does not exist
CREATE TYPE post_status AS ENUM (
    'RECEIVED', 
    'PROCESSING', 
    'READY', 
    'POSTED_REDDIT', 
    'POSTED_X', 
    'POSTED_BOTH'
);

-- 2. Create the posts table
CREATE TABLE IF NOT EXISTS posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    raw_spark_text TEXT NOT NULL,
    x_post_text TEXT,
    reddit_post_text TEXT,
    image_url TEXT,
    status post_status NOT NULL DEFAULT 'RECEIVED',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. Create indexes to speed up lookups (e.g., dashboard statistics and feed)
CREATE INDEX IF NOT EXISTS idx_posts_status ON posts(status);
CREATE INDEX IF NOT EXISTS idx_posts_created_at ON posts(created_at DESC);

-- 4. Enable Row Level Security (RLS)
-- By default, for simplicity of the backend routes, we can disable RLS or write policies.
-- If you access the database from Vercel Serverless Functions using the Service Role key, 
-- it bypasses RLS. If you use the Anon key, you must enable RLS and add policies.
-- Let's enable RLS and create an access policy.
ALTER TABLE posts ENABLE ROW LEVEL SECURITY;

-- Allow all read access to authenticated/anon users for the dashboard
CREATE POLICY "Allow read access to all users" 
ON posts FOR SELECT 
TO anon, authenticated, service_role
USING (true);

-- Allow all operations to the service_role (used by serverless API routes)
CREATE POLICY "Allow all operations for service_role" 
ON posts FOR ALL 
TO service_role
USING (true)
WITH CHECK (true);

-- 5. Enable Realtime updates for the posts table
-- This allows the mobile dashboard to refresh statistics and lists instantly.
ALTER PUBLICATION supabase_realtime ADD TABLE posts;
