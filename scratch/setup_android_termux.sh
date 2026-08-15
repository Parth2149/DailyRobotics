#!/data/data/com.termux/files/usr/bin/bash
# Android Termux Setup Script for DailyRobotics Phone Automator
# Run this script directly inside the Termux app on your Android device!

echo "=========================================================="
echo "    Termux DailyRobotics ADB Automator Setup"
echo "=========================================================="

# 1. Update Termux packages
echo "[*] Updating Termux packages..."
apt update && apt upgrade -y

# 2. Install Git, Python, and required tools
echo "[*] Installing Python, Git, and dependencies..."
apt install git python ndk-sysroot clang make libffi -y

# 3. Clone the repository
echo "[*] Cloning DailyRobotics repository from GitHub..."
if [ -d "DailyRobotics" ]; then
    echo "[!] DailyRobotics folder already exists. Pulling latest updates..."
    cd DailyRobotics && git pull && cd ..
else
    git clone https://github.com/Parth21490/DailyRobotics.git
fi

cd DailyRobotics

# 4. Install Python libraries
echo "[*] Installing python libraries..."
pip install supabase python-dotenv requests

# 5. Create .env.local if it doesn't exist
if [ ! -f ".env.local" ]; then
    echo "[*] Creating .env.local file..."
    echo -n "Enter your Supabase URL (e.g. https://xxxx.supabase.co): "
    read supabase_url
    echo -n "Enter your Supabase Anon Key: "
    read supabase_key
    
    echo "NEXT_PUBLIC_SUPABASE_URL=$supabase_url" > .env.local
    echo "NEXT_PUBLIC_SUPABASE_ANON_KEY=$supabase_key" >> .env.local
    echo "SUPABASE_SERVICE_ROLE_KEY=$supabase_key" >> .env.local
    echo "[+] .env.local created successfully!"
fi

echo "=========================================================="
echo "    Setup Complete! Choose how you want to run:"
echo "=========================================================="
echo "Option 1 (Text-only deep link sharing):"
echo "   Run: python phone_post_bot.py"
echo "   (This will open X app on your screen. You will tap 'Post' yourself)"
echo ""
echo "Option 2 (Full automation using Wireless Debugging on the phone itself):"
echo "   1. Go to Developer Options -> enable 'Wireless Debugging'."
echo "   2. Click it, see the Port number (e.g. 39423)."
echo "   3. Inside Termux, run: adb connect 127.0.0.1:YOUR_PORT"
echo "   4. Run: python phone_post_bot.py"
echo "=========================================================="
