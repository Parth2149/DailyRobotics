import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl) {
  console.warn('Warning: NEXT_PUBLIC_SUPABASE_URL is not set.');
}

// 1. Public client - safe to use on client-side (uses Anon Key)
// Used for subscribing to Realtime channels or public select operations
export const supabaseClient = supabaseUrl && supabaseAnonKey
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null as any;

// 2. Private client - STRICTLY SERVER-SIDE ONLY (uses Service Role Key)
// Bypasses Row Level Security (RLS) to run administrative tasks in API routes
export const supabaseServer = supabaseUrl && supabaseServiceKey
  ? createClient(supabaseUrl, supabaseServiceKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null as any;
