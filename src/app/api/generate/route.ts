import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { supabaseServer } from '@/lib/supabase';

// Increased timeout limit for Vercel Serverless Functions during AI text, image scraping & Gemini Vision selection
export const maxDuration = 120;


// Helper to upload image buffers to Supabase Storage
async function uploadToSupabaseStorage(buffer: Buffer): Promise<string | null> {
  try {
    const bucketName = 'robotics-posts';
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.png`;

    // Try to create the bucket if it doesn't exist (fails silently if already exists or permission denied)
    try {
      await supabaseServer.storage.createBucket(bucketName, {
        public: true,
      });
    } catch {
      // Ignore errors if bucket already exists
    }

    // Upload the file
    const { data, error } = await supabaseServer.storage
      .from(bucketName)
      .upload(fileName, buffer, {
        contentType: 'image/png',
        cacheControl: '31536000', // Cache for 1 year
        upsert: false,
      });

    if (error) {
      console.warn('Supabase storage upload error:', error.message);
      return null;
    }

    // Get the public URL
    const { data: publicUrlData } = supabaseServer.storage
      .from(bucketName)
      .getPublicUrl(fileName);

    return publicUrlData.publicUrl;
  } catch (error) {
    console.warn('Supabase storage upload failed:', error);
    return null;
  }
}

// Main image generation handler
async function generateImage(prompt: string): Promise<string> {
  const stabilityKey = process.env.STABILITY_API_KEY;

  if (stabilityKey) {
    try {
      console.log('[Generate API] Calling Stability AI for image generation...');
      const response = await fetch(
        'https://api.stability.ai/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${stabilityKey}`,
          },
          body: JSON.stringify({
            text_prompts: [{ text: prompt }],
            cfg_scale: 7,
            height: 1024,
            width: 1024,
            samples: 1,
            steps: 30,
          }),
        }
      );

      if (response.ok) {
        const result = await response.json();
        const base64 = result.artifacts[0].base64;
        const buffer = Buffer.from(base64, 'base64');
        const supabaseUrl = await uploadToSupabaseStorage(buffer);
        if (supabaseUrl) return supabaseUrl;
        
        return `data:image/png;base64,${base64}`;
      } else {
        const errText = await response.text();
        console.error('[Generate API] Stability AI error response:', errText);
      }
    } catch (error) {
      console.error('[Generate API] Stability AI failed, falling back to Pollinations:', error);
    }
  }

  // Fallback to Pollinations AI (free, no API key required)
  console.log('[Generate API] Using Pollinations AI for image generation...');
  const encodedPrompt = encodeURIComponent(prompt);
  const randomSeed = Math.floor(Math.random() * 1000000);
  const pollinationsUrl = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=1024&height=1024&nologo=true&seed=${randomSeed}`;

  try {
    const res = await fetch(pollinationsUrl);
    if (res.ok) {
      const arrayBuffer = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);
      const supabaseUrl = await uploadToSupabaseStorage(buffer);
      if (supabaseUrl) return supabaseUrl;
    }
  } catch (error) {
    console.error('[Generate API] Failed to upload Pollinations image to Supabase:', error);
  }

  return pollinationsUrl;
}

// Helper: attempt to unwrap a Google redirect URL and return the real target URL
function unwrapGoogleUrl(raw: string): string | null {
  // Strip trailing punctuation first
  const cleaned = raw.replace(/[.,;:!?'")\]]+$/, '');
  if (!cleaned.includes('google.com/url')) return cleaned || null;

  // Strategy 1: URL constructor (works if URL is well-formed)
  try {
    const obj = new URL(cleaned);
    const q = obj.searchParams.get('q');
    if (q) {
      console.log(`[Link Extractor] Unwrapped Google redirect → ${q}`);
      return q;
    }
  } catch { /* fall through */ }

  // Strategy 2: regex extraction of q= value (handles partial/malformed URLs)
  const qMatch = cleaned.match(/[?&]q=([^&\s]+)/);
  if (qMatch?.[1]) {
    try {
      const decoded = decodeURIComponent(qMatch[1]);
      console.log(`[Link Extractor] Regex-extracted Google redirect q= → ${decoded}`);
      return decoded;
    } catch { /* fall through */ }
  }

  return cleaned;
}

// Extract the first meaningful http/https URL from digest text.
// Uses 4 strategies in order to handle all Apps-Script output formats:
//   1. Standard markdown link  [Label](https://real-url)
//   2. URL-as-link-text        [https://google-redirect](  )  ← Apps Script loses href
//   3. Source: / Link: prefixes with raw URL text
//   4. Any raw URL anywhere in the text (allow & for Google redirects)
function extractFirstLink(text: string): string | null {
  let url: string | null = null;

  // ── Strategy 1: standard markdown link with non-empty href ────────────────
  const markdownMatch = text.match(/\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/);
  if (markdownMatch?.[1]) {
    url = markdownMatch[1];
  }

  // ── Strategy 2: URL inside brackets with empty href  [https://...](   ) ──
  // This happens when Apps Script captures the href but Google's forwarded-email
  // HTML places the raw URL as the visible anchor text instead.
  if (!url) {
    const urlAsTextMatch = text.match(/\[(https?:\/\/[^\]]+)\]\(\s*\)/);
    if (urlAsTextMatch?.[1]) {
      url = urlAsTextMatch[1].trim();
      console.log(`[Link Extractor] Found URL in bracket-text (empty href): ${url}`);
    }
  }

  // ── Strategy 3: "Source: URL" / "Link: URL" lines ────────────────────────
  // Digest emails often have "Sources: [Label](URL)" or "Link: https://..."
  if (!url) {
    const sourceLinkMatch = text.match(
      /(?:Sources?|Link)\s*:\s*(?:\[[^\]]*\]\s*\()?\s*(https?:\/\/[^\s\)\]]+)/i
    );
    if (sourceLinkMatch?.[1]) {
      url = sourceLinkMatch[1].trim();
      console.log(`[Link Extractor] Found URL in Source/Link prefix: ${url}`);
    }
  }

  // ── Strategy 4: any raw URL in the text (allow & for Google redirects) ───
  if (!url) {
    const rawUrlMatch = text.match(/(https?:\/\/[^\s\)\],]+)/);
    if (rawUrlMatch?.[1]) {
      url = rawUrlMatch[1];
      console.log(`[Link Extractor] Found raw URL fallback: ${url}`);
    }
  }

  if (!url) return null;

  // Strip any trailing punctuation picked up from surrounding text
  url = url.replace(/[.,;:!?'")\]]+$/, '');

  // Unwrap Google redirect URLs (google.com/url?q=...) to get the real target
  return unwrapGoogleUrl(url);
}

// Extract ALL unique URLs from digest text (supports all the same formats as extractFirstLink).
// Returns them in document order, deduplicated, with Google redirects unwrapped.
// This is used to try multiple source links when scraping article images.
function extractAllLinks(text: string): string[] {
  const seen = new Set<string>();
  const results: string[] = [];

  const addUrl = (raw: string) => {
    const cleaned = raw.replace(/[.,;:!?'")\]]+$/, '');
    const resolved = unwrapGoogleUrl(cleaned);
    if (resolved && !seen.has(resolved)) {
      // Skip bare domain roots (e.g. https://humanoid.press/) — they usually return logos
      try {
        const obj = new URL(resolved);
        const hasPath = obj.pathname.length > 1; // more than just "/"
        seen.add(resolved);
        // Push article URLs first, bare domains last
        if (hasPath) results.unshift(resolved);
        else results.push(resolved);
      } catch { /* invalid URL, skip */ }
    }
  };

  // Standard markdown links [Label](url)
  const mdRegex = /\[[^\]]+\]\((https?:\/\/[^)\s]+)\)/g;
  let m: RegExpExecArray | null;
  while ((m = mdRegex.exec(text)) !== null) addUrl(m[1]);

  // URL-as-link-text [https://url]()
  const urlTextRegex = /\[(https?:\/\/[^\]]+)\]\(\s*\)/g;
  while ((m = urlTextRegex.exec(text)) !== null) addUrl(m[1].trim());

  // Raw URLs in the text (allow & for Google redirects)
  const rawRegex = /(https?:\/\/[^\s\)\],]+)/g;
  while ((m = rawRegex.exec(text)) !== null) addUrl(m[1]);

  return results;
}


function isLikelyLogo(imgUrl: string): boolean {
  const lower = imgUrl.toLowerCase();
  return (
    /logo|icon|favicon|sprite|brand|avatar|profile|placeholder|fallback|default|generic|thumbnail\/logo/i.test(lower) ||
    // Tiny size hints embedded in URL (e.g. ?w=32 or -32x32)
    /[\-_]\d{1,2}x\d{1,2}[\-_.]/.test(lower) ||
    /[?&]w=(\d+)/.test(lower) && parseInt((lower.match(/[?&]w=(\d+)/) || [])[1] || '9999') < 200
  );
}

// Resolve a potentially relative/protocol-relative image URL to absolute
function resolveImgUrl(imgUrl: string, pageUrl: string): string {
  if (imgUrl.startsWith('//')) return `https:${imgUrl}`;
  if (imgUrl.startsWith('/')) {
    try { return `${new URL(pageUrl).origin}${imgUrl}`; } catch { return imgUrl; }
  }
  return imgUrl;
}

// Scrape the target page and return ALL Open Graph / Twitter Card image URLs found.
// Uses Twitterbot UA so social sites serve full meta tags.
// Returns raw candidates — filtering/selection is done by Gemini Vision.
async function getOgImageCandidates(url: string): Promise<string[]> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);
  try {
    console.log(`[Scraper] Fetching ${url}...`);

    // Try Twitterbot first; fall back to facebookexternalhit if needed
    const userAgents = [
      'Twitterbot/1.0',
      'facebookexternalhit/1.1',
      'LinkedInBot/1.0',
    ];

    let html = '';
    for (const ua of userAgents) {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 7000);
      try {
        const res = await fetch(url, {
          signal: ctrl.signal,
          headers: {
            'User-Agent': ua,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
          }
        });
        clearTimeout(tid);
        if (res.ok) {
          const rawText = await res.text();
          html = rawText.slice(0, 150_000); // read up to 150KB
          console.log(`[Scraper] Got HTML via ${ua} (${html.length} chars)`);
          break;
        } else {
          console.warn(`[Scraper] ${ua} got ${res.status} for ${url}`);
        }
      } catch (e: any) {
        clearTimeout(tid);
        console.warn(`[Scraper] ${ua} failed:`, e.message || e);
      }
    }

    clearTimeout(timeoutId);
    if (!html) return [];

    // Collect ALL og:image and twitter:image URLs (sites often have multiple)
    const seen = new Set<string>();
    const candidates: string[] = [];

    const patterns = [
      /<meta[^>]+property=["']og:image(?::secure_url)?["'][^>]*content=["']([^"']+)["']/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image(?::secure_url)?["']/gi,
      /<meta[^>]+name=["']twitter:image(?::src)?["'][^>]*content=["']([^"']+)["']/gi,
      /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image(?::src)?["']/gi,
    ];

    for (const regex of patterns) {
      let m: RegExpExecArray | null;
      while ((m = regex.exec(html)) !== null) {
        const resolved = resolveImgUrl(m[1], url);
        if (!seen.has(resolved)) {
          seen.add(resolved);
          candidates.push(resolved);
        }
      }
    }

    console.log(`[Scraper] ${candidates.length} image candidate(s) from ${url}:`, candidates);
    return candidates;
  } catch (err: any) {
    clearTimeout(timeoutId);
    console.warn(`[Scraper] Error scraping ${url}:`, err.message || err);
  }
  return [];
}

// Download an image URL and return its base64 data + MIME type for Gemini Vision.
// Returns null if the download fails, times out, or the image is too large.
async function fetchImageBase64(url: string): Promise<{ data: string; mimeType: string } | null> {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'Twitterbot/1.0' }
    });
    clearTimeout(tid);
    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const mimeType = contentType.split(';')[0].trim();
    if (!mimeType.startsWith('image/')) return null;

    const arrayBuffer = await res.arrayBuffer();
    // Skip very large images (> 2 MB) to keep Gemini request size manageable
    if (arrayBuffer.byteLength > 2 * 1024 * 1024) {
      console.warn(`[Scraper] Image too large (${arrayBuffer.byteLength} bytes): ${url}`);
      return null;
    }

    const data = Buffer.from(arrayBuffer).toString('base64');
    return { data, mimeType };
  } catch (err: any) {
    clearTimeout(tid);
    console.warn(`[Scraper] fetchImageBase64 failed for ${url}:`, err.message || err);
    return null;
  }
}

// Use Gemini Vision to pick the best image from a set of candidates.
// Sends up to 6 images visually and asks Gemini to select the most
// article-relevant one (robot photos, charts, product shots).
async function selectBestImageWithGemini(
  genAI: GoogleGenerativeAI,
  candidates: string[],
  articleContext: string
): Promise<string | null> {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  // Cap at 6 candidates to keep Gemini request lean
  const limited = candidates.slice(0, 6);

  console.log(`[Gemini Vision] Downloading ${limited.length} candidate images for selection...`);

  // Download all images in parallel
  const downloaded = await Promise.all(
    limited.map(async (url) => {
      const img = await fetchImageBase64(url);
      return img ? { url, ...img } : null;
    })
  );

  const valid = downloaded.filter((d): d is { url: string; data: string; mimeType: string } => d !== null);

  if (valid.length === 0) {
    console.warn('[Gemini Vision] No images could be downloaded. Using first candidate URL.');
    return candidates[0];
  }
  if (valid.length === 1) {
    return valid[0].url;
  }

  console.log(`[Gemini Vision] Sending ${valid.length} images to Gemini for best-pick selection...`);

  // Build Gemini multimodal request
  const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
    {
      text:
        `You are selecting the best thumbnail image for a robotics and AI news article.\n\n` +
        `Article context: "${articleContext.slice(0, 400)}"\n\n` +
        `I will show you ${valid.length} candidate images (labelled 0 to ${valid.length - 1}).\n\n` +
        `Pick the image that BEST represents the article. ` +
        `STRONGLY PREFER: article-specific photos, robot photos, charts/graphs, product shots, screenshots of tech.\n` +
        `STRONGLY AVOID: site logos, small icons, generic stock images, author headshots, brand marks.\n\n` +
        `Reply with ONLY the index number of the best image (e.g. "2"). No explanation.`
    }
  ];

  for (let i = 0; i < valid.length; i++) {
    parts.push({ text: `Image ${i}:` });
    parts.push({ inlineData: { data: valid[i].data, mimeType: valid[i].mimeType } });
  }

  try {
    const visionModel = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });
    const result = await visionModel.generateContent(parts);
    const answer = result.response.text().trim().replace(/[^\d]/g, '');
    const idx = parseInt(answer, 10);
    if (!isNaN(idx) && idx >= 0 && idx < valid.length) {
      console.log(`[Gemini Vision] ✅ Selected image index ${idx}: ${valid[idx].url}`);
      return valid[idx].url;
    }
    console.warn(`[Gemini Vision] Unexpected answer "${answer}", falling back to first valid image.`);
  } catch (err: any) {
    console.warn('[Gemini Vision] Image selection call failed:', err.message || err);
  }

  // Fallback: return first valid image
  return valid[0].url;
}

// Clean up raw URLs, duplicate brackets, and trailing spacing/commas from text
function cleanBodyText(text: string): string {
  // Replace raw URLs with empty string
  let cleaned = text.replace(/https?:\/\/[^\s\)\],]+/g, '');
  // Clean up empty parentheses or brackets left behind, e.g. "( , )", "()"
  cleaned = cleaned.replace(/\(\s*[,|]*\s*\)/g, '');
  // Clean up double spaces or spaces before punctuation
  cleaned = cleaned.replace(/\s+/g, ' ');
  // Clean up stray commas or punctuation at the end
  cleaned = cleaned.replace(/\s*[,;]\s*$/g, '');
  return cleaned.trim();
}

// Format a clean, styled Reddit post for the fallback
function formatSmartRedditFallback(cleanText: string): string {
  const colonIndex = cleanText.indexOf(':');
  let title = 'Daily Robotics News Update';
  let body = cleanText;

  if (colonIndex > 0 && colonIndex < 100) {
    title = cleanText.slice(0, colonIndex).trim();
    body = cleanText.slice(colonIndex + 1).trim();
  }

  // Remove list numbering or bullets from the title
  title = title.replace(/^\d+\.\s*/, '').replace(/^[•\-\*]\s*/, '');

  return `### 🤖 ${title}\n\n> ${body}\n\n*What are your thoughts on today's updates? Let's discuss below!*`;
}

// Format a punchy, clean tweet under X's character limit for the fallback
function formatSmartXFallback(cleanText: string): string {
  const colonIndex = cleanText.indexOf(':');
  let title = 'Daily Robotics Update';
  let body = cleanText;

  if (colonIndex > 0 && colonIndex < 100) {
    title = cleanText.slice(0, colonIndex).trim();
    body = cleanText.slice(colonIndex + 1).trim();
  }

  title = title.replace(/^\d+\.\s*/, '').replace(/^[•\-\*]\s*/, '');

  const hashtags = '\n\n#Robotics #TechNews';
  // Reserve space for hashtags so the total post fits within 280 chars
  const maxBodyLength = 220 - hashtags.length - title.length - 4; // 4 = "🤖 " + "\n\n• "
  
  let truncatedBody = body;
  if (body.length > maxBodyLength) {
    const cutoff = body.indexOf(' ', maxBodyLength - 10);
    truncatedBody = cutoff > 0 ? body.slice(0, cutoff) + '...' : body.slice(0, maxBodyLength) + '...';
  }

  return `🤖 ${title.toUpperCase()}\n\n• ${truncatedBody}${hashtags}`;
}

// Hard-cap enforcer: guarantees the final X post (including source URL) never exceeds 280 characters.
// This is the last line of defense before saving to the database.
function enforceXLimit(text: string): string {
  const LIMIT = 280;
  if (text.length <= LIMIT) return text;

  // Try to find a clean word boundary to cut at
  const cutAt = text.lastIndexOf(' ', LIMIT - 3);
  if (cutAt > LIMIT / 2) {
    return text.slice(0, cutAt) + '...';
  }
  return text.slice(0, LIMIT - 3) + '...';
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { postId, raw_spark_text } = body;

    if (!postId || !raw_spark_text) {
      return NextResponse.json({ error: 'postId and raw_spark_text are required' }, { status: 400 });
    }

    // 1. Initialize Gemini API Client
    const geminiKey = process.env.GEMINI_API_KEY;
    if (!geminiKey) {
      console.error('[Generate API] GEMINI_API_KEY is not configured in env.');
      return NextResponse.json({ error: 'Gemini API key is not configured' }, { status: 500 });
    }

    const genAI = new GoogleGenerativeAI(geminiKey);
    // Use the modern high-performance gemini-2.0-flash model
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash',
      systemInstruction:
        'Take this raw daily robotics news digest and output a JSON object with three fields:\n' +
        '- x_post: A punchy 1-3 line tweet for X (Twitter). STRICT RULE: the x_post body MUST be under 200 characters total (not including any source link). Use 1-2 bullet points max with an emoji opener. NO hashtags inside x_post (they are added automatically). Never exceed 200 characters in x_post.\n' +
        '- reddit_post: A detailed, discussion-oriented post for a subreddit with a bold title, body paragraphs, and a call to discussion.\n' +
        '- image_prompt: A detailed descriptive prompt for an AI image generator representing the most interesting news item. Style: futuristic white and glowing high-shine blue robot in a dark tech environment.\n' +
        'Output valid JSON only. Do not wrap in markdown code blocks.',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: SchemaType.OBJECT,
          properties: {
            x_post: {
              type: SchemaType.STRING,
              description: 'A short, punchy summary with bullet points formatted for X (formerly Twitter).',
            },
            reddit_post: {
              type: SchemaType.STRING,
              description: 'A detailed, discussion-oriented version for a subreddit.',
            },
            image_prompt: {
              type: SchemaType.STRING,
              description: 'A detailed prompt for generating an image related to this post.',
            },
          },
          required: ['x_post', 'reddit_post', 'image_prompt'],
        },
      },
    });

    let xPostText = '';
    let redditPostText = '';
    let imagePrompt = '';

    try {
      console.log(`[Generate API] Requesting Gemini text generation for post ${postId}...`);
      const result = await model.generateContent(raw_spark_text);
      const responseText = result.response.text();

      // Clean up Gemini output in case it wrapped JSON in markdown code blocks
      let cleanedText = responseText.trim();
      if (cleanedText.startsWith('```')) {
        cleanedText = cleanedText.replace(/^```json\s*/, '').replace(/```$/, '').trim();
      }

      const parsedJson = JSON.parse(cleanedText);
      xPostText = parsedJson.x_post || parsedJson.x_post_text || '';
      redditPostText = parsedJson.reddit_post || parsedJson.reddit_post_text || '';
      imagePrompt = parsedJson.image_prompt || '';

      if (!xPostText || !redditPostText || !imagePrompt) {
        throw new Error('Gemini output is missing expected fields.');
      }
    } catch (geminiError: any) {
      console.warn('[Generate API] Gemini API call failed. Running smart text fallback based on input.', geminiError.message || geminiError);
      
      // Clean up raw text (remove HTML elements or excess spacing if any)
      const cleanInput = raw_spark_text
        .replace(/<[^>]*>/g, '') // remove HTML tags if any
        .trim();
      
      const parsedBody = cleanBodyText(cleanInput);
        
      // For X: extract structured tweet under X's character limit
      xPostText = formatSmartXFallback(parsedBody);
      
      // For Reddit: Use the formatted title & blockquote structure
      redditPostText = formatSmartRedditFallback(parsedBody);

      // Generate a varied mock image prompt based on the first few words of the input
      const firstWords = parsedBody.split(' ').slice(0, 5).join(' ');
      imagePrompt = `A futuristic white and glowing high-shine blue robot representing: ${firstWords || 'robotics technology'}, in a dark tech environment.`;
    }

    // 1.5 Collect ALL og:image candidates from ALL source URLs, then let Gemini Vision
    // visually inspect them and pick the best article-relevant image.
    const allLinks = extractAllLinks(raw_spark_text);
    const blogUrl = allLinks[0] ?? null; // Primary link used for citation
    let imageUrl = '';

    if (allLinks.length > 0) {
      console.log(`[Generate API] Scraping images from ${allLinks.length} link(s):`, allLinks);

      // Collect candidates from ALL source URLs in parallel
      const perUrlCandidates = await Promise.all(allLinks.map(link => getOgImageCandidates(link)));
      const allCandidates = perUrlCandidates.flat();

      // Deduplicate preserving order
      const seenCandidates = new Set<string>();
      const uniqueCandidates = allCandidates.filter(c => {
        if (seenCandidates.has(c)) return false;
        seenCandidates.add(c);
        return true;
      });

      console.log(`[Generate API] Total unique image candidates: ${uniqueCandidates.length}`, uniqueCandidates);

      if (uniqueCandidates.length > 0) {
        // Let Gemini Vision visually inspect and select the best image
        const chosen = await selectBestImageWithGemini(genAI, uniqueCandidates, raw_spark_text);
        if (chosen) {
          imageUrl = chosen;
          console.log(`[Generate API] ✅ Gemini Vision chose: ${imageUrl}`);
        }
      }
    }

    // 2. Generate Image (Fallback if scraping failed or no link was found)
    if (!imageUrl) {
      console.log(`[Generate API] Scraped image not found. Triggering image generation for post ${postId}...`);
      imageUrl = await generateImage(imagePrompt);
    }

    // 2.5 Programmatically append the source link to the end of the posts if present,
    // then hard-enforce the 280-character limit on the X post so it is ALWAYS publishable.
    if (blogUrl) {
      // Reserve space: calculate how many chars remain after the source suffix
      const sourceSuffix = `\n\nSource: ${blogUrl}`;
      const maxBodyForX = 280 - sourceSuffix.length;
      if (xPostText.length > maxBodyForX) {
        const cutAt = xPostText.lastIndexOf(' ', maxBodyForX - 3);
        xPostText = cutAt > maxBodyForX / 2
          ? xPostText.slice(0, cutAt) + '...'
          : xPostText.slice(0, maxBodyForX - 3) + '...';
      }
      xPostText = `${xPostText}${sourceSuffix}`;
      redditPostText = `${redditPostText}\n\n[Read full article](${blogUrl})`;
    }

    // Final safety pass — enforces 280 chars even if there was no source URL
    xPostText = enforceXLimit(xPostText);
    console.log(`[Generate API] Final X post length: ${xPostText.length} chars`);

    // 3. Update Supabase record with generated texts, image URL, and status 'READY'
    console.log(`[Generate API] Saving generated content to database for post ${postId}...`);
    const { error: dbError } = await supabaseServer
      .from('posts')
      .update({
        x_post_text: xPostText,
        reddit_post_text: redditPostText,
        image_url: imageUrl,
        status: 'READY',
      })
      .eq('id', postId);

    if (dbError) {
      console.error('[Generate API] Database update error:', dbError);
      return NextResponse.json({ error: 'Failed to save generated content to database' }, { status: 500 });
    }

    console.log(`[Generate API] Processing completed successfully for post ${postId}`);
    return NextResponse.json({
      success: true,
      postId,
      status: 'READY',
      xPostText,
      redditPostText,
      imageUrl,
    });
  } catch (error: any) {
    console.error('[Generate API Error]:', error);
    return NextResponse.json({ error: error.message || 'Internal Server Error' }, { status: 500 });
  }
}
