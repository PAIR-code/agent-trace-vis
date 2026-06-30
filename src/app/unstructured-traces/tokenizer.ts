/**
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     https://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

/**
 * @fileoverview Tokenizer for splitting reasoning traces into chunks by word,
 * sentence, paragraph, or cognitive-shift boundaries.
 */

export type TokenizeMode = 'word' | 'sentence' | 'word_context' | 'steps' | 'paragraphs';

/**
 * Tokenize a text string according to the given mode.
 * Returns an array of token strings (preserving whitespace for rendering).
 */
export function tokenize(text: string, mode: TokenizeMode): string[] {
  switch (mode) {
    case 'word':
      return tokenizeByWord(text);
    case 'sentence':
      return tokenizeBySentence(text);
    case 'word_context':
      return tokenizeByWordContext(text);
    case 'steps':
      return segmentReasoningTrace(text);
    case 'paragraphs':
      return tokenizeByParagraphs(text);
    default:
      return tokenizeByWord(text);
  }
}

/**
 * Converts an unstructured long CoT reasoning trace into a sequential list
 * of discrete cognitive chunks (nodes).
 */
export function segmentReasoningTrace(rawText: string, simpleMode = true): string[] {
  if (simpleMode) {
    // Chunk based on headers (lines starting with #) or lines starting with "step" (case-insensitive)
    // We split by a newline followed by one or more # and a space, or "step".
    const chunks = rawText.split(/\n(?=#+\s|step\b)/i);
    return chunks.map(c => c.trim()).filter(c => c.length > 0);
  }

  // 1. Use the full text (do not ignore the final answer or text outside think tags)
  const reasoningText = rawText;

  // 2. Define cognitive shift triggers
  // These often signal the start of a new behavioral bond (Reflection, Exploration, etc.)
  const shiftTriggers = [
    'Wait,', 'Actually,', 'Hold on,', 'Let me re-read',    // Reflection
    'Alternatively,', 'Another approach', "Let's try",      // Exploration
    'Therefore,', 'Thus,', 'It follows that',               // Deduction
  ];

  // Build a regex pattern that looks for these triggers at the start of a sentence
  const escapedTriggers = shiftTriggers.map(t =>
    t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  );
  const triggerPattern = new RegExp(
    `(?=(?:${escapedTriggers.join('|')}))`,
  );

  // 3. Initial Hard Splits: Paragraphs
  // Split by double newlines, keeping the text intact
  const rawParagraphs = reasoningText.split(/\n\n/);

  const fineChunks: string[] = [];

  // 4. Fine-Grained Splitting (Discourse Markers & Lists)
  for (const para of rawParagraphs) {
    const trimmed = para.trim();
    if (!trimmed) continue;

    // If a paragraph contains a markdown list, split those into sub-steps
    if (/\n\s*[-*]\s|\n\s*\d+\.\s/.test(trimmed)) {
      const listItems = trimmed.split(/\n(?=\s*[-*]\s|\s*\d+\.\s)/);
      for (const item of listItems) {
        const s = item.trim();
        if (s) fineChunks.push(s);
      }
      continue;
    }

    // Split mid-paragraph if the model suddenly shifts cognitive gears
    // e.g., "The answer is 4. Wait, let me check that."
    //     -> ["The answer is 4.", "Wait, let me check that."]
    const subChunks = trimmed.split(triggerPattern);

    for (const sub of subChunks) {
      const s = sub.trim();
      if (s) fineChunks.push(s);
    }
  }

  // 5. Cleanup & Merging (The Light "Judge" Pass)
  const MIN_CHAR_LENGTH = 40;
  const finalChunks: string[] = [];

  for (const chunk of fineChunks) {
    // If a chunk is too short (e.g., just "Wait," or a stray formula),
    // merge it with the previous chunk to preserve semantic meaning.
    if (chunk.length < MIN_CHAR_LENGTH && finalChunks.length > 0) {
      finalChunks[finalChunks.length - 1] += ' ' + chunk;
    } else {
      finalChunks.push(chunk);
    }
  }

  return finalChunks;
}

/**
 * Tokenize by word with context — returns trigrams joined by '|'.
 */
function tokenizeByWordContext(text: string): string[] {
  const words = text.split(/\s+/).filter(w => w.length > 0);
  const result: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const prev = i > 0 ? words[i - 1] : '';
    const curr = words[i];
    const next = i < words.length - 1 ? words[i + 1] : '';
    result.push(`${prev}|${curr}|${next}`);
  }
  return result;
}

/**
 * Tokenize by word — split on whitespace boundaries, keeping the token as
 * the word itself (without leading/trailing whitespace).
 */
function tokenizeByWord(text: string): string[] {
  // Match sequences of non-whitespace characters, or sequences of whitespace
  const matches = text.match(/\S+|\s+/g);
  return matches ?? [];
}

/**
 * Tokenize by sentence — split on sentence-ending punctuation followed by
 * whitespace or end-of-string.
 */
function tokenizeBySentence(text: string): string[] {
  // Split on sentence boundaries, capturing the trailing whitespace
  // so it is preserved in the output tokens.
  const parts = text.split(/((?<=[.!?])\s+)/);
  return parts.filter(p => p.length > 0);
}

/**
 * Tokenize by paragraphs.
 */
function tokenizeByParagraphs(text: string): string[] {
  return text.split('\n').map(s => s.trim()).filter(Boolean);
}

/**
 * Normalize a token for comparison/counting purposes:
 * lowercase, strip punctuation from edges.
 */
export function normalizeToken(token: string): string {
  return token.toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/gi, '');
}
