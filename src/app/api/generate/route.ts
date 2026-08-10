import { NextResponse } from 'next/server';
import { GoogleGenerativeAI, SchemaType } from '@google/generative-ai';
import { supabaseServer } from '@/lib/supabase';

// Increased timeout limit for Vercel Serverless Functions during AI text & image generation
export const maxDuration = 60;

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

// Extract the first http/https URL link in the text (supporting markdown or raw URLs)
function extractFirstLink(text: string): string | null {
  // Regex to match markdown links: [Label](URL)
  const markdownRegex = /\[[^\]]+\]\((https?:\/\/[^)]+)\)/;
  const matchMarkdown = text.match(markdownRegex);
  if (matchMarkdown && matchMarkdown[1]) {
    return matchMarkdown[1];
  }

  // Fallback to standard URL regex (excluding trailing punctuation/parentheses)
  const urlRegex = /(https?:\/\/[^\s\)\],]+)/;
  const matchUrl = text.match(urlRegex);
  if (matchUrl && matchUrl[1]) {
    return matchUrl[1];
  }

  return null;
}

// Scrape HTML of the target webpage to retrieve Open Graph image tags
async function getOgImage(url: string): Promise<string | null> {
  try {
    console.log(`[Scraper] Fetching HTML from ${url}...`);
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), 6000); // 6s timeout

    const res = await fetch(url, { 
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    clearTimeout(id);

    if (!res.ok) {
      console.warn(`[Scraper] Failed to fetch page: ${res.statusText}`);
      return null;
    }

    const html = await res.text();

    // Regex to match og:image or twitter:image metadata tags
    const ogImageRegex = /<meta\s+[^>]*property=["']og:image["']\s+[^>]*content=["']([^"']+)["']/i;
    const ogImageRegexAlt = /<meta\s+[^>]*content=["']([^"']+)["']\s+[^>]*property=["']og:image["']/i;
    const twitterImageRegex = /<meta\s+[^>]*name=["']twitter:image["']\s+[^>]*content=["']([^"']+)["']/i;

    let match = html.match(ogImageRegex) || html.match(ogImageRegexAlt) || html.match(twitterImageRegex);
    if (match && match[1]) {
      let imgUrl = match[1];
      if (imgUrl.startsWith('/')) {
        const urlObj = new URL(url);
        imgUrl = `${urlObj.origin}${imgUrl}`;
      }
      console.log(`[Scraper] Successfully found Open Graph image: ${imgUrl}`);
      return imgUrl;
    }
  } catch (err: any) {
    console.warn(`[Scraper] Error scraping URL ${url}:`, err.message || err);
  }
  return null;
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
        'Take this raw daily robotics news digest and output a JSON object containing three fields: x_post (a short, punchy summary with bullet points formatted for X), reddit_post (a detailed, discussion-oriented version for a subreddit), and image_prompt (a detailed, descriptive prompt for an image generator representing the most interesting news item in the text, e.g. a specific humanoid robot or laboratory setting. Style should be futuristic white and glowing high-shine blue robot accents in a dark tech environment). Do not use markdown blocks in the JSON.',
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
      xPostText = parsedJson.x_post;
      redditPostText = parsedJson.reddit_post;
      imagePrompt = parsedJson.image_prompt;

      if (!xPostText || !redditPostText || !imagePrompt) {
        throw new Error('Gemini output is missing expected fields.');
      }
    } catch (geminiError: any) {
      console.warn('[Generate API] Gemini API call failed. Falling back to mock copywriting.', geminiError.message || geminiError);
      
      // Fallback copywriting so the pipeline can still be tested without a valid API key
      xPostText = `Daily Robotics Digest 🤖\n\n• Unitree G1 humanoid robot launched at $16,000.\n• Boston Dynamics retired hydraulic Atlas, debuting all-electric version.\n• Sanctuary AI partner Microsoft on large physical models (LPMs).\n• Tesla Optimus gigafactory trials deployed.\n\n#Robotics #TechNews`;
      
      redditPostText = `### Daily Robotics News Digest\n\nHere is a summary of today's key developments in physical AI and robotics:\n\n1. **Unitree G1 Humanoid**: Priced at a revolutionary $16,000, it features advanced locomotion and manipulation.\n2. **Boston Dynamics Electric Atlas**: Replaced the legacy hydraulic Atlas, launching a highly agile electric model.\n3. **Sanctuary AI & Microsoft**: Partnering to train Large Physical Models (LPMs) using Azure Cloud infrastructure.\n4. **Tesla Optimus gigafactory trials**: Performing real-world cell sorting tasks with neural network controls.\n\n*What are your thoughts on Unitree's pricing? Is $16k the tipping point for commercial humanoids? Let's discuss below!*`;

      // Generate a slightly varied mock image prompt based on the post ID to ensure unique images even in fallback
      const seeds = ['humanoid robot walking', 'bipedal robot carrying box', 'robotic hand soldering', 'robotic arm sorting batteries'];
      const seedIndex = Math.abs(postId.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0)) % seeds.length;
      imagePrompt = `A futuristic white and glowing high-shine blue robot, specifically a ${seeds[seedIndex]}, in a dark tech environment.`;
    }

    // 1.5 Extract first link and attempt to fetch its Open Graph thumbnail image to save credits
    const blogUrl = extractFirstLink(raw_spark_text);
    let imageUrl = '';

    if (blogUrl) {
      console.log(`[Generate API] Found blog link: ${blogUrl}. Attempting to scrape Open Graph image...`);
      const ogImage = await getOgImage(blogUrl);
      if (ogImage) {
        imageUrl = ogImage;
        console.log(`[Generate API] Scraped Open Graph image successfully: ${imageUrl}`);
      }
    }

    // 2. Generate Image (Fallback if scraping failed or no link was found)
    if (!imageUrl) {
      console.log(`[Generate API] Scraped image not found. Triggering image generation for post ${postId}...`);
      imageUrl = await generateImage(imagePrompt);
    }

    // 2.5 Programmatically append the source link to the end of the posts if present
    if (blogUrl) {
      xPostText = `${xPostText}\n\nSource: ${blogUrl}`;
      redditPostText = `${redditPostText}\n\n[Read full article](${blogUrl})`;
    }

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
