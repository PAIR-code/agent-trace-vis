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
 * @fileoverview Rendering helpers for reasoning traces: LaTeX, markdown, and
 * think-block processing.
 */

import { marked } from 'marked';
import katex from 'katex';
import { segmentReasoningTrace, tokenize } from './tokenizer';

/** Process a raw text string: handle <think> blocks, render LaTeX, then markdown. */
export function renderMarkdownWithLatex(text: string): string {
  // 1. Handle <think> blocks — wrap them in styled divs
  text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, inner) => {
    return `\n\n<div class="think-block"><div class="think-label">💭 Thinking</div>\n\n${inner.trim()}\n\n</div>\n\n`;
  });

  // 2. Render LaTeX — protect from markdown processing
  // Replace display math: \[...\] and $$...$$
  const mathPlaceholders: string[] = [];
  const placeholder = (idx: number) => `%%MATH_PLACEHOLDER_${idx}%%`;

  // \[...\] display math
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, latex) => {
    const idx = mathPlaceholders.length;
    try {
      mathPlaceholders.push(katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      mathPlaceholders.push(`<span class="katex-error">${escapeHtml(latex)}</span>`);
    }
    return placeholder(idx);
  });

  // $$...$$ display math
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, latex) => {
    const idx = mathPlaceholders.length;
    try {
      mathPlaceholders.push(katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      mathPlaceholders.push(`<span class="katex-error">${escapeHtml(latex)}</span>`);
    }
    return placeholder(idx);
  });

  // \(...\) inline math
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_m, latex) => {
    const idx = mathPlaceholders.length;
    try {
      mathPlaceholders.push(katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false }));
    } catch {
      mathPlaceholders.push(`<span class="katex-error">${escapeHtml(latex)}</span>`);
    }
    return placeholder(idx);
  });

  // $...$ inline math (single dollar — be careful not to match $$)
  text = text.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_m, latex) => {
    const idx = mathPlaceholders.length;
    try {
      mathPlaceholders.push(katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false }));
    } catch {
      mathPlaceholders.push(`<span class="katex-error">${escapeHtml(latex)}</span>`);
    }
    return placeholder(idx);
  });

  // 3. Render markdown
  let html = marked.parse(text, { async: false }) as string;

  // 4. Restore math placeholders
  for (let i = 0; i < mathPlaceholders.length; i++) {
    html = html.replace(placeholder(i), mathPlaceholders[i]);
  }

  return html;
}

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function truncate(text: string, maxLen: number): string {
  return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
}

/** Segment text, render each chunk, and wrap in classes for side borders. */
export function renderChunkedHtml(text: string, traceIndex?: number, chunkBy: 'steps' | 'paragraphs' | 'word' | 'sentence' | 'word_context' = 'steps'): string {
  let chunks: string[] = [];
  if (chunkBy === 'steps') {
    chunks = segmentReasoningTrace(text);
  } else if (chunkBy === 'paragraphs') {
    chunks = text.split('\n').map((s: string) => s.trim()).filter(Boolean);
  } else {
    chunks = tokenize(text, chunkBy as any);
  }

  return chunks.map((chunk, index) => {
    const rendered = renderMarkdownWithLatex(chunk);
    const className = `chunk-turn-${index % 2}`;
    const id = traceIndex !== undefined ? `chunk-${traceIndex}-${index}` : `chunk-${index}`;
    return `<div id="${id}" class="${className}">${rendered}</div>`;
  }).join('');
}
