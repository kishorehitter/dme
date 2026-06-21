#!/usr/bin/env python3
"""
encode_cookies.py — One-time helper to encode YouTube cookies for Render
========================================================================

USAGE:
  1. Export cookies from YouTube (while logged into a THROWAWAY Google account):
     - Chrome: Install "Get cookies.txt LOCALLY" extension
       → Visit youtube.com → click extension → Export → Save as "cookies.txt"

  2. Place cookies.txt in the same folder as this script.

  3. Run:  python encode_cookies.py

  4. Copy the printed value into Render:
       Dashboard → Your Service → Environment → New Variable
       Key:   YOUTUBE_COOKIES_B64
       Value: <paste the printed string>

  5. Save and redeploy. Stream extraction will now work!

  ⚠️  IMPORTANT:
  - Use a THROWAWAY Google account, NOT your personal one
  - Re-export cookies every 2–4 weeks, or whenever streams stop working
  - NEVER commit cookies.txt to git (it is already in .gitignore)
"""

import base64
import sys
import os

def encode_cookies(path: str = 'cookies.txt') -> str:
    if not os.path.exists(path):
        print(f'❌ File not found: {path}')
        print('   Export cookies from YouTube using the browser extension,')
        print('   then run this script again.')
        sys.exit(1)

    with open(path, 'rb') as f:
        data = f.read()

    encoded = base64.b64encode(data).decode('ascii')
    return encoded


if __name__ == '__main__':
    cookie_file = sys.argv[1] if len(sys.argv) > 1 else 'cookies.txt'
    result = encode_cookies(cookie_file)

    print('\n' + '=' * 70)
    print('✅ YOUTUBE_COOKIES_B64 value (copy this entire string):')
    print('=' * 70)
    print(result)
    print('=' * 70)
    print(f'\nLength: {len(result)} characters')
    print('\nNext step: Paste this value into Render → Environment → YOUTUBE_COOKIES_B64')
    print('           Then redeploy your service.\n')
