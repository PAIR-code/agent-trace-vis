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
 * @fileoverview Formatting and highlighting helper functions for conversation viewer.
 */

import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { marked } from 'marked';
import katex from 'katex';
import { AnalysisLayersService } from './analysis-layers.service';
import { SPEAKER_STYLES, createStyle, COLORS } from './colors';
import { TraceNodeType } from './layout-types';

export function getRoleLabel(type: string): string {
  switch (type) {
    case TraceNodeType.USER_INPUT:
      return 'User';
    case TraceNodeType.RESPONSE:
      return 'Assistant';
    case TraceNodeType.THINKING:
      return 'Thinking';
    case TraceNodeType.TOOL_CALL:
      return 'Tool Call';
    case TraceNodeType.TOOL_DATA:
      return 'Tool Data';
    case TraceNodeType.SYSTEM:
      return 'Harness';
    case TraceNodeType.ERROR:
      return 'Error';
    default:
      return type;
  }
}

export function getNodeBorderColor(node: any): string {
  if (node.type === TraceNodeType.SYSTEM || node.type === 'system') {
    return node.borderColor || (node.data as any)?.color || (node.data as any)?.agentColor || COLORS.AGENT;
  }
  if (
    node.type !== TraceNodeType.TOOL_CALL &&
    node.type !== TraceNodeType.TOOL_DATA
  ) {
    return '';
  }
  return COLORS.TOOL_LINE;
}

export function getSpeakerColorForViewer(msg: any, activeTraceId: string | undefined, traces: any[]): string {
  if (msg.type === 'response' || msg.type === 'thinking') {
    if (msg.color) return msg.color;
    const traceId = msg.traceId || activeTraceId;
    const trace = traces.find((t) => t.id === traceId);
    const color = (trace as any)?.agentColor;
    if (color) return color;
  }
  return SPEAKER_STYLES[msg.type]?.color || '#000';
}

export function getSpeakerBgColorForViewer(msg: any, activeTraceId: string | undefined, traces: any[]): string {
  if (msg.type === 'response' || msg.type === 'thinking') {
    const color = msg.color || (traces.find((t) => t.id === (msg.traceId || activeTraceId)) as any)?.agentColor;
    if (color) {
      return createStyle(color).bg;
    }
  }
  return SPEAKER_STYLES[msg.type]?.bg || '#ffffff';
}

export function getSpeakerBorderForViewer(msg: any, activeTraceId: string | undefined, traces: any[]): string {
  if (msg.type === 'tool_call' || msg.type === 'tool_data') {
    const borderColor = getNodeBorderColor(msg);
    if (borderColor) {
      return `1.5px solid ${borderColor}`;
    }
  }
  if (msg.type === 'response' || msg.type === 'thinking') {
    const color = msg.color || (traces.find((t) => t.id === (msg.traceId || activeTraceId)) as any)?.agentColor;
    if (color) {
      return createStyle(color).border;
    }
  }
  return SPEAKER_STYLES[msg.type]?.border || '1px solid #e5e7eb';
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Renders raw text as markdown (with LaTeX math support) and search span highlighting.
 */
export function renderMarkdownWithHighlights(
  rawText: string,
  matchingSpans: Array<{ text: string; color: string }>
): string {
  if (!rawText) return '';

  let text = rawText;

  // 1. Handle <think> blocks if present
  text = text.replace(/<think>([\s\S]*?)<\/think>/gi, (_match, inner) => {
    return `\n\n<div class="think-block"><div class="think-label">💭 Thinking</div>\n\n${inner.trim()}\n\n</div>\n\n`;
  });

  // 2. Protect LaTeX math from markdown parsing
  const mathPlaceholders: string[] = [];
  const mathPlaceholder = (idx: number) => `%%MATH_PLACEHOLDER_${idx}%%`;

  // Display math: \[...\]
  text = text.replace(/\\\[([\s\S]*?)\\\]/g, (_m, latex) => {
    const idx = mathPlaceholders.length;
    try {
      mathPlaceholders.push(katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      mathPlaceholders.push(`<span class="katex-error">${escapeHtml(latex)}</span>`);
    }
    return mathPlaceholder(idx);
  });

  // Display math: $$...$$
  text = text.replace(/\$\$([\s\S]*?)\$\$/g, (_m, latex) => {
    const idx = mathPlaceholders.length;
    try {
      mathPlaceholders.push(katex.renderToString(latex.trim(), { displayMode: true, throwOnError: false }));
    } catch {
      mathPlaceholders.push(`<span class="katex-error">${escapeHtml(latex)}</span>`);
    }
    return mathPlaceholder(idx);
  });

  // Inline math: \(...\)
  text = text.replace(/\\\(([\s\S]*?)\\\)/g, (_m, latex) => {
    const idx = mathPlaceholders.length;
    try {
      mathPlaceholders.push(katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false }));
    } catch {
      mathPlaceholders.push(`<span class="katex-error">${escapeHtml(latex)}</span>`);
    }
    return mathPlaceholder(idx);
  });

  // Inline math: $...$ (single dollar)
  text = text.replace(/(?<!\$)\$(?!\$)([^$\n]+?)\$(?!\$)/g, (_m, latex) => {
    const idx = mathPlaceholders.length;
    try {
      mathPlaceholders.push(katex.renderToString(latex.trim(), { displayMode: false, throwOnError: false }));
    } catch {
      mathPlaceholders.push(`<span class="katex-error">${escapeHtml(latex)}</span>`);
    }
    return mathPlaceholder(idx);
  });

  // 3. Mark search spans with placeholders before markdown parsing
  const spanHighlightConfigs: Array<{ color: string }> = [];

  if (matchingSpans.length > 0) {
    const sortedSpans = [...matchingSpans].sort((a, b) => b.text.length - a.text.length);
    for (const span of sortedSpans) {
      if (!span.text.trim()) continue;
      const spanIndex = spanHighlightConfigs.length;
      spanHighlightConfigs.push({ color: span.color });
      const escapedSpan = span.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      try {
        const regex = new RegExp(`(${escapedSpan})`, 'gi');
        text = text.replace(regex, (match) => {
          return `%%HL_START_${spanIndex}%%${match}%%HL_END_${spanIndex}%%`;
        });
      } catch (e) {
        console.warn('Regex failed for span highlight:', span.text, e);
      }
    }
  }

  // 4. Render Markdown
  let html = marked.parse(text, { breaks: true, async: false }) as string;

  // 5. Restore math placeholders
  for (let i = 0; i < mathPlaceholders.length; i++) {
    html = html.replace(mathPlaceholder(i), mathPlaceholders[i]);
  }

  // 6. Restore search span highlights
  for (let i = 0; i < spanHighlightConfigs.length; i++) {
    const color = spanHighlightConfigs[i].color;
    let highlightBg = color;
    if (highlightBg.startsWith('rgb')) {
      highlightBg = highlightBg.replace('rgb(', 'rgba(').replace(')', ', 0.35)');
    } else if (highlightBg.startsWith('#')) {
      highlightBg = highlightBg + '55';
    }
    const markTag = `<mark class="search-span-highlight" style="background-color: ${highlightBg}; color: inherit; padding: 1px 3px; border-radius: 3px; border-bottom: 1.5px solid ${color}; font-weight: 500;">`;

    html = html.split(`%%HL_START_${i}%%`).join(markTag);
    html = html.split(`%%HL_END_${i}%%`).join('</mark>');
  }

  return html;
}

const highlightCache = new Map<string, SafeHtml>();
const MAX_CACHE_SIZE = 1000;

export function getHighlightedTextForViewer(
  msg: any,
  layersService: AnalysisLayersService,
  sanitizer: DomSanitizer,
  highlightedChunkId: string | null
): SafeHtml {
  const text = msg.text || '';

  // Collect all matching search spans for this node ID
  const matchingSpans: Array<{ text: string; color: string }> = [];
  for (const layer of layersService.layers()) {
    if (layer.enabled && !layer.loading) {
      const result = layer.results.get(msg.id);
      if (result && result.spans) {
        for (const span of result.spans) {
          if (span.text.trim()) {
            matchingSpans.push({ text: span.text, color: layer.color });
          }
        }
      }
    }
  }

  const spansKey = matchingSpans.length > 0
    ? matchingSpans.map(s => s.text + ':' + s.color).join('|')
    : '';
  const chunkKey = (msg.type === 'thinking' && highlightedChunkId?.startsWith(msg.id))
    ? highlightedChunkId
    : '';
  const cacheKey = `${msg.id}_${msg.type}_${text.length}_${spansKey}_${chunkKey}`;

  const cached = highlightCache.get(cacheKey);
  if (cached) {
    return cached;
  }

  let resultHtml: SafeHtml;

  if (msg.type === 'thinking') {
    const paragraphs = text.split('\n\n');
    const html = paragraphs
      .map((p: string, idx: number) => {
        const fullChunkId = `${msg.id}_chunk_${idx}`;
        const isHighlighted = highlightedChunkId === fullChunkId;
        const rendered = renderMarkdownWithHighlights(p, matchingSpans);

        return `<div id="chunk-${fullChunkId}" class="text-chunk ${isHighlighted ? 'is-highlighted' : ''}">${rendered}</div>`;
      })
      .join('');
    resultHtml = sanitizer.bypassSecurityTrustHtml(html);
  } else {
    const finalHtml = renderMarkdownWithHighlights(text, matchingSpans);
    resultHtml = sanitizer.bypassSecurityTrustHtml(finalHtml);
  }

  if (highlightCache.size > MAX_CACHE_SIZE) {
    highlightCache.clear();
  }
  highlightCache.set(cacheKey, resultHtml);
  return resultHtml;
}
