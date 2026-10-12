import zipfile

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    data = z.read('classes11.dex')

for phrase in [b'fetchClients', b'orderedResults', b'YoutubeHttpDataSource', b'SimplePoTokenProvider']:
    print(f"\n==================== Search for {phrase.decode()} ====================")
    pos = 0
    count = 0
    while count < 5:
        pos = data.find(phrase, pos)
        if pos == -1: break
        snippet = data[max(0, pos - 80): min(len(data), pos + 250)]
        clean = "".join(chr(c) if 32 <= c <= 126 or c == 10 else "." for c in snippet)
        print(f"[{pos}]: {clean}")
        pos += len(phrase)
        count += 1
