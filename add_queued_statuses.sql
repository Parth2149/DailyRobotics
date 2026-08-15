-- Run this script in the Supabase SQL Editor (https://database.supabase.com)
-- to add the new queued statuses to the post_status enum.

-- 1. Add new enum values if they don't exist
ALTER TYPE post_status ADD VALUE IF NOT EXISTS 'QUEUED_X';
ALTER TYPE post_status ADD VALUE IF NOT EXISTS 'QUEUED_REDDIT';
