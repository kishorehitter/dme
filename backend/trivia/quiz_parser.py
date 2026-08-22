import re
import io
from typing import Dict, Any, List, Optional

try:
    import pypdf
except ImportError:
    pypdf = None


def extract_text_from_pdf_stream(stream_bytes: bytes) -> str:
    """
    Extracts plain text from raw PDF bytes.
    Uses pypdf for high-accuracy text extraction from compressed PDF streams.
    """
    if pypdf is None:
        raise ImportError("pypdf library is required for PDF parsing. Please install pypdf.")

    reader = pypdf.PdfReader(io.BytesIO(stream_bytes))
    extracted_pages = []
    
    for page in reader.pages:
        page_text = page.extract_text()
        if page_text:
            extracted_pages.append(page_text)
            
    return "\n".join(extracted_pages)


def parse_quiz_text(raw_text: str, category: str = "general", difficulty: str = "medium") -> Dict[str, Any]:
    """
    Parses raw text extracted from a quiz PDF (numbered questions, A-D choices,
    correct answer marked with a leading "*") into trivia JSON format.

    Deterministic regex parser — no AI, zero guessing. If any question
    doesn't match the expected structure, it is recorded in `issues` with
    precise context so the user can fix the PDF.
    """
    text = raw_text

    # Insert a newline before any A-D option or numbered question glued to the previous line
    # (e.g. "Earth?A. 5" or "UnitB. Central Power Unit")
    text = re.sub(r'(?<=[^\n*])(?=\*?[A-D]\.\s)', '\n', text)
    text = re.sub(r'(?<=[^\n])(?=\d+\.\s)', '\n', text)

    # Split into question blocks starting with a number followed by a period (e.g., "1. ")
    raw_blocks = re.split(r'\n?(?=\d+\.\s)', text)
    blocks = [b.strip() for b in raw_blocks if b.strip()]

    questions: List[Dict[str, Any]] = []
    issues: List[Dict[str, Any]] = []

    for block in blocks:
        lines = [line.strip() for line in block.split('\n') if line.strip()]
        if not lines:
            continue

        question_number_match = re.match(r'^(\d+)\.\s*(.*)$', lines[0])
        if not question_number_match:
            issues.append({
                'questionNumber': None,
                'reason': "Couldn't find a numbered question at the start of this block.",
                'snippet': block[:80],
            })
            continue

        question_number = question_number_match.group(1)
        question_text = question_number_match.group(2).strip()

        if not question_text:
            issues.append({
                'questionNumber': question_number,
                'reason': "Question text is empty — check for a missing question after the number.",
                'snippet': block[:80],
            })
            continue

        choices: List[Optional[str]] = [None, None, None, None]
        correct_index = -1
        star_count = 0

        for line in lines[1:]:
            opt_match = re.match(r'^(\*)?([A-D])\.\s*(.+)$', line)
            if not opt_match:
                continue

            star, letter, choice_text = opt_match.groups()
            idx = ord(letter.upper()) - ord('A')
            if 0 <= idx < 4:
                choices[idx] = choice_text.strip()
                if star:
                    correct_index = idx
                    star_count += 1

        missing_choices = [chr(65 + i) for i, c in enumerate(choices) if c is None]

        if missing_choices:
            issues.append({
                'questionNumber': question_number,
                'reason': f"Missing choice(s): {', '.join(missing_choices)}. Expected exactly 4 options labeled A-D.",
                'snippet': question_text[:60],
            })
            continue

        if star_count == 0:
            issues.append({
                'questionNumber': question_number,
                'reason': "No correct answer marked. Put a '*' directly before the correct option's letter (e.g. '*B. Paris').",
                'snippet': question_text[:60],
            })
            continue

        if star_count > 1:
            issues.append({
                'questionNumber': question_number,
                'reason': f"{star_count} options are marked as correct with '*'. Only one option should have a '*'.",
                'snippet': question_text[:60],
            })
            continue

        questions.append({
            'text': question_text,
            'choices': choices,
            'correctIndex': correct_index,
            'difficulty': difficulty,
            'category': category,
        })

    return {
        'questions': questions,
        'issues': issues,
        'totalParsed': len(questions),
        'totalFound': len(blocks),
        'isFullyValid': len(issues) == 0 and len(questions) > 0,
    }
