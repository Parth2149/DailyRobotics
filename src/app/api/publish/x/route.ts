import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { postId, queueOnly } = body;

    if (!postId) {
      return NextResponse.json({ error: 'postId is required' }, { status: 400 });
    }

    // 1. Fetch current post status
    const { data: post, error: fetchError } = await supabaseServer
      .from('posts')
      .select('status')
      .eq('id', postId)
      .single();

    if (fetchError || !post) {
      console.error('[X API] Database fetch error:', fetchError);
      return NextResponse.json({ error: 'Post not found in database' }, { status: 404 });
    }

    const { status } = post;

    // 2. Determine new status:
    // If queueOnly, set to QUEUED_X so local ADB poller processes it.
    // Otherwise: READY -> POSTED_X, POSTED_REDDIT -> POSTED_BOTH
    let newStatus: string = 'POSTED_X';
    if (queueOnly) {
      newStatus = 'QUEUED_X';
    } else {
      if (status === 'POSTED_REDDIT' || status === 'POSTED_BOTH' || status === 'QUEUED_REDDIT') {
        newStatus = 'POSTED_BOTH';
      }
    }

    console.log(`[X API] Updating database record ${postId} status to ${newStatus}...`);
    const { error: updateError } = await supabaseServer
      .from('posts')
      .update({ status: newStatus })
      .eq('id', postId);

    if (updateError) {
      console.error('[X API] Database update error:', updateError);
      return NextResponse.json({ error: 'Failed to update post status in database' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      status: newStatus,
      message: queueOnly ? 'Queued for Android ADB posting.' : 'Successfully updated status to indicate X publication.',
    });
  } catch (error: any) {
    console.error('[X API Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
