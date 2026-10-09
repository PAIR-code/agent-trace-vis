/**
 * @license
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

import { marked } from 'marked';
import { AnalysisLayersService } from './analysis-layers.service';
import { SPEAKER_STYLES, SpeakerStyle, createStyle, COLORS } from './colors';
import { PRESET_COLORS, USER_AI_COLORS, USER_TEXT_COLORS } from './analysis-layers.types';
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
      return 'Tool';
    case TraceNodeType.SYSTEM:
      return 'Harness';
    case TraceNodeType.ERROR:
      return 'Error';
    case 'turn':
    case 'step':
      return 'Agent Turn';
    default:
      return type;
  }
}

/** The parts of a side-panel message (a `ThreadMessage` or a `Mark`) the helpers read. */
export interface PanelMessage {
  id: string;
  type: string;
  text?: string;
  traceId?: string;
  color?: string | null;
}

/** Message types drawn in their agent's color. */
const AGENT_COLORED = new Set<string>(['response', 'thinking', 'step', 'turn']);

/** Text, background and border colors for a side-panel message. */
export function speakerStyle(msg: PanelMessage, agentColor: string | undefined): SpeakerStyle {
  const agent = AGENT_COLORED.has(msg.type) ? msg.color || agentColor : undefined;
  if (agent) return createStyle(agent);
  const base = SPEAKER_STYLES[msg.type];
  const isTool = msg.type === 'tool_call' || msg.type === 'tool_data';
  return {
    color: base?.color || '#000',
    bg: base?.bg || '#ffffff',
    border: isTool ? `1.5px solid ${COLORS.TOOL_LINE}` : base?.border || '1px solid #e5e7eb',
  };
}

/**
 * Every color a search layer can have. Highlights are `<mark class="hl-N">`
 * (N = index here) because Angular strips inline styles from [innerHTML];
 * the matching CSS rules are generated from this same list.
 */
const LAYER_COLORS = [...PRESET_COLORS, ...USER_AI_COLORS, ...USER_TEXT_COLORS];

let highlightStylesAdded = false;
function ensureHighlightStyles() {
  if (highlightStylesAdded) return;
  highlightStylesAdded = true;
  const style = document.createElement('style');
  // Append first so `style.sheet` exists, then add rules via the CSSOM
  // (rather than assigning a computed string to `style.textContent`).
  document.head.appendChild(style);
  LAYER_COLORS.forEach((c, i) => {
    style.sheet?.insertRule(
      `.search-span-highlight.hl-${i} { background-color: color-mix(in srgb, ${c} 35%, transparent); }`);
  });
}

function highlightClass(color: string): string {
  const i = LAYER_COLORS.indexOf(color);
  return i >= 0 ? `hl-${i}` : '';  // unknown colors get the default (orange) from styles.css
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

  // 2. Mark search spans with placeholders before markdown parsing
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

  // 3. Render Markdown
  let html = marked.parse(text, { breaks: true, async: false }) as string;

  // 4. Restore search span highlights
  if (spanHighlightConfigs.length > 0) ensureHighlightStyles();
  for (let i = 0; i < spanHighlightConfigs.length; i++) {
    const color = spanHighlightConfigs[i].color;
    const markTag = `<mark class="search-span-highlight ${highlightClass(color)}">`;

    html = html.split(`%%HL_START_${i}%%`).join(markTag);
    html = html.split(`%%HL_END_${i}%%`).join('</mark>');
  }

  return html;
}

const highlightCache = new Map<string, string>();
const MAX_CACHE_SIZE = 1000;

export function getHighlightedTextForViewer(
  msg: PanelMessage,
  layersService: AnalysisLayersService,
  highlightedChunkId: string | null
): string {
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

  let resultHtml: string;

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
    resultHtml = html;
  } else {
    const finalHtml = renderMarkdownWithHighlights(text, matchingSpans);
    resultHtml = finalHtml;
  }

  if (highlightCache.size > MAX_CACHE_SIZE) {
    highlightCache.clear();
  }
  highlightCache.set(cacheKey, resultHtml);
  return resultHtml;
}
