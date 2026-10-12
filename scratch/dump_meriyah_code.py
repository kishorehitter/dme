import zipfile

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    data = z.read('classes11.dex')

# Find all occurrences of strings starting with [YT-Meriyah] or related JS strings
import re
pos = 0
while True:
    pos = data.find(b'[YT-Meriyah]', pos)
    if pos == -1: break
    snippet = data[max(0, pos - 200): min(len(data), pos + 400)]
    clean = "".join(chr(c) if 32 <= c <= 126 or c == 10 else "." for c in snippet)
    print(f"--- [YT-Meriyah] at {pos} ---")
    print(clean)
    pos += 12
