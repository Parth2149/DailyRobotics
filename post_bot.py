import os
import sys
import time
import requests
from dotenv import load_dotenv
from supabase import create_client

# Check if required modules are installed
try:
    from playwright.sync_api import sync_playwright
except ImportError:
    print("Playwright is not installed. Please run: pip install playwright")
    print("Then initialize it with: playwright install")
    sys.exit(1)

# Load env variables from .env.local
load_dotenv(dotenv_path='.env.local')

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY')
SUBREDDIT = os.getenv('REDDIT_SUBREDDIT', 'test')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[-] Error: Supabase credentials not found in .env.local")
    print("Please make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set.")
    sys.exit(1)

# Initialize Supabase client
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)
USER_DATA_DIR = './.playwright_session'

def setup_auth():
    """Opens a browser to let the user log in once manually, saving session state."""
    print("\n[!] Setup Mode: Opening browser to save login cookies/session.")
    print("[!] Please log in to your X (Twitter) and Reddit accounts in the browser window.")
    print("[!] Once logged in, return to this terminal and press Enter to save state...\n")
    
    with sync_playwright() as p:
        context = p.chromium.launch_persistent_context(
            USER_DATA_DIR,
            headless=False,
            viewport={'width': 1280, 'height': 800}
        )
        page = context.new_page()
        
        # Open both tabs for easy logging in
        page.goto("https://x.com")
        page2 = context.new_page()
        page2.goto("https://reddit.com")
        
        input("Press ENTER here after you have successfully logged in on BOTH websites...")
        context.close()
        print("[+] Session state saved successfully! You can now run the bot in automated mode.\n")

def download_image(url, post_id):
    """Downloads the generated post image to a local temporary file."""
    if not url:
        return None
    try:
        temp_path = f"./scratch_img_{post_id[:8]}.png"
        response = requests.get(url, stream=True)
        if response.status_code == 200:
            with open(temp_path, 'wb') as f:
                for chunk in response:
                    f.write(chunk)
            return os.path.abspath(temp_path)
    except Exception as e:
        print(f"[-] Failed to download image: {e}")
    return None

def post_to_x(page, text, image_path):
    """Automates posting a tweet with text and image on X."""
    print("[*] Navigating to X compose...")
    page.goto("https://x.com/compose/post")
    
    # Wait for either compose editor or login prompt to verify auth state
    try:
        page.wait_for_selector('[data-testid="tweetTextarea_0"]', timeout=10000)
    except:
        print("[-] Authentication check failed. It looks like you are not logged in to X.")
        return False
        
    print("[*] Uploading image to X...")
    if image_path and os.path.exists(image_path):
        page.set_input_files('input[data-testid="fileInput"]', image_path)
        # Give image a few seconds to upload
        time.sleep(4)
        
    print("[*] Typing text draft on X...")
    page.fill('[data-testid="tweetTextarea_0"]', text)
    time.sleep(1)
    
    print("[*] Clicking Post button...")
    page.click('[data-testid="tweetButtonInline"]')
    time.sleep(3) # Wait for network request to clear
    print("[+] Successfully posted to X!")
    return True

def post_to_reddit(page, subreddit, title, body, image_path):
    """Automates posting a self-post with markdown text body on Reddit."""
    submit_url = f"https://www.reddit.com/r/{subreddit}/submit?type=text"
    print(f"[*] Navigating to Reddit subreddit submission: r/{subreddit}...")
    page.goto(submit_url)
    
    # Check if loaded submit editor
    try:
        page.wait_for_selector('textarea[placeholder="Title"]', timeout=10000)
    except:
        # Fallback to newer Reddit UI text input placeholder
        try:
            page.wait_for_selector('input[placeholder="Title"]', timeout=5000)
        except:
            print("[-] Authentication check failed. It looks like you are not logged in to Reddit.")
            return False

    print("[*] Entering Reddit post title...")
    title_selector = 'textarea[placeholder="Title"]' if page.query_selector('textarea[placeholder="Title"]') else 'input[placeholder="Title"]'
    page.fill(title_selector, title)
    time.sleep(1)
    
    print("[*] Entering Reddit markdown text body...")
    body_selector = 'textarea[placeholder="Text (optional)"]' if page.query_selector('textarea[placeholder="Text (optional)"]') else 'div[role="textbox"]'
    
    # We include the image URL markdown link inside the text body
    full_body = body
    page.fill(body_selector, full_body)
    time.sleep(1)
    
    print("[*] Submitting Reddit post...")
    # Find post submit button
    submit_btn = page.query_selector('button:has-text("Post")') or page.query_selector('button[type="submit"]')
    if submit_btn:
        submit_btn.click()
        time.sleep(5)
        print("[+] Successfully posted to Reddit!")
        return True
    else:
        print("[-] Could not find Reddit submit button.")
        return False

def check_and_publish():
    """Queries Supabase for 'READY' posts and automates publishing them."""
    print("[*] Querying Supabase for posts with status 'READY'...")
    response = supabase.table('posts').select('*').eq('status', 'READY').execute()
    
    posts = response.data
    if not posts:
        print("[+] No pending 'READY' posts found in the queue.")
        return
        
    print(f"[+] Found {len(posts)} pending post(s) to publish.")
    
    with sync_playwright() as p:
        print("[*] Launching automated background browser...")
        # Run headless for automated posting
        context = p.chromium.launch_persistent_context(
            USER_DATA_DIR,
            headless=True,
            viewport={'width': 1280, 'height': 800}
        )
        page = context.new_page()
        
        for post in posts:
            post_id = post['id']
            x_text = post['x_post_text']
            reddit_text = post['reddit_post_text']
            img_url = post['image_url']
            
            print(f"\n[*] Processing Post ID: {post_id}")
            
            # Download image locally
            local_img = download_image(img_url, post_id)
            
            posted_x = False
            posted_reddit = False
            
            try:
                posted_x = post_to_x(page, x_text, local_img)
            except Exception as ex:
                print(f"[-] Error during X posting: {ex}")
                
            try:
                reddit_title = f"Daily Robotics News Update - {time.strftime('%b %d, %Y')}"
                # Embed the downloaded image link at the top of the Reddit markdown self post
                reddit_body = f"![Robotics News Image]({img_url})\n\n{reddit_text}"
                posted_reddit = post_to_reddit(page, SUBREDDIT, reddit_title, reddit_body, local_img)
            except Exception as ex:
                print(f"[-] Error during Reddit posting: {ex}")
                
            # Clean up temp image
            if local_img and os.path.exists(local_img):
                os.remove(local_img)
                
            # Update database status based on publishing result
            new_status = 'READY'
            if posted_x and posted_reddit:
                new_status = 'POSTED_BOTH'
            elif posted_x:
                new_status = 'POSTED_X'
            elif posted_reddit:
                new_status = 'POSTED_REDDIT'
                
            if new_status != 'READY':
                print(f"[*] Updating post {post_id} status to {new_status} in Supabase...")
                supabase.table('posts').update({'status': new_status}).eq('id', post_id).execute()
            else:
                print("[-] Post failed to publish to either platform. Retaining 'READY' status.")
                
        context.close()

if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "--setup":
        setup_auth()
    else:
        # Run checks and post
        check_and_publish()
