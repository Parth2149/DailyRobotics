import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

// GET: Fetch real-time counts and all posts with status 'READY'
export async function GET() {
  try {
    // Run parallel count queries for stats
    const [receivedCount, processingCount, readyCount] = await Promise.all([
      supabaseServer
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'RECEIVED'),
      supabaseServer
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'PROCESSING'),
      supabaseServer
        .from('posts')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'READY'),
    ]);

    const stats = {
      received: receivedCount.count || 0,
      processing: processingCount.count || 0,
      ready: readyCount.count || 0,
    };

    // Fetch the list of ready posts to render in the feed
    const { data: posts, error: postsError } = await supabaseServer
      .from('posts')
      .select('*')
      .eq('status', 'READY')
      .order('created_at', { ascending: false });

    if (postsError) {
      console.error('[Posts API] Error fetching ready posts:', postsError);
      return NextResponse.json({ error: 'Failed to fetch ready posts' }, { status: 500 });
    }

    // Fetch the list of published posts to render in the history feed
    const { data: published, error: publishedError } = await supabaseServer
      .from('posts')
      .select('*')
      .in('status', ['POSTED_REDDIT', 'POSTED_X', 'POSTED_BOTH'])
      .order('created_at', { ascending: false });

    if (publishedError) {
      console.error('[Posts API] Error fetching published posts:', publishedError);
      return NextResponse.json({ error: 'Failed to fetch published posts' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      stats,
      posts: posts || [],
      published: published || [],
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
    const { searchParams } = new URL(request.url);
    const postId = searchParams.get('postId');
    const status = searchParams.get('status');

    if (!postId && !status) {
      return NextResponse.json({ error: 'postId or status is required' }, { status: 400 });
    }

    let query = supabaseServer.from('posts').delete();

    if (postId) {
      console.log(`[Posts API] Deleting/rejecting post ${postId}...`);
      query = query.eq('id', postId);
    } else if (status) {
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
