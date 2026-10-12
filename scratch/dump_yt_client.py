import zipfile

apk_path = r"C:\Users\kishore\.gemini\antigravity-cli\brain\35f8a27a-ba67-437f-8da1-ac8211d26b99\scratch\rave_base.apk"
with zipfile.ZipFile(apk_path, 'r') as z:
    data = z.read('classes11.dex')

pos = data.find(b'YoutubeClient.kt')
print("YoutubeClient.kt at:", pos)
snippet = data[max(0, pos - 500): min(len(data), pos + 2500)]
clean = "".join(chr(c) if 32 <= c <= 126 or c == 10 else "." for c in snippet)
print(clean)
