import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text } = body;

    if (!text) {
      return NextResponse.json({ error: 'Text field is required' }, { status: 400 });
    }

    // 1. Insert a new row with status 'RECEIVED'
    const { data: insertData, error: insertError } = await supabaseServer
      .from('posts')
      .insert({
        raw_spark_text: text,
        status: 'RECEIVED'
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      return NextResponse.json({ error: 'Failed to record incoming webhook' }, { status: 500 });
    }

    const postId = insertData.id;

    // 2. Immediately update status to 'PROCESSING'
    const { error: updateError } = await supabaseServer
      .from('posts')
      .update({ status: 'PROCESSING' })
      .eq('id', postId);

    if (updateError) {
      console.error('Database update to PROCESSING error:', updateError);
      // We can still continue since the record is created.
    }

    // 3. Resolve the API host to call the generation route asynchronously
    const host = request.headers.get('host') || 'localhost:2121';
    const protocol = host.includes('localhost') ? 'http' : 'https';
    const generateUrl = `${protocol}://${host}/api/generate`;

    // Use Next.js native after() to run the background generation job.
    // This allows the server to send the response immediately and run the work after the connection closes.
    after(async () => {
      try {
        console.log(`[Webhook] Asynchronously triggering generation for post ${postId}...`);
        const response = await fetch(generateUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ postId, raw_spark_text: text }),
        });
        
        if (!response.ok) {
          const errText = await response.text();
          console.error(`[Webhook] Async generation trigger failed with status ${response.status}: ${errText}`);
        } else {
          console.log(`[Webhook] Async generation triggered successfully for post ${postId}`);
        }
      } catch (err) {
        console.error('[Webhook] Async fetch trigger failed:', err);
      }
    });

    return NextResponse.json({
      success: true,
      message: 'Webhook received. Processing started.',
      postId,
      status: 'PROCESSING'
    });
  } catch (error: any) {
    console.error('[Webhook Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
