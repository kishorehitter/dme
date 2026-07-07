import json

with open('backend/test_trivia.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

valid_starts = ('what', 'which', 'who', 'how', 'where', 'when', 'why', 'name', 'is', 'are', 'can', 'do', 'does', 'in which', 'at what', 'to what')

changed_count = 0

for item in data:
    if item.get('category') in ('health', 'places'):
        text = item['text']
        lower_text = text.lower()
        
        if not any(lower_text.startswith(s) for s in valid_starts):
            # Check if it has 'which', 'what', 'who' etc. in the middle
            if not any(w in lower_text for w in (' which ', ' what ', ' who ', ' where ', ' how ', ' why ')):
                # Capital of France? -> What is the capital of France?
                first_letter = text[0].lower()
                rest = text[1:]
                
                # Check for questions starting with "The " which we saw earlier, e.g., "The Heimlich maneuver is performed to treat?"
                if lower_text.startswith("the "):
                    # Might be better left alone or fixed differently, but let's see. 
                    # If it's a fill-in-the-blank, we could leave it. 
                    pass
                else:
                    item['text'] = f"What is the {first_letter}{rest}"
                    changed_count += 1

print(f"Changed {changed_count} questions.")

with open('backend/test_trivia.json', 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=2)
