import os
import sys
import time
import urllib.parse
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
    """Checks if there is an Android device connected via ADB."""
    print("[*] Checking ADB device connection status...")
    stream = os.popen('adb devices')
    output = stream.read().strip().split('\n')
    
    # The first line is "List of devices attached", subsequent lines list devices
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

def run_adb_command(cmd):
    """Executes an ADB shell command."""
    full_cmd = f"adb {cmd}"
    print(f"    Executing: {full_cmd}")
    os.system(full_cmd)

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
        print("[+] No pending tweets found. Sleeping...")
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
            # 1. Wake up the phone screen
            print("[*] Waking up device screen...")
            run_adb_command("shell input keyevent 224")
            time.sleep(1)

            # 2. Unlock phone (Simulate drag up swipe in case lock screen requires it)
            # If your device has a PIN/Password lock, you must unlock it manually first.
            print("[*] Dismissing keyguard / swipe unlock...")
            run_adb_command("shell input swipe 500 1500 500 500 200")
            time.sleep(1)

            # 3. URL-encode content for Twitter deep link schema
            encoded_content = urllib.parse.quote(content)
            # Deep link syntax: twitter://post?message=TEXT
            deep_link = f"twitter://post?message={encoded_content}"

            print("[*] Launching X (Twitter) compose window via deep link...")
            run_adb_command(f'shell am start -a android.intent.action.VIEW -d "{deep_link}"')
            
            # Wait for X app to open and load the compose draft window
            print("[*] Waiting 4 seconds for X interface to load...")
            time.sleep(4)

            # 4. Tap the 'Post' button (Simulates coordinate tap on top right compose area)
            # Note: 950 150 is the default position for 1080p screens.
            # Adjust these coordinates if your screen resolution or layout is different.
            print("[*] Simulating screen tap to click 'Post' button...")
            run_adb_command("shell input tap 950 150")
            time.sleep(2)

            # 5. Update status to 'posted' in Supabase to avoid double posting
            print("[*] Updating tweet status to 'posted' in Supabase...")
            supabase.table('pending_tweets').update({'status': 'posted'}).eq('id', tweet_id).execute()
            print("[+] Successfully published tweet and updated status!")

        except Exception as ex:
            print(f"[-] Failed to process tweet {tweet_id}: {ex}")

def main():
    print("=" * 60)
    print("      Android Phone ADB Twitter Automator Daemon")
    print("=" * 60)
    
    # Verify initial device status
    check_adb_device()

    # Loop infinitely checking database every 5 seconds
    while True:
        try:
            process_pending_tweets()
        except KeyboardInterrupt:
            print("\n[+] Daemon stopped by user. Exiting.")
            break
        except Exception as e:
            print(f"[-] Loop iteration error: {e}")
        
        time.sleep(5)

if __name__ == "__main__":
    main()
