Set WshShell = CreateObject("WScript.Shell")
' Run the Python ADB daemon script silently in the background (0 = hide window, false = do not wait)
WshShell.Run "python phone_post_bot.py", 0, false
