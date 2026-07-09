#!/usr/bin/env python3
"""
Fetch Wikipedia thumbnails for trivia questions and store them offline.

This script processes a JSON list of trivia questions:
1. Queries Wikipedia API for the correct answer to find the official thumbnail image.
2. Downloads and resizes the image to a tiny size (e.g., 100x100 pixels) using Pillow.
3. Encodes it into Base64 (saving it inline in the JSON) and saves a local copy of the image.

Usage:
    python fetch_wiki_thumbnails.py --input ../DME/src/assets/trivia_questions.json --output ../DME/src/assets/trivia_questions_with_images.json
"""

import os
import sys
import json
import base64
import urllib.request
import urllib.parse
from PIL import Image
import io
import argparse

def get_wikipedia_thumbnail_url(title):
    params = {
        "action": "query",
        "titles": title,
        "prop": "pageimages",
        "format": "json",
        "pithumbsize": 200,
        "redirects": 1
    }
    query_string = urllib.parse.urlencode(params)
    url = f"https://en.wikipedia.org/w/api.php?{query_string}"
    
    headers = {
        "User-Agent": "TriviaAppImageFetcher/1.0 (kishorehitter@gmail.com)"
    }
    
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            
        pages = data.get("query", {}).get("pages", {})
        for page_id, page_data in pages.items():
            if "thumbnail" in page_data:
                return page_data["thumbnail"]["source"]
    except Exception as e:
        print(f"  [Error] Wikipedia lookup failed for '{title}': {e}")
    return None

def download_and_resize(url, max_size=(100, 100)):
    headers = {
        "User-Agent": "TriviaAppImageFetcher/1.0 (kishorehitter@gmail.com)"
    }
    req = urllib.request.Request(url, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=10) as response:
            img_bytes = response.read()
        
        img = Image.open(io.BytesIO(img_bytes))
        if img.mode != 'RGB':
            img = img.convert('RGB')
            
        img.thumbnail(max_size)
        
        # Save to buffer as JPEG with standard compression
        buffer = io.BytesIO()
        img.save(buffer, format="JPEG", quality=80)
        return buffer.getvalue()
    except Exception as e:
        print(f"  [Error] Failed to download or resize: {e}")
    return None

def main():
    parser = argparse.ArgumentParser(description="Fetch and resize Wikipedia thumbnails offline.")
    parser.add_argument("--input", default="../DME/src/assets/trivia_questions.json", help="Input questions JSON path")
    parser.add_argument("--output", default="../DME/src/assets/trivia_questions_with_images.json", help="Output JSON path")
    parser.add_argument("--limit", type=int, default=10, help="Limit number of questions to process (for testing)")
    parser.add_argument("--size", type=int, default=100, help="Max thumbnail size (width/height)")
    args = parser.parse_args()

    input_path = Path(args.input) if 'Path' in globals() else args.input
    
    if not os.path.exists(input_path):
        print(f"Error: Input file '{input_path}' not found.")
        sys.exit(1)

    with open(input_path, "r", encoding="utf-8") as f:
        questions = json.load(f)

    print(f"Loaded {len(questions)} questions. Processing up to {args.limit} items...")
    
    os.makedirs("thumbnails", exist_ok=True)
    
    processed_count = 0
    updated_questions = []

    for index, q in enumerate(questions):
        if processed_count >= args.limit:
            # Copy remaining questions as is
            updated_questions.append(q)
            continue
            
        choices = q.get("choices", [])
        correct_idx = q.get("correctIndex", 0)
        
        if not choices or correct_idx >= len(choices):
            updated_questions.append(q)
            continue
            
        correct_answer = choices[correct_idx]
        print(f"[{processed_count + 1}/{args.limit}] Querying Wikipedia for: {correct_answer}")
        
        img_url = get_wikipedia_thumbnail_url(correct_answer)
        if img_url:
            img_bytes = download_and_resize(img_url, (args.size, args.size))
            if img_bytes:
                # Convert to base64 Data URI
                b64_str = base64.b64encode(img_bytes).decode('utf-8')
                data_uri = f"data:image/jpeg;base64,{b64_str}"
                
                # Save as local asset file
                safe_name = "".join([c if c.isalnum() else "_" for c in correct_answer.lower()])
                local_filename = f"{safe_name}.jpg"
                local_path = os.path.join("thumbnails", local_filename)
                
                with open(local_path, "wb") as img_file:
                    img_file.write(img_bytes)
                
                # Append offline images to question schema
                q["image_offline_base64"] = data_uri
                q["image_offline_file"] = local_filename
                processed_count += 1
                print(f"  -> Success: Saved {local_path} and added Base64.")
            else:
                print(f"  -> Failed to download/resize image.")
        else:
            print(f"  -> No thumbnail found on Wikipedia.")
            
        updated_questions.append(q)

    # Save output JSON
    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(updated_questions, f, indent=2, ensure_ascii=False)
        
    print(f"\nDone! Processed {processed_count} questions. Saved results to {args.output}")

if __name__ == "__main__":
    main()
