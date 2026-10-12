import zipfile
import re

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    data = z.read('classes11.dex')

pos = 0
for tag in [b'[YT-Client]', b'[YT-POTProvider]', b'[YT-Meriyah]', b'[YT-WebPOTGen]', b'[YT-Utils]']:
    print(f"\n==================== Search for {tag.decode()} ====================")
    pos = 0
    while True:
        pos = data.find(tag, pos)
        if pos == -1: break
        snippet = data[max(0, pos - 150): min(len(data), pos + 350)]
        clean = "".join(chr(c) if 32 <= c <= 126 or c == 10 else "." for c in snippet)
        print(f"[{pos}]: {clean}")
        pos += len(tag)
