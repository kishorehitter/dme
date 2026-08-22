export interface Question {
  text: string;
  choices: string[];
  correctIndex: number;
  difficulty?: 'easy' | 'medium' | 'hard';
  category?: string;
  set?: string;
}

export interface ParseError {
  line: number;
  message: string;
}

export interface ParseResult {
  success: boolean;
  questions: Question[];
  errors: ParseError[];
}

/**
 * Helper to identify and ignore PDF/DOCX binary stream noise & metadata lines
 */
function isBinaryOrMetadataLine(line: string): boolean {
  if (!line || line.length === 0) return true;
  // Ignore PDF metadata dates: D:20220318...
  if (/^D:\d{8}/i.test(line)) return true;
  // Ignore PDF syntax/keywords
  if (/^\/?[A-Z][a-zA-Z0-9]*\b/.test(line) && (line.includes('FlateDecode') || line.includes('MediaBox') || line.includes('Font') || line.includes('CreationDate') || line.includes('ModDate') || line.includes('Parent') || line.includes('Type') || line.includes('Subtype') || line.includes('ProcSet') || line.includes('Length') || line.includes('Encoding'))) return true;
  // Ignore PDF stream structural markers
  if (/^(?:stream|endstream|endobj|obj|xref|trailer|startxref|%PDF-)/i.test(line)) return true;
  // Ignore PDF font names or object refs like /F1, /C2_0, 12 0 R
  if (/^\/[A-Z0-9._-]+$/i.test(line) || /^\d+\s+\d+\s+R$/i.test(line)) return true;
  // Ignore unprintable binary bytes
  if (/[^\x20-\x7E\t\r\n]/.test(line)) return true;
  return false;
}

/**
 * Parses raw text, CSV, JSON, DOCX, or PDF text content into Trivia Question objects.
 */
export function parseQuestionFile(content: string, fileExtension: string): ParseResult {
  const ext = fileExtension.toLowerCase().replace('.', '');
  
  if (ext === 'json') {
    return parseJsonFormat(content);
  } else if (ext === 'csv') {
    return parseCsvFormat(content);
  } else if (ext === 'docx' || ext === 'doc') {
    const extractedText = extractDocxText(content);
    return parseTxtFormat(extractedText);
  } else if (ext === 'pdf') {
    const extractedText = extractPdfText(content);
    return parseTxtFormat(extractedText);
  } else {
    // Default to flexible TXT parsing
    return parseTxtFormat(content);
  }
}

/**
 * Extracts plain text lines from raw DOCX content (extracts XML <w:t> nodes).
 */
function extractDocxText(rawContent: string): string {
  let decoded = rawContent;
  if (!rawContent.includes('<w:t') && !rawContent.includes('word/')) {
    try {
      if (typeof atob === 'function') decoded = atob(rawContent);
    } catch {}
  }

  // Extract <w:t> XML nodes
  if (decoded.includes('<w:t')) {
    const textNodes = decoded.match(/<w:t[^>]*>(.*?)<\/w:t>/g);
    if (textNodes && textNodes.length > 0) {
      return textNodes
        .map(node => node.replace(/<[^>]+>/g, '').trim())
        .filter(t => t.length > 0 && !isBinaryOrMetadataLine(t))
        .join('\n');
    }
  }
  // Fallback: strip XML tags and non-printable characters
  return decoded
    .replace(/<[^>]+>/g, ' ')
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !isBinaryOrMetadataLine(line))
    .join('\n');
}

/**
 * Extracts clean text from PDF streams.
 */
function extractPdfText(rawContent: string): string {
  let decoded = rawContent;
  if (!rawContent.includes('%PDF') && !rawContent.includes('stream')) {
    try {
      if (typeof atob === 'function') decoded = atob(rawContent);
    } catch {}
  }

  // 1. Extract all text inside parentheses: (text) Tj or (text) TJ or [(text)] TJ or standalone (text)
  const parenthesizedMatches = decoded.match(/\(([^()]{1,500})\)/g);
  if (parenthesizedMatches && parenthesizedMatches.length > 0) {
    const extractedLines: string[] = [];
    parenthesizedMatches.forEach(m => {
      const clean = m.replace(/^[(\s]+|[)\s]+$/g, '').trim();
      if (clean.length > 0 && !isBinaryOrMetadataLine(clean)) {
        if (!/^\/[A-Z0-9_-]+/i.test(clean) && !/^\d+\s+\d+\s+obj/i.test(clean)) {
          extractedLines.push(clean);
        }
      }
    });

    if (extractedLines.length > 0) {
      return extractedLines.join('\n');
    }
  }

  // 2. Fallback: Filter printable ASCII lines
  return decoded
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line.length > 0 && !isBinaryOrMetadataLine(line))
    .join('\n');
}

/**
 * Flexible TXT / Word / PDF parser:
 * Supports:
 * - Questions: Q1:, Q1., 1., 1), Question 1:
 * - Options: A:, A., a), (A), 1)
 * - Correct Answer: * at end of option OR "Answer: B" line
 */
function parseTxtFormat(content: string): ParseResult {
  const lines = content.split(/\r?\n/);
  const questions: Question[] = [];
  const errors: ParseError[] = [];

  let currentQuestionText = '';
  let choices: string[] = [];
  let correctIndex = -1;

  const questionRegex = /^(?:[Qq]\d*[:.]|\d+[\.\)]|Question\s*\d+[:.]?)\s*(.+)/i;
  const choiceRegex = /^(?:[A-Da-d][:\.\)]|\([A-Da-d]\))\s*(.+)/;
  const answerLineRegex = /^(?:Answer|Ans|Correct|Key)[:.]\s*([A-Da-d1-4])/i;

  const pushCurrentQuestion = (lineNum: number) => {
    if (currentQuestionText) {
      if (choices.length === 4 && correctIndex !== -1) {
        questions.push({
          text: currentQuestionText,
          choices,
          correctIndex,
          difficulty: 'medium',
          category: 'custom',
        });
      } else if (choices.length > 0 || currentQuestionText.length > 0) {
        errors.push({
          line: lineNum,
          message: `Question "${currentQuestionText.slice(0, 30)}..." requires 4 options (A,B,C,D) and 1 marked correct answer (e.g. *, or 'Answer: B'). Found ${choices.length} options.`,
        });
      }
    }
    currentQuestionText = '';
    choices = [];
    correctIndex = -1;
  };

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    const lineNum = index + 1;

    if (!trimmed || isBinaryOrMetadataLine(trimmed)) {
      return;
    }

    // Check for explicit "Answer: B" or "Ans: C" line
    const ansMatch = trimmed.match(answerLineRegex);
    if (ansMatch && currentQuestionText) {
      const val = ansMatch[1].toUpperCase();
      if (val === 'A' || val === '1') correctIndex = 0;
      else if (val === 'B' || val === '2') correctIndex = 1;
      else if (val === 'C' || val === '3') correctIndex = 2;
      else if (val === 'D' || val === '4') correctIndex = 3;
      return;
    }

    // Check if new Question line starts
    const qMatch = trimmed.match(questionRegex);
    if (qMatch) {
      pushCurrentQuestion(lineNum);
      currentQuestionText = qMatch[1].trim();
      return;
    }

    // Check if Choice line starts
    const cMatch = trimmed.match(choiceRegex);
    if (cMatch) {
      // If no question statement has started yet, ignore preamble/noise lines matching choice patterns
      if (!currentQuestionText) {
        return;
      }

      let optionText = cMatch[1].trim();
      let isCorrect = false;

      if (optionText.endsWith('*')) {
        isCorrect = true;
        optionText = optionText.slice(0, -1).trim();
      }

      if (isCorrect) {
        correctIndex = choices.length;
      }

      if (choices.length < 4) {
        choices.push(optionText);
      }
      return;
    }

    // Continuation of current question text before options start
    if (currentQuestionText && choices.length === 0) {
      currentQuestionText += ' ' + trimmed;
    }
  });

  // Final question check
  pushCurrentQuestion(lines.length);

  if (questions.length === 0 && errors.length === 0) {
    errors.push({ line: 1, message: 'No valid questions found in file. Please ensure questions start with 1. or Q: and options are A, B, C, D with correct answer marked (*). Alternatively, tap "Create Quiz in App" to type or paste your questions directly!' });
  }

  return {
    success: errors.length === 0 && questions.length > 0,
    questions,
    errors,
  };
}

/**
 * CSV Format Parser
 */
function parseCsvFormat(content: string): ParseResult {
  const lines = content.split(/\r?\n/).filter(l => l.trim().length > 0);
  const questions: Question[] = [];
  const errors: ParseError[] = [];

  if (lines.length <= 1) {
    return { success: false, questions: [], errors: [{ line: 1, message: 'CSV file is empty or missing data rows.' }] };
  }

  const dataRows = lines.slice(1);

  dataRows.forEach((rowStr, idx) => {
    const lineNum = idx + 2;
    const cols = rowStr.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || rowStr.split(',');
    const cleanCols = cols.map(c => c.replace(/^"|"$/g, '').trim());

    if (cleanCols.length < 6) {
      errors.push({ line: lineNum, message: `Row does not have 6 columns (question, A, B, C, D, answer).` });
      return;
    }

    const [qText, optA, optB, optC, optD, ans] = cleanCols;
    let correctIdx = -1;
    const ansUpper = ans.toUpperCase().trim();

    if (ansUpper === 'A' || ansUpper === '1' || ansUpper === optA.toUpperCase()) correctIdx = 0;
    else if (ansUpper === 'B' || ansUpper === '2' || ansUpper === optB.toUpperCase()) correctIdx = 1;
    else if (ansUpper === 'C' || ansUpper === '3' || ansUpper === optC.toUpperCase()) correctIdx = 2;
    else if (ansUpper === 'D' || ansUpper === '4' || ansUpper === optD.toUpperCase()) correctIdx = 3;

    if (correctIdx === -1) {
      errors.push({ line: lineNum, message: `Invalid answer column '${ans}'. Expected A, B, C, or D.` });
      return;
    }

    questions.push({
      text: qText,
      choices: [optA, optB, optC, optD],
      correctIndex: correctIdx,
      difficulty: 'medium',
      category: 'custom',
    });
  });

  return {
    success: errors.length === 0 && questions.length > 0,
    questions,
    errors,
  };
}

/**
 * JSON Format Parser
 */
function parseJsonFormat(content: string): ParseResult {
  const errors: ParseError[] = [];
  try {
    const raw = JSON.parse(content);
    if (!Array.isArray(raw)) {
      return { success: false, questions: [], errors: [{ line: 1, message: 'JSON root must be an array of question objects.' }] };
    }

    const questions: Question[] = [];
    raw.forEach((item, idx) => {
      if (!item.text || !Array.isArray(item.choices) || item.choices.length !== 4 || typeof item.correctIndex !== 'number') {
        errors.push({ line: idx + 1, message: `Item ${idx + 1}: Must contain 'text', 4 'choices', and 'correctIndex' (0-3).` });
        return;
      }

      questions.push({
        text: item.text,
        choices: item.choices,
        correctIndex: item.correctIndex,
        difficulty: item.difficulty || 'medium',
        category: 'custom',
      });
    });

    return {
      success: errors.length === 0 && questions.length > 0,
      questions,
      errors,
    };
  } catch (err: any) {
    return {
      success: false,
      questions: [],
      errors: [{ line: 1, message: `Invalid JSON syntax: ${err.message}` }],
    };
  }
}
