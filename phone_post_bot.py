import os
import sys
import time
import urllib.parse
import requests
import subprocess
import shlex
from dotenv import load_dotenv

# Try to import supabase library, notify user if missing
try:
    from supabase import create_client
except ImportError:
    print("\n[-] Error: The 'supabase' library is not installed.")
    print("[*] Please install it using: pip install supabase")
    sys.exit(1)

# Load database credentials from .env.local
load_dotenv(dotenv_path='.env.local')

SUPABASE_URL = os.getenv('NEXT_PUBLIC_SUPABASE_URL')
# Use Service Role Key to bypass any RLS write restrictions when updating status
SUPABASE_KEY = os.getenv('SUPABASE_SERVICE_ROLE_KEY') or os.getenv('NEXT_PUBLIC_SUPABASE_ANON_KEY')

if not SUPABASE_URL or not SUPABASE_KEY:
    print("[-] Error: Supabase credentials not found in .env.local")
    print("Please make sure NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are configured.")
    sys.exit(1)

print("[*] Connecting to Supabase database...")
supabase = create_client(SUPABASE_URL, SUPABASE_KEY)

def check_adb_device():
    """Checks if there is an Android device connected via ADB using safe subprocess."""
    print("[*] Checking ADB device connection status...")
    try:
        res = subprocess.run(["adb", "devices"], capture_output=True, text=True, check=True)
        output = res.stdout.strip().split('\n')
        devices = [line for line in output[1:] if line.strip() and 'device' in line]
        if not devices:
            print("\n[!] Warning: No connected Android device found via ADB.")
            print("[!] Make sure:")
            print("    1. USB Debugging is enabled on your phone.")
            print("    2. Your phone is connected to this computer via USB (or wireless ADB).")
            print("    3. Running 'adb devices' lists your device.")
            return False
        print(f"[+] ADB connection verified! Device: {devices[0]}")
        return True
    except Exception as e:
        print(f"[-] Failed to check adb devices: {e}")
        return False

def run_adb_command(cmd_args):
    """Executes an ADB command safely using subprocess list execution."""
    if isinstance(cmd_args, str):
        args = ["adb"] + shlex.split(cmd_args)
    else:
        args = ["adb"] + [str(x) for x in cmd_args]
    
    print(f"    Executing: {' '.join(args)}")
    try:
        subprocess.run(args, check=True, capture_output=True)
        return True
    except subprocess.CalledProcessError as e:
        print(f"[-] ADB command failed (exit code {e.returncode}): {e.stderr.decode().strip()}")
        return False
    except Exception as e:
        print(f"[-] ADB command execution error: {e}")
        return False

def download_image_locally(url, post_id):
    """Downloads a public image URL to a local temporary path."""
    if not url:
        return None
    try:
        temp_path = f"./temp_adb_img_{post_id[:8]}.png"
        res = requests.get(url, stream=True, timeout=10)
        if res.status_code == 200:
            with open(temp_path, 'wb') as f:
                for chunk in res:
                    f.write(chunk)
            return os.path.abspath(temp_path)
    except Exception as e:
        print(f"[-] Image download failed: {e}")
    return None

def process_pending_tweets():
    """Queries Supabase for pending tweets and processes them via Android ADB."""
    print("\n[*] Polling for pending tweets in database...")
    try:
        response = supabase.table('pending_tweets').select('*').eq('status', 'pending').order('created_at').execute()
        pending_list = response.data
    except Exception as e:
        print(f"[-] Database query failed: {e}")
        return

    if not pending_list:
        print("[+] No pending tweets found.")
        return

    print(f"[+] Found {len(pending_list)} pending tweet(s) in queue!")

    # Ensure device is connected before starting
    if not check_adb_device():
        print("[-] Skipping execution until device is connected.")
        return

    for tweet in pending_list:
        tweet_id = tweet['id']
        content = tweet['content']
        
        print(f"\n[~] Processing Tweet ID: {tweet_id}")
        print(f"    Content: \"{content}\"")

        try:
            # Wake screen & unlock
            run_adb_command("shell input keyevent 224")
            time.sleep(1)
            run_adb_command("shell input swipe 500 1500 500 500 200")
            time.sleep(1)

            # Deep link syntax: twitter://post?message=TEXT
            encoded_content = urllib.parse.quote(content)
            deep_link = f"twitter://post?message={encoded_content}"

            print("[*] Launching X (Twitter) compose window via deep link...")
            run_adb_command(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", deep_link])
            
            print("[*] Waiting 4 seconds for X interface to load...")
            time.sleep(4)

            # Tap 'Post' button (top right: 950, 150)
            print("[*] Simulating screen tap to click 'Post' button...")
            run_adb_command("shell input tap 950 150")
            time.sleep(2)

            # Update status in database
            supabase.table('pending_tweets').update({'status': 'posted'}).eq('id', tweet_id).execute()
            print("[+] Successfully published tweet!")

        except Exception as ex:
            print(f"[-] Failed to process tweet {tweet_id}: {ex}")

def process_queued_robotics_posts():
    """Queries Supabase posts table for QUEUED_X posts and automates text + photo on Android."""
    print("\n[*] Polling for QUEUED_X posts in database...")
    try:
        response = supabase.table('posts').select('*').eq('status', 'QUEUED_X').order('created_at').execute()
        queued_list = response.data
    except Exception as e:
        print(f"[-] Database query failed: {e}")
        return

    if not queued_list:
        print("[+] No QUEUED_X posts found.")
        return

    print(f"[+] Found {len(queued_list)} QUEUED_X post(s) to publish!")

    # Ensure device is connected before starting
    if not check_adb_device():
        print("[-] Skipping execution until device is connected.")
        return

    for post in queued_list:
        post_id = post['id']
        x_text = post.get('x_post_text') or ""
        img_url = post['image_url']
        current_status = post['status']

        print(f"\n[~] Automating Post ID: {post_id}")
        print(f"    Text: \"{x_text[:60]}...\"")
        print(f"    Image: {img_url}")

        local_path = None
        phone_img_path = "/sdcard/Download/temp_tweet_img.png"
        try:
            # Wake screen & unlock
            run_adb_command("shell input keyevent 224")
            time.sleep(1)
            run_adb_command("shell input swipe 500 1500 500 500 200")
            time.sleep(1)

            # Download and push image if available
            has_image = False
            if img_url:
                print("[*] Downloading article image locally...")
                local_path = download_image_locally(img_url, post_id)
                if local_path and os.path.exists(local_path):
                    is_termux = os.path.exists('/data/data/com.termux')
                    if is_termux:
                        print("[*] Termux environment detected. Copying image directly to Android shared storage...")
                        import shutil
                        copied = False
                        for path in ["/sdcard/Download/temp_tweet_img.png", "/storage/emulated/0/Download/temp_tweet_img.png"]:
                            try:
                                os.makedirs(os.path.dirname(path), exist_ok=True)
                                shutil.copy(local_path, path)
                                phone_img_path = path
                                copied = True
                                print(f"[+] Image copied directly to {path}!")
                                break
                            except Exception as e:
                                print(f"[-] Direct copy failed for {path}: {e}")
                        if not copied:
                            print("[*] Direct copy failed, falling back to ADB push...")
                            run_adb_command(["push", local_path, phone_img_path])
                            has_image = True
                        else:
                            has_image = True
                    else:
                        print("[*] Pushing image to Android device storage via ADB...")
                        run_adb_command(["push", local_path, phone_img_path])
                        has_image = True

                    if has_image:
                        # Trigger media scan so X app sees it
                        run_adb_command(["shell", "am", "broadcast", "-a", "android.intent.action.MEDIA_SCANNER_SCAN_FILE", "-d", f"file://{phone_img_path}"])
                        time.sleep(1)

            # Open intent
            # If image exists, use android.intent.action.SEND with -t image/* to share both image and text
            # Otherwise use simple deep link compose
            if has_image:
                print("[*] Launching X app via SEND intent (image + text)...")
                # Using subprocess argument lists avoids shell newline expansion and commands splitting!
                adb_args = [
                    "shell", "am", "start",
                    "-a", "android.intent.action.SEND",
                    "-t", "image/*",
                    "--es", "android.intent.extra.TEXT", x_text,
                    "--eu", "android.intent.extra.STREAM", f"file://{phone_img_path}",
                    "--grant-read-uri-permission",
                    "com.twitter.android"
                ]
                run_adb_command(adb_args)
            else:
                print("[*] Launching X composer via deep link (text only)...")
                encoded_content = urllib.parse.quote(x_text)
                deep_link = f"twitter://post?message={encoded_content}"
                run_adb_command(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", deep_link])

            # Wait for X composer layout to load
            print("[*] Waiting 5 seconds for X composer to display...")
            time.sleep(5)

            # Tap 'Post' button (top right: 950, 150)
            print("[*] Simulating screen tap to click 'Post' button...")
            run_adb_command("shell input tap 950 150")
            time.sleep(2.5)

            # Cleanup pushed image from phone
            if has_image:
                run_adb_command(["shell", "rm", phone_img_path])

            # Determine new status:
            # We want to check if the post was already posted on Reddit.
            # If yes, update status to POSTED_BOTH. Else, set to POSTED_X.
            new_status = 'POSTED_X'
            # Fetch latest post data to ensure status is accurate
            fresh_post = supabase.table('posts').select('status').eq('id', post_id).single().execute()
            if fresh_post.data and (fresh_post.data['status'] == 'POSTED_REDDIT' or fresh_post.data['status'] == 'POSTED_BOTH'):
                new_status = 'POSTED_BOTH'

            print(f"[*] Updating post status to {new_status} in Supabase...")
            supabase.table('posts').update({'status': new_status}).eq('id', post_id).execute()
            print("[+] Successfully published post to Android X client!")

        except Exception as ex:
            print(f"[-] Failed to process robotics post {post_id}: {ex}")
        finally:
            # Cleanup local temp image
            if local_path and os.path.exists(local_path):
                os.remove(local_path)
def main():
    print("=" * 60)
    print("      Android Phone ADB Automator Daemon Active")
    print("=" * 60)
    
    # Verify initial device status
    check_adb_device()

    # Loop infinitely checking database every 5 seconds
    while True:
        try:
            # Process generic tweet inputs
            process_pending_tweets()
            # Process structured Next.js dashboard posts
            process_queued_robotics_posts()
        except KeyboardInterrupt:
            print("\n[+] Daemon stopped by user. Exiting.")
            break
        except Exception as e:
            print(f"[-] Loop iteration error: {e}")
        
        time.sleep(5)

if __name__ == "__main__":
    main()

