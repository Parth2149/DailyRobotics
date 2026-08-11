'use client';

import { useEffect, useState } from 'react';
import { supabaseClient } from '@/lib/supabase';
import { 
  Inbox, 
  Loader2, 
  CheckCircle2, 
  Save, 
  ArrowRight, 
  Sparkles, 
  Database,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Copy,
  Download,
  AlertCircle,
  X as CloseIcon,
  Play,
  Trash2,
  Ban
} from 'lucide-react';

const RedditIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M24 11.5c0-1.65-1.35-3-3-3-.96 0-1.86.48-2.42 1.24-1.64-1-3.75-1.64-5.99-1.72l1.2-3.8 3.9.8c.03.88.75 1.58 1.63 1.58 1.1 0 2-1 2-2s-1-2-2-2c-.84 0-1.55.53-1.85 1.28l-4.32-1.02c-.15-.03-.3.02-.38.13-.09.11-.11.26-.06.4l1.37 4.34c-2.31.06-4.5.7-6.19 1.73-.55-.72-1.44-1.18-2.43-1.18-1.65 0-3 1.35-3 3 0 1.1.6 2.05 1.5 2.58-.03.25-.05.5-.05.77 0 3.75 4.37 6.8 9.75 6.8s9.75-3.05 9.75-6.8c0-.26-.02-.51-.05-.75.87-.54 1.47-1.48 1.47-2.56zM6 14.5c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9.75 4.62c-1.66 1.66-4.84 1.66-6.5 0-.15-.15-.15-.39 0-.54.15-.15.39-.15.54 0 1.36 1.36 4.06 1.36 5.42 0 .15-.15.39-.15.54 0 .15.15.15.39 0 .54zm-.25-2.62c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
  </svg>
);

const XIcon = (props: React.SVGProps<SVGSVGElement>) => (
  <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
  </svg>
);

// Client-side parser to extract a specific post from the multi-section daily email digest
function extractPostFromDigest(rawText: string, sectionName: string, postNumber: number): string | null {
  if (!rawText) return null;

  // Split the text into sections
  const sections = ['Latest News & Major Developments', 'Open-Source Frameworks & Development Tools', 'Career Opportunities & Hiring Trends'];
  
  // Find where our target section starts
  const sectionIndex = rawText.toLowerCase().indexOf(sectionName.toLowerCase());
  if (sectionIndex === -1) return null;

  // Find where the next section starts to bound our search
  let nextSectionIndex = rawText.length;
  sections.forEach((s) => {
    if (s.toLowerCase() !== sectionName.toLowerCase()) {
      const idx = rawText.toLowerCase().indexOf(s.toLowerCase(), sectionIndex + 1);
      if (idx !== -1 && idx < nextSectionIndex) {
        nextSectionIndex = idx;
      }
    }
  });

  // Extract the text block of our section
  const sectionBlock = rawText.slice(sectionIndex + sectionName.length, nextSectionIndex).trim();

  // Split the section block into lines/bullet points
  const lines = sectionBlock.split('\n');
  const bulletPoints: string[] = [];

  let currentPoint = '';

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Check if the line starts a new bullet point (starts with -, *, •, or digit+dot)
    const isNewBullet = /^[•\-\*]\s+/.test(line) || /^\d+\.\s+/.test(line);

    if (isNewBullet) {
      if (currentPoint) {
        bulletPoints.push(currentPoint.trim());
      }
      currentPoint = line.replace(/^[•\-\*]\s+/, '').replace(/^\d+\.\s+/, '');
    } else {
      if (currentPoint) {
        currentPoint += ' ' + line;
      } else {
        currentPoint = line;
      }
    }
  }

  if (currentPoint) {
    bulletPoints.push(currentPoint.trim());
  }

  // Return the selected post number (1-indexed)
  if (postNumber <= bulletPoints.length) {
    return bulletPoints[postNumber - 1];
  }

  return null;
}

interface Post {
  id: string;
  raw_spark_text: string;
  x_post_text: string;
  reddit_post_text: string;
  image_url: string;
  status: 'RECEIVED' | 'PROCESSING' | 'READY' | 'POSTED_REDDIT' | 'POSTED_X' | 'POSTED_BOTH';
  created_at: string;
}

interface Stats {
  received: number;
  processing: number;
  ready: number;
}

const SAMPLE_NEWS = `Daily Robotics Digest:
1. Unitree launches the new G1 humanoid robot starting at $16,000, capable of deep-learning locomotion and high-speed manipulation.
2. Boston Dynamics officially retires the hydraulic Atlas robot, unveiling a fully electric Atlas humanoid with 360-degree joint movements.
3. Sanctuary AI announces a deep integration partnership with Microsoft Azure to build the next generation of large physical models (LPMs) for their Phoenix robot.
4. Tesla Optimus begins autonomous battery cell sorting trials in the Austin Gigafactory, running on end-to-end neural network controls.`;

export default function Dashboard() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [publishedPosts, setPublishedPosts] = useState<Post[]>([]);
  const [inboxPosts, setInboxPosts] = useState<Post[]>([]);
  const [stats, setStats] = useState<Stats>({ received: 0, processing: 0, ready: 0 });
  const [loading, setLoading] = useState(true);
  const [simulating, setSimulating] = useState(false);
  const [simText, setSimText] = useState('');
  const [showSimulator, setShowSimulator] = useState(false);
  const [numPostsToSimulate, setNumPostsToSimulate] = useState(1);
  const [subreddit, setSubreddit] = useState('test');
  
  // Card-specific UI states
  const [expandedRaw, setExpandedRaw] = useState<Record<string, boolean>>({});
  const [editedX, setEditedX] = useState<Record<string, string>>({});
  const [editedReddit, setEditedReddit] = useState<Record<string, string>>({});
  const [savingPost, setSavingPost] = useState<Record<string, boolean>>({});
  const [publishingReddit, setPublishingReddit] = useState<Record<string, boolean>>({});
  const [publishingX, setPublishingX] = useState<Record<string, boolean>>({});
  const [rejectingPost, setRejectingPost] = useState<Record<string, boolean>>({});
  
  // Quick Digest Extractor states
  const [extractSection, setExtractSection] = useState('Latest News & Major Developments');
  const [extractPostNum, setExtractPostNum] = useState(1);
  const [fullDigestText, setFullDigestText] = useState('');
  
  // Web Share fallback modal state (supports both X and Reddit direct sharing)
  const [fallbackModal, setFallbackModal] = useState<{
    show: boolean;
    platform: 'X' | 'Reddit' | null;
    text: string;
    imageUrl: string;
    postId: string;
  }>({ show: false, platform: null, text: '', imageUrl: '', postId: '' });

  // 1. Fetch initial statistics and ready posts
  const loadDashboardData = async () => {
    try {
      const response = await fetch('/api/posts');
      if (response.ok) {
        const data = await response.json();
        setStats(data.stats);
        setPosts(data.posts || []);
        setPublishedPosts(data.published || []);
        setInboxPosts(data.inbox || []);
        setSubreddit(data.subreddit || 'test');
        
        // Initialize editable states for all posts (both ready and published)
        const xTexts: Record<string, string> = {};
        const redditTexts: Record<string, string> = {};
        const allPosts = [...(data.posts || []), ...(data.published || [])];
        allPosts.forEach((post: Post) => {
          xTexts[post.id] = post.x_post_text || '';
          redditTexts[post.id] = post.reddit_post_text || '';
        });
        setEditedX(prev => ({ ...xTexts, ...prev }));
        setEditedReddit(prev => ({ ...redditTexts, ...prev }));
      }
    } catch (err) {
      console.error('Error fetching dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadDashboardData();

    // 2. Set up Supabase Realtime subscription
    // Automatically triggers a UI refresh whenever any change happens to the posts table
    if (!supabaseClient) {
      console.warn('[Realtime] Supabase client is not initialized. Environment variables may be missing.');
      return;
    }

    const channel = supabaseClient
      .channel('realtime-posts')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'posts' },
        (payload: any) => {
          console.log('[Realtime] Database change detected:', payload);
          loadDashboardData();
        }
      )
      .subscribe();

    return () => {
      if (supabaseClient) {
        supabaseClient.removeChannel(channel);
      }
    };
  }, []);

  // 3. Handle manual text edits save
  const handleSaveEdits = async (postId: string) => {
    setSavingPost(prev => ({ ...prev, [postId]: true }));
    try {
      const response = await fetch('/api/posts', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          postId,
          x_post_text: editedX[postId],
          reddit_post_text: editedReddit[postId]
        })
      });
      if (response.ok) {
        // Stats and lists will be refreshed via Realtime, but let's confirm locally too
        console.log('Edits saved successfully');
      } else {
        alert('Failed to save edits');
      }
    } catch (err) {
      console.error('Error saving edits:', err);
    } finally {
      setSavingPost(prev => ({ ...prev, [postId]: false }));
    }
  };

  // 3.5 Handle rejecting/deleting a post (Stop button)
  const handleRejectPost = async (postId: string) => {
    const confirmed = window.confirm('Are you sure you want to stop/reject this post? It will be deleted permanently.');
    if (!confirmed) return;

    setRejectingPost(prev => ({ ...prev, [postId]: true }));
    try {
      const response = await fetch(`/api/posts?postId=${postId}`, {
        method: 'DELETE',
      });
      if (response.ok) {
        console.log('Post deleted successfully');
      } else {
        const errData = await response.json();
        alert(`Failed to delete post: ${errData.error || 'Unknown error'}`);
      }
    } catch (err) {
      console.error('Error rejecting post:', err);
      alert('Error connecting to deletion API');
    } finally {
      setRejectingPost(prev => ({ ...prev, [postId]: false }));
    }
  };

  // 3.7 Stop/Cancel all In-Progress/Processing posts
  const handleStopAllProcessing = async () => {
    const confirmed = window.confirm('Are you sure you want to stop and clear all tasks that are currently "In Process"?');
    if (!confirmed) return;
    
    try {
      const response = await fetch('/api/posts?status=PROCESSING', {
        method: 'DELETE',
      });
      if (response.ok) {
        console.log('In-progress posts cleared successfully');
        // Refresh dashboard immediately
        loadDashboardData();
      } else {
        alert('Failed to clear in-progress posts');
      }
    } catch (err) {
      console.error('Error stopping in-progress posts:', err);
      alert('Error connecting to deletion API');
    }
  };

  // 3.8 Load an Inbox post into the Webhook Simulator
  const handleLoadIntoSimulator = async (post: Post) => {
    setSimText(post.raw_spark_text);
    setFullDigestText(post.raw_spark_text);
    setShowSimulator(true);
    
    // Silently delete the inbox post from the database
    try {
      await fetch(`/api/posts?postId=${post.id}`, {
        method: 'DELETE',
      });
      loadDashboardData();
    } catch (err) {
      console.error('Error removing inbox post:', err);
    }
  };

  // 3.9 Extract a specific post from the raw email digest text currently in the simulator
  const handleExtractPost = () => {
    const sourceText = fullDigestText || simText;
    if (!sourceText) {
      alert('Please paste the daily digest email text into the simulator text box first!');
      return;
    }
    const extracted = extractPostFromDigest(sourceText, extractSection, extractPostNum);
    if (extracted) {
      // Preserve full text in cache if they extract from raw input directly
      if (!fullDigestText) {
        setFullDigestText(simText);
      }
      setSimText(extracted);
      console.log(`[Extractor] Extracted post ${extractPostNum} from "${extractSection}" successfully.`);
    } else {
      alert(`Could not find Post ${extractPostNum} inside the "${extractSection}" section of your text. Please verify the section names or bullet points in the text.`);
    }
  };

  // Helper to trigger DB update for Reddit status
  const updateRedditStatusInDb = async (postId: string) => {
    try {
      const response = await fetch('/api/publish/reddit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId })
      });
      if (response.ok) {
        loadDashboardData();
      } else {
        console.error('Failed to update status to POSTED_REDDIT in database');
      }
    } catch (error) {
      console.error('Failed to hit Reddit publish API endpoint:', error);
    }
  };

  // 4. Handle Reddit direct sharing (Clipboard + download image + tab redirect)
  const handlePublishReddit = async (post: Post) => {
    const textToShare = editedReddit[post.id] || post.reddit_post_text;
    setPublishingReddit(prev => ({ ...prev, [post.id]: true }));

    try {
      // A. Copy text to clipboard
      try {
        await navigator.clipboard.writeText(textToShare);
      } catch (clipboardErr) {
        console.error('Clipboard copy failed:', clipboardErr);
      }

      // B. Trigger image download
      const link = document.createElement('a');
      link.href = post.image_url;
      link.download = `robotics-image-${post.id.slice(0, 8)}.png`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // C. Show custom guidance modal
      setFallbackModal({
        show: true,
        platform: 'Reddit',
        text: textToShare,
        imageUrl: post.image_url,
        postId: post.id
      });
    } catch (err: any) {
      console.warn('[Reddit Share] Direct share failed:', err);
    } finally {
      setPublishingReddit(prev => ({ ...prev, [post.id]: false }));
    }
  };

  // 5. Handle X direct sharing (Clipboard + download image + tab redirect)
  const handlePublishX = async (post: Post) => {
    const textToShare = editedX[post.id] || post.x_post_text;
    setPublishingX(prev => ({ ...prev, [post.id]: true }));

    try {
      // A. Copy text to clipboard
      try {
        await navigator.clipboard.writeText(textToShare);
      } catch (clipboardErr) {
        console.error('Clipboard copy failed:', clipboardErr);
      }

      // B. Trigger image download
      const link = document.createElement('a');
      link.href = post.image_url;
      link.download = `robotics-image-${post.id.slice(0, 8)}.png`;
      link.target = '_blank';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      // C. Show custom guidance modal
      setFallbackModal({
        show: true,
        platform: 'X',
        text: textToShare,
        imageUrl: post.image_url,
        postId: post.id
      });
    } catch (err: any) {
      console.warn('[X Share] Direct share failed:', err);
    } finally {
      setPublishingX(prev => ({ ...prev, [post.id]: false }));
    }
  };

  // Helper to trigger DB update for X status
  const updateXStatusInDb = async (postId: string) => {
    try {
      const response = await fetch('/api/publish/x', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ postId })
      });
      if (response.ok) {
        loadDashboardData();
      } else {
        console.error('Failed to update status to POSTED_X in database');
      }
    } catch (error) {
      console.error('Failed to hit X publish API endpoint:', error);
    }
  };

  // 6. Webhook simulator execution
  const triggerWebhookSimulation = async () => {
    setSimulating(true);
    try {
      for (let i = 0; i < numPostsToSimulate; i++) {
        // Appending unique identifier to simulated post
        let customText = simText;
        if (numPostsToSimulate > 1) {
          customText = `${simText}\n\n[Variation #${i + 1} - Ref: ${Math.random().toString(36).slice(2, 6).toUpperCase()}]`;
        }
        
        const response = await fetch('/api/webhook/spark', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: customText })
        });
        
        if (!response.ok) {
          console.error(`Simulation call #${i + 1} failed`);
        }
      }
      
      setShowSimulator(false);
      loadDashboardData();
    } catch (err) {
      console.error('Error simulating webhook:', err);
      alert('Network error during webhook simulation');
    } finally {
      setSimulating(false);
    }
  };

  // Character counter configuration for X
  const getXCharCount = (text: string) => text ? text.length : 0;
  const isXCountOverLimit = (text: string) => getXCharCount(text) > 280;

  const isConfigMissing = !process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (isConfigMissing) {
    return (
      <div className="w-full min-h-screen flex flex-col items-center justify-center p-6 text-center bg-slate-950">
        <div className="w-full max-w-md p-6 glass-panel rounded-3xl border border-rose-500/20 shadow-2xl shadow-rose-500/5 flex flex-col gap-6">
          <div className="w-12 h-12 rounded-full bg-slate-900 border border-rose-500/20 text-rose-500 flex items-center justify-center mx-auto mb-1 animate-pulse">
            <AlertCircle className="w-6 h-6" />
          </div>
          <div className="flex flex-col gap-2">
            <h1 className="text-lg font-bold font-outfit text-white">Vercel Configuration Required</h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Your application has been deployed successfully to Vercel, but some environment variables are missing.
            </p>
          </div>
          <div className="flex flex-col gap-3 text-left bg-slate-950/60 p-4 rounded-2xl border border-slate-900 font-mono text-[11px] text-slate-300">
            <p className="font-bold text-rose-400 mb-1">Missing Keys:</p>
            {!process.env.NEXT_PUBLIC_SUPABASE_URL && <p>• NEXT_PUBLIC_SUPABASE_URL</p>}
            {!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && <p>• NEXT_PUBLIC_SUPABASE_ANON_KEY</p>}
            {!process.env.SUPABASE_SERVICE_ROLE_KEY && <p>• SUPABASE_SERVICE_ROLE_KEY (Server Key)</p>}
            {!process.env.GEMINI_API_KEY && <p>• GEMINI_API_KEY (AI Copywriter)</p>}
          </div>
          <div className="flex flex-col gap-2 text-xs text-slate-400 leading-relaxed">
            <p>
              Please go to your <strong>Vercel Project Dashboard</strong> &rarr; <strong>Settings</strong> &rarr; <strong>Environment Variables</strong>, add these variables, and create a new deployment.
            </p>
          </div>
          <a
            href="https://vercel.com"
            target="_blank"
            rel="noopener noreferrer"
            className="py-2.5 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all"
          >
            Go to Vercel Dashboard
            <ExternalLink className="w-3.5 h-3.5" />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen pb-16 flex flex-col items-center">
      {/* 1. Header Area */}
      <header className="w-full max-w-md px-4 pt-6 pb-2 flex flex-col gap-1 items-center text-center">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-brand-cyan to-brand-blue flex items-center justify-center shadow-lg shadow-brand-cyan/20">
            <Sparkles className="w-5 h-5 text-white" />
          </div>
          <span className="font-extrabold text-xl tracking-wider bg-gradient-to-r from-brand-cyan to-brand-blue bg-clip-text text-transparent font-outfit">
            DAILY ROBOTICS
          </span>
        </div>
        <p className="text-xs text-slate-400 font-medium tracking-tight mt-1">
          Human-in-the-Loop Publishing Dashboard
        </p>
      </header>

      {/* 2. Top Statistics Bar */}
      <section className="w-full max-w-md px-4 mt-4">
        <div className="grid grid-cols-3 gap-3 p-3 glass-panel rounded-2xl glow-border-cyan">
          <div className="flex flex-col items-center justify-center p-2 text-center border-r border-slate-800/60">
            <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center mb-1 text-slate-400">
              <Inbox className="w-4 h-4 text-cyan-400" />
            </div>
            <span className="text-lg font-bold font-outfit text-white leading-none">{stats.received}</span>
            <span className="text-[10px] font-semibold text-slate-400 mt-1 uppercase tracking-wider">Inbox</span>
          </div>

          <div className="flex flex-col items-center justify-center p-2 text-center border-r border-slate-800/60 relative group/stats">
            <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center mb-1 text-slate-400">
              <Loader2 className={`w-4 h-4 text-amber-400 ${stats.processing > 0 ? 'animate-spin' : ''}`} />
            </div>
            <span className="text-lg font-bold font-outfit text-white leading-none">{stats.processing}</span>
            <span className="text-[10px] font-semibold text-slate-400 mt-1 uppercase tracking-wider">In Process</span>
            {stats.processing > 0 && (
              <button
                onClick={handleStopAllProcessing}
                className="mt-1.5 text-[9px] font-bold text-rose-400 hover:text-rose-300 underline underline-offset-2 flex items-center gap-1 cursor-pointer transition-colors"
                title="Stop and cancel all in-progress tasks"
              >
                <Ban className="w-2.5 h-2.5 animate-pulse" /> Stop Tasks
              </button>
            )}
          </div>

          <div className="flex flex-col items-center justify-center p-2 text-center">
            <div className="w-8 h-8 rounded-full bg-slate-900 flex items-center justify-center mb-1 text-slate-400">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
            </div>
            <span className="text-lg font-bold font-outfit text-white leading-none">{stats.ready}</span>
            <span className="text-[10px] font-semibold text-slate-400 mt-1 uppercase tracking-wider">Ready</span>
          </div>
        </div>
      </section>

      {/* Webhook Simulator Trigger */}
      <div className="w-full max-w-md px-4 mt-3">
        <button
          onClick={() => setShowSimulator(!showSimulator)}
          className="w-full py-2.5 px-4 rounded-xl glass-panel border border-slate-800 text-xs font-semibold text-cyan-400 flex items-center justify-center gap-2 hover:bg-slate-900/60 transition-all"
        >
          <Database className="w-4 h-4" />
          {showSimulator ? 'Close Webhook Simulator' : 'Open Webhook Simulator'}
        </button>

        {showSimulator && (
          <div className="mt-2 p-4 rounded-xl glass-panel border border-slate-800 flex flex-col gap-3 animate-fadeIn">
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Simulate Spark Webhook Payload</label>
              <textarea
                value={simText}
                onChange={(e) => {
                  setSimText(e.target.value);
                  setFullDigestText(e.target.value); // Sync full text cache on manual paste
                }}
                placeholder="Paste your daily Gemini Spark digest here..."
                className="w-full h-32 p-3 text-xs bg-slate-950 border border-slate-800 rounded-lg text-slate-300 focus:outline-none focus:border-brand-cyan transition-colors resize-none font-mono"
              />
            </div>

            {/* Quick Extractor options */}
            <div className="p-3 bg-slate-950/60 rounded-xl border border-slate-900 flex flex-col gap-2.5">
              <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase text-brand-cyan tracking-wider">
                <Sparkles className="w-3.5 h-3.5 text-brand-cyan animate-pulse" />
                Quick Extract from Digest
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-semibold text-slate-400">Select Part (Section)</span>
                  <select
                    value={extractSection}
                    onChange={(e) => setExtractSection(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-850 text-[10px] text-slate-300 px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-brand-cyan cursor-pointer"
                  >
                    <option value="Latest News & Major Developments">1. News & Major Devs</option>
                    <option value="Open-Source Frameworks & Development Tools">2. Open-Source Tools</option>
                    <option value="Career Opportunities & Hiring Trends">3. Careers & Hiring</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-semibold text-slate-400">Select Post #</span>
                  <select
                    value={extractPostNum}
                    onChange={(e) => setExtractPostNum(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-850 text-[10px] text-slate-300 px-2.5 py-1.5 rounded-lg focus:outline-none focus:border-brand-cyan cursor-pointer"
                  >
                    <option value={1}>Post 1</option>
                    <option value={2}>Post 2</option>
                    <option value={3}>Post 3</option>
                    <option value={4}>Post 4</option>
                    <option value={5}>Post 5</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExtractPost}
                  className="flex-1 py-1.5 px-3 rounded-lg bg-brand-cyan/10 hover:bg-brand-cyan/20 border border-brand-cyan/20 text-[10px] font-bold text-brand-cyan text-center transition-all cursor-pointer"
                >
                  Extract Selected News & Load Into Payload
                </button>
                {fullDigestText && simText !== fullDigestText && (
                  <button
                    type="button"
                    onClick={() => setSimText(fullDigestText)}
                    className="py-1.5 px-3 rounded-lg border border-slate-800 hover:border-slate-700 text-[10px] font-semibold text-slate-400 text-center transition-all cursor-pointer bg-slate-900/40"
                    title="Restore full email text"
                  >
                    Reset Full Text
                  </button>
                )}
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 bg-slate-950/60 p-2.5 rounded-xl border border-slate-900/80">
              <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider">Posts to Generate</span>
              <select
                value={numPostsToSimulate}
                onChange={(e) => setNumPostsToSimulate(Number(e.target.value))}
                className="bg-slate-950 border border-slate-850 text-xs text-slate-200 px-3 py-1.5 rounded-lg focus:outline-none focus:border-brand-cyan cursor-pointer"
              >
                <option value={1}>1 Post</option>
                <option value={2}>2 Posts</option>
                <option value={3}>3 Posts</option>
                <option value={5}>5 Posts</option>
              </select>
            </div>

            <button
              onClick={triggerWebhookSimulation}
              disabled={simulating || !simText}
              className="w-full py-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-cyan-500/10 disabled:opacity-50"
            >
              {simulating ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Generating Social Copies...
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5" />
                  Send Simulated Webhook
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* 2.5 Incoming Spark Inbox */}
      {inboxPosts.length > 0 && (
        <section className="w-full max-w-md px-4 mt-6">
          <h2 className="text-xs font-bold uppercase text-brand-cyan tracking-widest flex items-center gap-2 mb-3">
            <span>Incoming Spark Inbox</span>
            <span className="w-2.5 h-2.5 rounded-full bg-brand-cyan animate-pulse"></span>
          </h2>
          <div className="flex flex-col gap-3">
            {inboxPosts.map((post) => (
              <div key={post.id} className="p-4 glass-panel rounded-2xl border border-brand-cyan/20 flex flex-col gap-3 transition-all hover:border-brand-cyan/40">
                <div className="flex items-center justify-between text-[10px] text-slate-500 font-medium">
                  <span>Received via Email</span>
                  <span>
                    {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>
                <p className="text-xs text-slate-300 line-clamp-3 leading-relaxed font-mono">
                  {post.raw_spark_text}
                </p>
                <button
                  onClick={() => handleLoadIntoSimulator(post)}
                  className="mt-1 py-2 w-full rounded-xl bg-brand-cyan/10 hover:bg-brand-cyan/20 text-brand-cyan text-xs font-bold flex items-center justify-center gap-1.5 transition-all border border-brand-cyan/20 cursor-pointer"
                >
                  <Database className="w-3.5 h-3.5" />
                  Load into Webhook Simulator
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 3. Ready Posts List / Feed */}
      <main className="w-full max-w-md px-4 mt-6 flex flex-col gap-6">
        <h2 className="text-sm font-bold uppercase text-slate-400 tracking-widest flex items-center gap-2">
          <span>Review Feed</span>
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        </h2>

        {loading ? (
          <div className="w-full py-16 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
            <span className="text-xs text-slate-400 font-semibold uppercase tracking-wider">Loading Posts...</span>
          </div>
        ) : posts.length === 0 ? (
          <div className="w-full py-16 px-6 glass-panel rounded-3xl border border-slate-900 text-center flex flex-col items-center justify-center gap-4">
            <div className="w-12 h-12 rounded-full bg-slate-900 flex items-center justify-center text-slate-500 border border-slate-800/80">
              <CheckCircle2 className="w-6 h-6 text-slate-600" />
            </div>
            <div className="flex flex-col gap-1">
              <span className="text-sm font-bold text-white font-outfit">Inbox clean</span>
              <p className="text-xs text-slate-400 leading-relaxed max-w-xs">
                No articles are currently waiting in the ready queue. Try using the Webhook Simulator above to generate one!
              </p>
            </div>
          </div>
        ) : (
          posts.map((post) => {
            const xText = editedX[post.id] !== undefined ? editedX[post.id] : post.x_post_text;
            const redditText = editedReddit[post.id] !== undefined ? editedReddit[post.id] : post.reddit_post_text;
            const isRawExpanded = expandedRaw[post.id] || false;
            const isSaving = savingPost[post.id] || false;
            const isPublishingR = publishingReddit[post.id] || false;
            const isPublishingXField = publishingX[post.id] || false;

            const charCount = getXCharCount(xText);
            const isOverLimit = isXCountOverLimit(xText);

            return (
              <div 
                key={post.id} 
                className="w-full p-4 glass-panel rounded-3xl glow-border-blue flex flex-col gap-4 relative overflow-hidden transition-all duration-300 hover:scale-[1.005] group"
              >
                {/* Visual Glow Layer */}
                <div className="absolute -top-12 -right-12 w-24 h-24 bg-blue-500/5 rounded-full blur-2xl group-hover:bg-blue-500/10 transition-all duration-300"></div>

                {/* Post Header with ID / Timestamp */}
                <div className="flex items-center justify-between border-b border-slate-800/60 pb-3">
                  <span className="text-[10px] font-bold font-mono text-slate-400 tracking-wider bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                    ID: {post.id.slice(0, 8)}
                  </span>
                  <span className="text-[10px] text-slate-500 font-medium">
                    {new Date(post.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {/* Generated Image Preview */}
                <div className="w-full aspect-video rounded-2xl overflow-hidden bg-slate-950 border border-slate-800 relative group/img">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img 
                    src={post.image_url} 
                    alt="AI Generated Visual" 
                    className="w-full h-full object-cover transition-transform duration-700 group-hover/img:scale-105"
                    loading="lazy"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-slate-950/80 via-transparent to-transparent flex items-end p-3">
                    <span className="text-[10px] font-bold text-cyan-400 uppercase tracking-widest bg-slate-950/80 px-2.5 py-1 rounded-full border border-cyan-500/20 backdrop-blur-sm">
                      Generated Visual
                    </span>
                  </div>
                </div>

                {/* Expandable Raw Spark News Area */}
                <div className="w-full border border-slate-800/80 rounded-xl overflow-hidden bg-slate-900/30">
                  <button
                    onClick={() => setExpandedRaw(prev => ({ ...prev, [post.id]: !isRawExpanded }))}
                    className="w-full py-2 px-3 flex items-center justify-between text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                  >
                    <span className="flex items-center gap-1.5">
                      <Database className="w-3.5 h-3.5 text-slate-500" />
                      View Raw Webhook Source
                    </span>
                    {isRawExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                  {isRawExpanded && (
                    <div className="p-3 border-t border-slate-800 text-xs text-slate-300 leading-relaxed font-mono whitespace-pre-wrap select-all bg-slate-950/40">
                      {post.raw_spark_text}
                    </div>
                  )}
                </div>

                {/* EDITABLE FIELDS */}
                <div className="flex flex-col gap-4">
                  {/* X / Twitter Textarea */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                        <XIcon className="w-3.5 h-3.5 text-sky-400" />
                        X Content (Twitter)
                      </span>
                      <span className={`text-[10px] font-bold font-mono px-1.5 py-0.5 rounded ${isOverLimit ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-900 text-slate-400'}`}>
                        {charCount} / 280
                      </span>
                    </div>
                    <textarea
                      value={xText}
                      onChange={(e) => setEditedX(prev => ({ ...prev, [post.id]: e.target.value }))}
                      className={`w-full h-24 p-3 text-xs bg-slate-950 border ${isOverLimit ? 'border-rose-500/50 focus:border-rose-500' : 'border-slate-800 focus:border-brand-cyan'} rounded-xl text-slate-200 focus:outline-none transition-colors resize-none leading-relaxed`}
                    />
                    {isOverLimit && (
                      <p className="text-[10px] font-semibold text-rose-400 mt-0.5">
                        ⚠️ Warning: Exceeds X's 280-character limit. Please shorten it to publish.
                      </p>
                    )}
                  </div>

                  {/* Reddit Textarea */}
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-slate-400 flex items-center gap-1">
                        <RedditIcon className="w-3.5 h-3.5 text-orange-500" />
                        Reddit Markdown Body
                      </span>
                    </div>
                    <textarea
                      value={redditText}
                      onChange={(e) => setEditedReddit(prev => ({ ...prev, [post.id]: e.target.value }))}
                      className="w-full h-40 p-3 text-xs bg-slate-950 border border-slate-800 rounded-xl text-slate-200 focus:outline-none focus:border-brand-blue transition-colors resize-none leading-relaxed font-mono"
                    />
                  </div>
                </div>

                {/* CARD ACTIONS */}
                <div className="flex flex-col gap-2 pt-2 border-t border-slate-800/60">
                  {/* Save & Stop Buttons Grid */}
                  <div className="grid grid-cols-2 gap-2">
                    {/* Save Button */}
                    <button
                      onClick={() => handleSaveEdits(post.id)}
                      disabled={isSaving}
                      className="py-2 px-3 rounded-xl border border-slate-800 text-xs font-bold text-white hover:text-cyan-400 hover:border-cyan-500/30 flex items-center justify-center gap-1.5 hover:bg-slate-900/60 transition-all disabled:opacity-50"
                    >
                      {isSaving ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5 text-cyan-400" />
                          Save Edits
                        </>
                      )}
                    </button>

                    {/* Stop / Reject Button */}
                    <button
                      onClick={() => handleRejectPost(post.id)}
                      disabled={rejectingPost[post.id]}
                      className="py-2 px-3 rounded-xl border border-rose-500/20 text-xs font-bold text-rose-400 hover:text-rose-300 hover:border-rose-500/40 flex items-center justify-center gap-1.5 hover:bg-rose-950/20 transition-all disabled:opacity-50"
                    >
                      {rejectingPost[post.id] ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-rose-400" />
                          Stopping...
                        </>
                      ) : (
                        <>
                          <Trash2 className="w-3.5 h-3.5 text-rose-500" />
                          Stop / Reject
                        </>
                      )}
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-2 mt-1">
                    {/* Reddit Publish Button */}
                    <button
                      onClick={() => handlePublishReddit(post)}
                      disabled={isPublishingR}
                      className="py-2.5 px-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-orange-600/10 disabled:opacity-50"
                    >
                      {isPublishingR ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RedditIcon className="w-4 h-4 text-white" />
                      )}
                      Reddit
                    </button>

                    {/* X Publish Button */}
                    <button
                      onClick={() => handlePublishX(post)}
                      disabled={isPublishingXField || isOverLimit}
                      className={`py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-white text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-slate-100/10 ${isOverLimit ? 'opacity-40 cursor-not-allowed' : 'disabled:opacity-50'}`}
                      title={isOverLimit ? 'Cannot publish: text exceeds 280 character limit' : 'Publish to X'}
                    >
                      {isPublishingXField ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-slate-950" />
                      ) : (
                        <XIcon className="w-4 h-4 text-white" />
                      )}
                      Publish X
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </main>

      {/* 3.5. Published History List / Feed */}
      <section className="w-full max-w-md px-4 mt-8 flex flex-col gap-6">
        <div className="border-t border-slate-900 pt-6">
          <h2 className="text-sm font-bold uppercase text-slate-500 tracking-widest flex items-center gap-2 mb-4">
            <span>Published History</span>
            <span className="w-2 h-2 rounded-full bg-brand-blue"></span>
          </h2>

          {publishedPosts.length === 0 ? (
            <div className="w-full py-8 px-6 glass-panel rounded-3xl border border-slate-900/60 text-center flex flex-col items-center justify-center gap-2">
              <span className="text-xs text-slate-500 font-semibold font-outfit">No published history yet</span>
              <p className="text-[10px] text-slate-400 max-w-xs leading-normal">
                Once you publish updates to X or Reddit, they will appear in this archive feed.
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-6">
              {publishedPosts.map((post) => {
                const xText = editedX[post.id] !== undefined ? editedX[post.id] : post.x_post_text;
                const redditText = editedReddit[post.id] !== undefined ? editedReddit[post.id] : post.reddit_post_text;
                const isSaving = savingPost[post.id] || false;
                const isPublishingR = publishingReddit[post.id] || false;
                const isPublishingXField = publishingX[post.id] || false;

                const charCount = getXCharCount(xText);
                const isOverLimit = isXCountOverLimit(xText);

                // Determine platform publish status badges
                const postedToX = post.status === 'POSTED_X' || post.status === 'POSTED_BOTH';
                const postedToReddit = post.status === 'POSTED_REDDIT' || post.status === 'POSTED_BOTH';

                return (
                  <div key={post.id} className="w-full glass-panel rounded-3xl border border-slate-900/80 p-5 flex flex-col gap-4 hover:border-slate-800/80 transition-all group shadow-lg">
                    {/* Header: Date + Badges */}
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-mono text-slate-400">
                        {new Date(post.created_at).toLocaleDateString(undefined, {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit'
                        })}
                      </span>
                      <div className="flex gap-1.5">
                        {postedToX && (
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-slate-900 border border-slate-800 font-bold text-slate-300">
                            Posted X
                          </span>
                        )}
                        {postedToReddit && (
                          <span className="text-[9px] px-2 py-0.5 rounded-full bg-orange-950/20 border border-orange-500/20 font-bold text-orange-400">
                            Posted Reddit
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Image thumbnail */}
                    {post.image_url && (
                      <div className="relative w-full aspect-video rounded-2xl overflow-hidden border border-slate-900 shadow-inner bg-slate-950">
                        <img 
                          src={post.image_url} 
                          alt="Robotics Update" 
                          className="w-full h-full object-cover group-hover:scale-[1.02] transition-transform duration-500"
                        />
                      </div>
                    )}

                    {/* Main content drafts */}
                    <div className="flex flex-col gap-3">
                      {/* X Post Input */}
                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                            <XIcon className="w-3.5 h-3.5 text-white" /> X (Twitter) draft
                          </span>
                          <span className={`text-[9px] font-bold font-mono px-1.5 py-0.5 rounded ${isOverLimit ? 'bg-rose-500/20 text-rose-400' : 'bg-slate-900 text-slate-400'}`}>
                            {charCount} / 280
                          </span>
                        </div>
                        <textarea
                          value={xText}
                          onChange={(e) => setEditedX(prev => ({ ...prev, [post.id]: e.target.value }))}
                          className={`w-full h-20 p-2.5 text-[11px] bg-slate-950 border ${isOverLimit ? 'border-rose-500/50 focus:border-rose-500' : 'border-slate-800 focus:border-brand-cyan'} rounded-xl text-slate-300 focus:outline-none transition-colors resize-none leading-relaxed`}
                        />
                        {isOverLimit && (
                          <p className="text-[9px] font-semibold text-rose-400 mt-0.5">
                            ⚠️ Warning: Exceeds X's 280-character limit. Please shorten it to publish.
                          </p>
                        )}
                      </div>

                      {/* Reddit Post Input */}
                      <div className="flex flex-col gap-1.5">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1">
                          <RedditIcon className="w-3.5 h-3.5 text-orange-500" /> Reddit Markdown body
                        </span>
                        <textarea
                          value={redditText}
                          onChange={(e) => setEditedReddit(prev => ({ ...prev, [post.id]: e.target.value }))}
                          className="w-full h-24 p-2.5 text-[11px] bg-slate-950 border border-slate-800 rounded-xl text-slate-300 focus:outline-none focus:border-brand-blue transition-colors resize-none leading-relaxed font-mono"
                        />
                      </div>
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-col gap-2 pt-2 border-t border-slate-850">
                      {/* Save & Stop Grid */}
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={() => handleSaveEdits(post.id)}
                          disabled={isSaving}
                          className="py-1.5 px-3 rounded-xl border border-slate-800 text-[10px] font-bold text-slate-300 hover:text-cyan-400 hover:border-cyan-500/30 flex items-center justify-center gap-1.5 hover:bg-slate-900/60 transition-all disabled:opacity-50"
                        >
                          {isSaving ? 'Saving...' : 'Save Edits'}
                        </button>
                        <button
                          onClick={() => handleRejectPost(post.id)}
                          disabled={rejectingPost[post.id]}
                          className="py-1.5 px-3 rounded-xl border border-rose-500/20 text-[10px] font-bold text-rose-400 hover:text-rose-300 hover:border-rose-500/40 flex items-center justify-center gap-1.5 hover:bg-rose-950/20 transition-all disabled:opacity-50"
                        >
                          Delete Permanent
                        </button>
                      </div>

                      {/* Republish Grid */}
                      <div className="grid grid-cols-2 gap-2 mt-0.5">
                        <button
                          onClick={() => handlePublishReddit(post)}
                          disabled={isPublishingR}
                          className="py-2 px-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-orange-650/10 disabled:opacity-50 animate-pulse"
                        >
                          {isPublishingR ? (
                            <Loader2 className="w-3 h-3 animate-spin text-white" />
                          ) : (
                            <RedditIcon className="w-3.5 h-3.5 text-white" />
                          )}
                          Re-Send Reddit
                        </button>
                        <button
                          onClick={() => handlePublishX(post)}
                          disabled={isPublishingXField || isOverLimit}
                          className={`py-2 px-3 rounded-xl bg-slate-100 hover:bg-white text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-all shadow-md shadow-slate-100/10 ${isOverLimit ? 'opacity-40 cursor-not-allowed' : 'disabled:opacity-50'}`}
                          title={isOverLimit ? 'Cannot publish: text exceeds 280 character limit' : 'Re-Send to X'}
                        >
                          {isPublishingXField ? (
                            <Loader2 className="w-3 h-3 animate-spin text-slate-950" />
                          ) : (
                            <XIcon className="w-3.5 h-3.5 text-slate-950" />
                          )}
                          Re-Send X
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      {/* 4. Web Share API fallback/direct sharing instruction Modal */}
      {fallbackModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center px-4 bg-slate-950/80 backdrop-blur-md animate-fadeIn">
          <div className="w-full max-w-sm p-6 glass-panel rounded-3xl border border-slate-800 flex flex-col gap-4 text-center relative shadow-2xl shadow-cyan-500/10">
            {/* Close Button */}
            <button 
              onClick={async () => {
                setFallbackModal(prev => ({ ...prev, show: false }));
                if (fallbackModal.platform === 'Reddit') {
                  await updateRedditStatusInDb(fallbackModal.postId);
                } else {
                  await updateXStatusInDb(fallbackModal.postId);
                }
              }}
              className="absolute top-4 right-4 p-1.5 rounded-full hover:bg-slate-900 text-slate-400 hover:text-white transition-colors"
            >
              <CloseIcon className="w-4 h-4" />
            </button>

            <div className="w-12 h-12 rounded-full bg-slate-900 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto mb-1 animate-pulse">
              <AlertCircle className="w-6 h-6" />
            </div>

            <div className="flex flex-col gap-1">
              <h3 className="text-md font-bold font-outfit text-white">
                {fallbackModal.platform === 'Reddit' ? 'Reddit Share Assistant' : 'X Share Assistant'}
              </h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                Direct sharing has prepared the following manual steps to post this item:
              </p>
            </div>

            {/* Checklist */}
            <div className="flex flex-col gap-2.5 text-left bg-slate-950/40 p-3.5 rounded-2xl border border-slate-900">
              <div className="flex gap-2.5 items-start">
                <div className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                  <CheckCircle2 className="w-3 h-3" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-slate-200">Text Copied</span>
                  <span className="text-[10px] text-slate-400 leading-normal text-wrap">
                    {fallbackModal.platform === 'Reddit'
                      ? 'Reddit markdown body has been copied to your clipboard.'
                      : 'X draft summary has been copied to your clipboard.'}
                  </span>
                </div>
              </div>

              <div className="flex gap-2.5 items-start">
                <div className="w-5 h-5 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 flex items-center justify-center shrink-0 mt-0.5">
                  <Download className="w-3 h-3" />
                </div>
                <div className="flex flex-col">
                  <span className="text-[11px] font-bold text-slate-200">Image Downloaded</span>
                  <span className="text-[10px] text-slate-400 leading-normal text-wrap">
                    The robotics image file has been downloaded to your device for easy upload.
                  </span>
                </div>
              </div>
            </div>

            {/* Action Call */}
            {fallbackModal.platform === 'Reddit' ? (
              <a
                href={`https://www.reddit.com/r/${subreddit}/submit?title=${encodeURIComponent('Daily Robotics Digest')}`}
                target="_blank"
                rel="noopener noreferrer"
                onClick={async () => {
                  setFallbackModal(prev => ({ ...prev, show: false }));
                  await updateRedditStatusInDb(fallbackModal.postId);
                }}
                className="py-2.5 bg-gradient-to-r from-orange-500 to-red-650 hover:from-orange-400 hover:to-red-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-orange-500/15"
              >
                Open Subreddit r/{subreddit}
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            ) : (
              <a
                href="https://x.com/intent/post"
                target="_blank"
                rel="noopener noreferrer"
                onClick={async () => {
                  setFallbackModal(prev => ({ ...prev, show: false }));
                  await updateXStatusInDb(fallbackModal.postId);
                }}
                className="py-2.5 bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-all shadow-md shadow-sky-500/15"
              >
                Open X (Twitter)
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}

            <button
              onClick={async () => {
                setFallbackModal(prev => ({ ...prev, show: false }));
                if (fallbackModal.platform === 'Reddit') {
                  await updateRedditStatusInDb(fallbackModal.postId);
                } else {
                  await updateXStatusInDb(fallbackModal.postId);
                }
              }}
              className="text-[10px] text-slate-400 hover:text-white font-semibold underline underline-offset-4"
            >
              Done, update post status to posted
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
