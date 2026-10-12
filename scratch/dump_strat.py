import zipfile

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    dex_bytes = z.read('classes11.dex')

pos = 0
while True:
    pos = dex_bytes.find(b'availableStrategies', pos)
    if pos == -1: break
    snippet = dex_bytes[max(0, pos - 100): min(len(dex_bytes), pos + 300)]
    clean = "".join(chr(c) if 32 <= c <= 126 or c == 10 else "." for c in snippet)
    print(f"availableStrategies at {pos}:")
    print("  ", clean)
    pos += 19
