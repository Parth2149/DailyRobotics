import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

// Increased timeout limit for Vercel Serverless Functions during Reddit API submissions
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { postId } = body;

    if (!postId) {
      return NextResponse.json({ error: 'postId is required' }, { status: 400 });
    }

    // 1. Fetch current status of post
    const { data: post, error: fetchError } = await supabaseServer
      .from('posts')
      .select('status')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      console.error('[Reddit API] Database fetch error:', fetchError);
      return NextResponse.json({ error: 'Post not found in database' }, { status: 404 });
    }

    const { status } = post;

    // 2. Transition status:
    // READY -> POSTED_REDDIT
    // POSTED_X -> POSTED_BOTH
    let newStatus: 'POSTED_REDDIT' | 'POSTED_BOTH' = 'POSTED_REDDIT';
    if (status === 'POSTED_X' || status === 'POSTED_BOTH') {
      newStatus = 'POSTED_BOTH';
    }

    console.log(`[Reddit API] Transitioning post ${postId} status to ${newStatus}...`);
    const { error: updateError } = await supabaseServer
      .from('posts')
      .update({ status: newStatus })
      .eq('id', postId);

    if (updateError) {
      console.error('[Reddit API] Database update error:', updateError);
      return NextResponse.json({ error: 'Failed to update post status in database' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      status: newStatus,
      message: 'Reddit publication status updated successfully.',
    });
  } catch (error: any) {
    console.error('[Reddit API Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
