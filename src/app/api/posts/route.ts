import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

// GET: Fetch real-time counts and all posts with status 'READY'
export async function GET() {
  try {
    // Auto-cleanup: delete RECEIVED posts older than 24 hours so old digests
    // never accumulate in the inbox. Runs silently — errors don't block the response.
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { error: cleanupError, count: cleanupCount } = await supabaseServer
      .from('posts')
      .delete({ count: 'exact' })
      .eq('status', 'RECEIVED')
      .lt('created_at', cutoff);
    if (cleanupError) {
      console.warn('[Posts API] Auto-cleanup error (non-fatal):', cleanupError.message);
    } else if (cleanupCount && cleanupCount > 0) {
      console.log(`[Posts API] Auto-cleaned ${cleanupCount} stale RECEIVED post(s) older than 24h.`);
    }

    // Run all 6 DB queries in parallel for maximum performance
    const [
      receivedResult,
      processingResult,
      readyResult,
      inboxResult,
      postsResult,
      publishedResult,
    ] = await Promise.all([
      supabaseServer.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'RECEIVED'),
      supabaseServer.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'PROCESSING'),
      supabaseServer.from('posts').select('*', { count: 'exact', head: true }).eq('status', 'READY'),
      supabaseServer.from('posts').select('*').eq('status', 'RECEIVED').order('created_at', { ascending: false }),
      supabaseServer.from('posts').select('*').eq('status', 'READY').order('created_at', { ascending: false }),
      supabaseServer.from('posts').select('*').in('status', ['POSTED_REDDIT', 'POSTED_X', 'POSTED_BOTH']).order('created_at', { ascending: false }),
    ]);

    const stats = {
      received: receivedResult.count || 0,
      processing: processingResult.count || 0,
      ready: readyResult.count || 0,
    };

    if (inboxResult.error) {
      console.error('[Posts API] Error fetching inbox posts:', inboxResult.error);
      return NextResponse.json({ error: 'Failed to fetch inbox posts' }, { status: 500 });
    }
    if (postsResult.error) {
      console.error('[Posts API] Error fetching ready posts:', postsResult.error);
      return NextResponse.json({ error: 'Failed to fetch ready posts' }, { status: 500 });
    }
    if (publishedResult.error) {
      console.error('[Posts API] Error fetching published posts:', publishedResult.error);
      return NextResponse.json({ error: 'Failed to fetch published posts' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      stats,
      inbox: inboxResult.data || [],
      posts: postsResult.data || [],
      published: publishedResult.data || [],
      subreddit: process.env.REDDIT_SUBREDDIT || 'test',
    });
  } catch (error: any) {
    console.error('[Posts API GET Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}


// PUT: Save manual edits to a post's text fields
export async function PUT(request: Request) {
  try {
    const body = await request.json();
    const { postId, x_post_text, reddit_post_text } = body;

    if (!postId) {
      return NextResponse.json({ error: 'postId is required' }, { status: 400 });
    }

    if (x_post_text === undefined && reddit_post_text === undefined) {
      return NextResponse.json({ error: 'No editable fields provided for update' }, { status: 400 });
    }

    console.log(`[Posts API] Saving edits for post ${postId}...`);

    // Build dynamic update object
    const updateData: Record<string, any> = {};
    if (x_post_text !== undefined) updateData.x_post_text = x_post_text;
    if (reddit_post_text !== undefined) updateData.reddit_post_text = reddit_post_text;

    const { error: updateError } = await supabaseServer
      .from('posts')
      .update(updateData)
      .eq('id', postId);

    if (updateError) {
      console.error('[Posts API] Error updating post:', updateError);
      return NextResponse.json({ error: 'Failed to update post in database' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Post edits saved successfully.',
    });
  } catch (error: any) {
    console.error('[Posts API PUT Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}

// DELETE: Reject/Stop and delete a post from the database
export async function DELETE(request: Request) {
  try {
    let postId = '';
    let status = '';

    // Check if the client sent parameters in a JSON body (like our page.tsx inbox delete button)
    const contentType = request.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        const body = await request.json();
        postId = (body.postId || '').trim();
        status = (body.status || '').trim();
      } catch {
        // Fall back to query params if JSON parsing fails
      }
    }

    // Fall back to query parameters (like our page.tsx manual stop/reject buttons)
    if (!postId && !status) {
      const { searchParams } = new URL(request.url);
      postId = (searchParams.get('postId') || '').trim();
      status = (searchParams.get('status') || '').trim();
    }

    // Require at least one non-empty filter to prevent accidental full-table deletion
    if (!postId && !status) {
      return NextResponse.json({ error: 'postId or status is required' }, { status: 400 });
    }

    let query = supabaseServer.from('posts').delete();

    if (postId) {
      console.log(`[Posts API] Deleting/rejecting post ${postId}...`);
      query = query.eq('id', postId);
    } else if (status) {
      // Only allow whitelisted statuses to be bulk-deleted to prevent accidents
      const allowedBulkStatuses = ['PROCESSING', 'RECEIVED'];
      if (!allowedBulkStatuses.includes(status)) {
        return NextResponse.json({ error: `Bulk deletion of status '${status}' is not allowed` }, { status: 400 });
      }
      console.log(`[Posts API] Deleting all posts with status ${status}...`);
      query = query.eq('status', status);
    }

    const { error: deleteError } = await query;


    if (deleteError) {
      console.error('[Posts API] Error deleting posts:', deleteError);
      return NextResponse.json({ error: 'Failed to delete posts from database' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      message: 'Posts rejected and deleted successfully.',
    });
  } catch (error: any) {
    console.error('[Posts API DELETE Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
