import { NextResponse } from 'next/server';
import { after } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { text, autoProcess } = body;

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

    // If autoProcess is true, trigger the generation immediately
    if (autoProcess) {
      const { error: updateError } = await supabaseServer
        .from('posts')
        .update({ status: 'PROCESSING' })
        .eq('id', postId);

      if (updateError) {
        console.error('Database update to PROCESSING error:', updateError);
      }

      const host = request.headers.get('host') || 'localhost:2121';
      const protocol = host.includes('localhost') ? 'http' : 'https';
      const generateUrl = `${protocol}://${host}/api/generate`;

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

      console.log(`[Webhook] Spark text recorded. Triggered automatic processing for post ${postId}`);
      return NextResponse.json({
        success: true,
        message: 'Webhook received. Processing started.',
        postId,
        status: 'PROCESSING'
      });
    }

    console.log(`[Webhook] Incoming Spark text recorded in Inbox (RECEIVED) for post ${postId}`);
    return NextResponse.json({
      success: true,
      message: 'Incoming Spark text recorded in Inbox.',
      postId,
      status: 'RECEIVED'
    });
  } catch (error: any) {
    console.error('[Webhook Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
