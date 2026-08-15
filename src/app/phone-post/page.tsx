'use client';

import { useEffect, useState } from 'react';
import { supabaseClient } from '@/lib/supabase';
import { 
  Smartphone, 
  Send, 
  CheckCircle2, 
  Clock, 
  Loader2, 
  ArrowLeft,
  Sparkles
} from 'lucide-react';
import Link from 'next/link';

interface Tweet {
  id: string;
  content: string;
  status: 'pending' | 'posted';
  created_at: string;
}

export default function PhonePostPage() {
  const [content, setContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [tweets, setTweets] = useState<Tweet[]>([]);
  const [fetching, setFetching] = useState(true);

  // Load existing tweets and subscribe to realtime updates
  useEffect(() => {
    fetchTweets();

    if (!supabaseClient) return;

    // Realtime listener to update UI instantly when Python script completes a post
    const channel = supabaseClient
      .channel('pending-tweets-channel')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'pending_tweets' },
        () => {
          fetchTweets();
        }
      )
      .subscribe();

    return () => {
      supabaseClient.removeChannel(channel);
    };
  }, []);

  const fetchTweets = async () => {
    try {
      if (!supabaseClient) return;
      const { data, error } = await supabaseClient
        .from('pending_tweets')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(15);
      
      if (error) throw error;
      setTweets(data || []);
    } catch (err) {
      console.error('Error fetching tweets:', err);
    } finally {
      setFetching(false);
    }
  };

  const handleSendToPhone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!content.trim()) return;

    setLoading(true);
    try {
      if (!supabaseClient) {
        alert('Supabase client is not configured!');
        return;
      }

      const { error } = await supabaseClient
        .from('pending_tweets')
        .insert([{ content: content.trim(), status: 'pending' }]);

      if (error) throw error;
      
      setContent('');
      alert('🚀 Tweet sent to the phone queue! Make sure your local Python ADB script is running.');
    } catch (err: any) {
      alert(`Error sending tweet: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  const charLimit = 280;
  const remainingChars = charLimit - content.length;
  const isOverLimit = remainingChars < 0;

  return (
    <div className="min-h-screen bg-[#060913] text-slate-100 font-sans antialiased pb-12">
      {/* Sleek Grid Overlay */}
      <div className="fixed inset-0 pointer-events-none z-0 opacity-[0.03] bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:24px_24px]"></div>
      
      {/* Glow Backdrops */}
      <div className="fixed -top-40 -left-40 w-96 h-96 bg-cyan-500/10 rounded-full blur-[120px] pointer-events-none z-0"></div>
      <div className="fixed top-1/2 -right-40 w-96 h-96 bg-indigo-500/10 rounded-full blur-[120px] pointer-events-none z-0"></div>

      <header className="relative z-10 max-w-4xl mx-auto px-4 pt-8 pb-4 flex items-center justify-between border-b border-slate-900/80">
        <Link 
          href="/" 
          className="text-xs font-bold text-slate-400 hover:text-cyan-400 transition-colors flex items-center gap-1.5 uppercase tracking-widest cursor-pointer"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Dashboard
        </Link>
        <div className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full bg-cyan-500 animate-pulse"></span>
          <span className="text-[10px] uppercase tracking-widest text-cyan-400 font-bold font-mono">ADB Link Mode</span>
        </div>
      </header>

      <main className="relative z-10 max-w-2xl mx-auto px-4 mt-8 flex flex-col gap-8">
        
        {/* Intro Banner */}
        <div className="p-6 glass-panel rounded-3xl border border-cyan-500/20 bg-slate-950/40 relative overflow-hidden group">
          <div className="absolute -top-12 -right-12 w-24 h-24 bg-cyan-500/10 rounded-full blur-2xl group-hover:bg-cyan-500/20 transition-all duration-300"></div>
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
              <Smartphone className="w-6 h-6 animate-bounce" />
            </div>
            <div className="flex flex-col gap-1.5">
              <h1 className="text-xl font-extrabold text-white font-outfit tracking-tight flex items-center gap-2">
                Android ADB Twitter Automator
              </h1>
              <p className="text-xs text-slate-400 leading-relaxed max-w-md">
                Compose a tweet below. Clicking send will queue it in Supabase, prompting your local Python ADB controller to wake your Android device and auto-publish it via deep link.
              </p>
            </div>
          </div>
        </div>

        {/* Compose Form */}
        <form onSubmit={handleSendToPhone} className="p-6 glass-panel rounded-3xl border border-slate-900 bg-slate-950/20 flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-cyan-400" />
              Compose Tweet Text
            </label>
            <textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="What is happening? Type the tweet to push to your phone..."
              rows={4}
              maxLength={400}
              className="w-full p-4 rounded-2xl bg-slate-950 border border-slate-900 focus:border-cyan-500/30 focus:outline-none focus:ring-1 focus:ring-cyan-500/20 text-sm leading-relaxed text-slate-100 placeholder-slate-600 transition-all font-sans resize-none"
            />
          </div>

          <div className="flex items-center justify-between border-t border-slate-900/60 pt-3">
            <span className={`text-xs font-bold font-mono px-2 py-0.5 rounded ${isOverLimit ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-900/80 text-slate-500'}`}>
              {remainingChars} chars left
            </span>
            
            <button
              type="submit"
              disabled={loading || !content.trim() || isOverLimit}
              className="px-5 py-2.5 bg-gradient-to-r from-cyan-500 to-indigo-600 hover:from-cyan-400 hover:to-indigo-500 disabled:from-slate-900 disabled:to-slate-900 text-white disabled:text-slate-600 rounded-xl text-xs font-bold uppercase tracking-wider transition-all flex items-center gap-2 border border-cyan-400/20 disabled:border-slate-800 cursor-pointer shadow-lg hover:shadow-cyan-500/10 active:scale-95"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Sending...
                </>
              ) : (
                <>
                  <Send className="w-3.5 h-3.5" />
                  Send to Phone
                </>
              )}
            </button>
          </div>
        </form>

        {/* Realtime Queue List */}
        <div className="flex flex-col gap-3">
          <h2 className="text-xs font-bold uppercase text-slate-500 tracking-widest">
            Queue Activity Logs
          </h2>

          {fetching ? (
            <div className="py-12 flex justify-center">
              <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
            </div>
          ) : tweets.length === 0 ? (
            <div className="py-10 text-center border border-slate-900/80 rounded-2xl bg-slate-950/10">
              <p className="text-xs text-slate-500 font-medium">No tweets currently in queue.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-2.5">
              {tweets.map((tweet) => (
                <div 
                  key={tweet.id}
                  className="p-4 rounded-2xl border border-slate-900 bg-slate-950/20 hover:border-slate-800 transition-all flex items-start justify-between gap-4"
                >
                  <div className="flex flex-col gap-1 flex-1">
                    <p className="text-sm text-slate-300 font-sans leading-relaxed whitespace-pre-wrap">
                      {tweet.content}
                    </p>
                    <span className="text-[10px] text-slate-600 font-mono">
                      Queued: {new Date(tweet.created_at).toLocaleString()}
                    </span>
                  </div>
                  
                  <div className="flex items-center gap-1.5 shrink-0">
                    {tweet.status === 'posted' ? (
                      <span className="px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                        <CheckCircle2 className="w-3 h-3" />
                        Posted
                      </span>
                    ) : (
                      <span className="px-2.5 py-1 rounded-full text-[9px] font-bold uppercase tracking-wider bg-amber-500/10 text-amber-400 border border-amber-500/20 flex items-center gap-1">
                        <Clock className="w-3 h-3 animate-pulse" />
                        Pending
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
