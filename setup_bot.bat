@echo off
title DailyRobotics ADB Automator Setup Installer
echo ==========================================================
echo        DailyRobotics Local PC Automator Installer
echo ==========================================================
echo.

:: 1. Check Python Installation
echo [*] Checking Python installation...
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [-] Error: Python is not installed or not added to your PATH!
    echo Please install Python from https://www.python.org/downloads/
    echo and make sure to check "Add Python to PATH" during installation.
    pause
    exit /b
)
echo [+] Python detected successfully.

:: 2. Install Required Python Libraries
echo [*] Installing required Python libraries (supabase, python-dotenv, requests)...
python -m pip install --upgrade pip >nul 2>&1
pip install supabase python-dotenv requests
if %errorlevel% neq 0 (
    echo [-] Failed to install python libraries. Please check your internet connection.
    pause
    exit /b
)
echo [+] Python libraries installed successfully!

:: 3. Verify ADB
echo [*] Checking Android Debug Bridge (ADB)...
adb version >nul 2>&1
if %errorlevel% neq 0 (
    echo [!] Warning: ADB is not installed or not in your system PATH.
    echo If your phone is not detected, please download Platform Tools from:
    echo https://developer.android.com/tools/releases/platform-tools
    echo and add it to your system Environment Variables.
) else (
    echo [+] ADB detected successfully!
)

:: 4. Run the Daemon Silently in background
echo [*] Launching phone_post_bot.py silently in the background...
start "" wscript.exe start_phone_bot.vbs
echo [+] Launcher started successfully!

echo.
echo ==========================================================
echo   Setup Completed! The bot is now running in the background.
echo   Check your task manager (python processes) to monitor it.
echo ==========================================================
pause
