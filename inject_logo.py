import base64
import re
import os

# Read image
img_path = r'C:\Dev\AndroidApp\DME\android\app\src\main\res\mipmap-xxxhdpi\ic_launcher.png'
with open(img_path, 'rb') as f:
    b64_str = base64.b64encode(f.read()).decode('utf-8')

# Read html
html_path = r'C:\Dev\AndroidApp\backend\templates\download_page.html'
with open(html_path, 'r', encoding='utf-8') as f:
    html = f.read()

# Replace the emoji with an img tag
img_tag = f'<img src="data:image/png;base64,{b64_str}" class="app-icon" alt="DME Logo" style="background: none; box-shadow: none; object-fit: contain; width: 100px; height: 100px;" />'
html = re.sub(r'<div class="app-icon">💬</div>', img_tag, html)

# Write back
with open(html_path, 'w', encoding='utf-8') as f:
    f.write(html)

print('Successfully injected base64 logo into HTML')
