#!/usr/bin/env python3
"""
Generate a large multiple-choice trivia dataset using a local Ollama model.

Usage:
    python generate_trivia_dataset.py --model llama3.1:8b --target 3000

Requirements:
    pip install requests --break-system-packages
    Ollama running locally with a model pulled, e.g.:
        ollama pull llama3.1:8b

Output:
    A JSON file (default: trivia_dataset.json) containing an array of:
        {
          "id": str,
          "text": str,
          "choices": [str, str, str, str],
          "correctIndex": int (0-3),
          "difficulty": "easy" | "medium" | "hard",
          "category": str
        }

The script is resumable: if the output file already exists, it loads what's
there, skips duplicate questions, and keeps generating until it hits the
target count. You can stop it (Ctrl+C) and re-run it later to continue.
"""

import argparse
import json
import re
import sys
import time
import uuid
from pathlib import Path

import requests

OLLAMA_URL = "http://localhost:11434/api/generate"

CATEGORIES = [
    "general knowledge",
    "science",
    "history",
    "geography",
    "music",
    "sports",
    "movies and tv",
    "literature",
    "technology",
    "food and drink",
]

# Roughly even split across difficulties. Adjust weights if you want more
# easy questions for a mass-market feel, or more hard ones for a "hard mode".
DIFFICULTIES = ["easy", "medium", "hard"]

BATCH_SIZE = 10  # questions requested per model call — small batches = more reliable JSON

PROMPT_TEMPLATE = """You are generating multiple-choice trivia questions for a mobile quiz app.

Generate exactly {batch_size} trivia questions in the category "{category}" at "{difficulty}" difficulty.

Rules:
- Each question must have exactly 4 answer choices.
- Exactly one choice must be correct.
- Choices must be plausible and not obviously wrong (no joke answers).
- Questions must be factually accurate. Do not invent facts.
- Do not repeat well-known questions like "What is the capital of France".
- Keep question text under 20 words.
- Keep each choice under 6 words.

Respond with ONLY a valid JSON array, no prose, no markdown fences, no explanation.
Each element must look exactly like this:
{{"question": "...", "choices": ["...", "...", "...", "..."], "correctIndex": 0, "category": "{category}", "difficulty": "{difficulty}"}}
"""


def normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


def extract_json_array(raw: str):
    """Pull the first JSON array out of a model response, tolerating stray text/fences."""
    raw = raw.strip()
    raw = re.sub(r"^```(json)?", "", raw).strip()
    raw = re.sub(r"```$", "", raw).strip()
    start = raw.find("[")
    end = raw.rfind("]")
    if start == -1 or end == -1 or end < start:
        return None
    snippet = raw[start:end + 1]
    try:
        return json.loads(snippet)
    except json.JSONDecodeError:
        return None


def validate_item(item) -> bool:
    if not isinstance(item, dict):
        return False
    if not isinstance(item.get("question"), str) or not item["question"].strip():
        return False
    choices = item.get("choices")
    if not isinstance(choices, list) or len(choices) != 4:
        return False
    if not all(isinstance(c, str) and c.strip() for c in choices):
        return False
    if len(set(normalize(c) for c in choices)) != 4:
        return False  # duplicate choices
    idx = item.get("correctIndex")
    if not isinstance(idx, int) or idx < 0 or idx > 3:
        return False
    if item.get("difficulty") not in DIFFICULTIES:
        return False
    if not isinstance(item.get("category"), str) or not item["category"].strip():
        return False
    return True


def call_ollama(model: str, prompt: str, timeout: int = 300) -> str:
    resp = requests.post(
        OLLAMA_URL,
        json={
            "model": model,
            "prompt": prompt,
            "stream": False,
            "options": {
                "temperature": 0.9,
                "num_predict": 2000,  # enough tokens for a full batch; raise if using bigger batch_size
            },
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    return resp.json().get("response", "")


def load_existing(path: Path):
    if not path.exists():
        return []
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        if isinstance(data, list):
            return data
    except (json.JSONDecodeError, OSError):
        pass
    return []


def save(path: Path, dataset):
    tmp_path = path.with_suffix(".tmp")
    with open(tmp_path, "w", encoding="utf-8") as f:
        json.dump(dataset, f, indent=2, ensure_ascii=False)
    tmp_path.replace(path)


def main():
    parser = argparse.ArgumentParser(description="Generate a trivia dataset via local Ollama.")
    parser.add_argument("--model", default="llama3.1:8b", help="Ollama model name (default: llama3.1:8b)")
    parser.add_argument("--target", type=int, default=3000, help="Total number of questions to generate")
    parser.add_argument("--output", default="trivia_dataset.json", help="Output JSON file path")
    parser.add_argument("--batch-size", type=int, default=BATCH_SIZE, help="Questions requested per model call")
    parser.add_argument("--max-retries", type=int, default=3, help="Retries per batch on invalid/failed JSON")
    parser.add_argument("--debug", action="store_true", help="Print raw model output when JSON parsing fails")
    args = parser.parse_args()

    output_path = Path(args.output)
    dataset = load_existing(output_path)
    seen = {normalize(item["question"]) for item in dataset if isinstance(item, dict) and "question" in item}

    print(f"Starting with {len(dataset)} existing questions. Target: {args.target}.")
    print(f"Model: {args.model} | Output: {output_path}")

    cat_idx = 0
    diff_idx = 0
    consecutive_failures = 0

    try:
        while len(dataset) < args.target:
            category = CATEGORIES[cat_idx % len(CATEGORIES)]
            difficulty = DIFFICULTIES[diff_idx % len(DIFFICULTIES)]
            cat_idx += 1
            if cat_idx % len(CATEGORIES) == 0:
                diff_idx += 1

            prompt = PROMPT_TEMPLATE.format(
                batch_size=args.batch_size, category=category, difficulty=difficulty
            )

            success = False
            for attempt in range(1, args.max_retries + 1):
                try:
                    raw = call_ollama(args.model, prompt)
                except requests.RequestException as e:
                    print(f"  [warn] Ollama request failed ({e}), retrying ({attempt}/{args.max_retries})...")
                    time.sleep(2)
                    continue

                items = extract_json_array(raw)
                if items is None:
                    print(f"  [warn] Could not parse JSON for {category}/{difficulty}, retrying ({attempt}/{args.max_retries})...")
                    if args.debug:
                        print("  ---- raw model output (first 800 chars) ----")
                        print("  " + raw[:800].replace("\n", "\n  "))
                        print("  ---- end raw output ----")
                    continue

                added_this_batch = 0
                for item in items:
                    if not validate_item(item):
                        continue
                    key = normalize(item["question"])
                    if key in seen:
                        continue
                    seen.add(key)
                    dataset.append({
                        "id": str(uuid.uuid4()),
                        "text": item["question"].strip(),
                        "choices": [c.strip() for c in item["choices"]],
                        "correctIndex": item["correctIndex"],
                        "difficulty": item["difficulty"],
                        "category": item["category"],
                    })
                    added_this_batch += 1

                if added_this_batch > 0:
                    success = True
                    consecutive_failures = 0
                    print(f"  [{category}/{difficulty}] +{added_this_batch} (total: {len(dataset)}/{args.target})")
                    break
                else:
                    print(f"  [warn] Batch for {category}/{difficulty} had no valid new questions, retrying ({attempt}/{args.max_retries})...")

            if not success:
                consecutive_failures += 1
                print(f"  [error] Giving up on this batch after {args.max_retries} attempts.")
                if consecutive_failures >= 5:
                    print("Too many consecutive failed batches in a row. Is Ollama running and the model pulled?")
                    print(f"Try: ollama pull {args.model}")
                    break

            save(output_path, dataset)

            if len(dataset) >= args.target:
                break

    except KeyboardInterrupt:
        print("\nInterrupted. Progress has been saved — re-run the same command to continue.")

    save(output_path, dataset)
    print(f"\nDone. {len(dataset)} questions saved to {output_path}")
    print("Note: run a review pass before shipping — spot-check a sample for factual accuracy,")
    print("especially at 'hard' difficulty, since even strong local models can make mistakes.")


if __name__ == "__main__":
    main()