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

    // 1. Insert a new row with status 'RECEIVED' (Inbox)
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
