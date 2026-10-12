import zipfile
import re

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    data = z.read('classes11.dex')

# Extract all ASCII strings of length >= 4
strings = re.findall(b'[\x20-\x7e]{4,}', data)
print(f"Total strings found: {len(strings)}")

keywords = [b'YT_PREPROCESS', b'_yt_result', b'youtubejs.extractor', b'meriyah', b'decipherBatch', b'decipher', b'preprocessAndEval', b'window._yt', b'ensureWebView']
for s in strings:
    for kw in keywords:
        if kw.lower() in s.lower():
            print(f"[{kw.decode()}]: {s.decode('utf-8', errors='ignore')}")
