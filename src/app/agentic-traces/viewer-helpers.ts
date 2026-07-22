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

  const highlightSpans = (rawText: string): string => {
    let html = rawText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

    if (matchingSpans.length === 0) return html;

    const sortedSpans = [...matchingSpans].sort((a, b) => b.text.length - a.text.length);

    for (const span of sortedSpans) {
      const escapedSpan = span.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      try {
        const regex = new RegExp(`(${escapedSpan})`, 'gi');
        html = html.replace(regex, (match) => {
          return `___MARK_START_${span.color}___${match}___MARK_END___`;
        });
      } catch (e) {
        console.warn('Regex failed:', span.text, e);
      }
    }

    const startRegex = /___MARK_START_(.+?)___/g;
    const endRegex = /___MARK_END___/g;
    html = html
      .replace(startRegex, (_, color) => {
        let highlightBg = color;
        if (highlightBg.startsWith('rgb')) {
          highlightBg = highlightBg.replace('rgb(', 'rgba(').replace(')', ', 0.35)');
        } else if (highlightBg.startsWith('#')) {
          highlightBg = highlightBg + '55';
        }
        return `<mark class="search-span-highlight" style="background-color: ${highlightBg}; color: inherit; padding: 1px 3px; border-radius: 3px; border-bottom: 1.5px solid ${color}; font-weight: 500;">`;
      })
      .replace(endRegex, '</mark>');

    return html;
  };

  if (msg.type === 'thinking') {
    const paragraphs = text.split('\n\n');
    const html = paragraphs
      .map((p: string, idx: number) => {
        const baseId = msg.id.replace('_thinking_0', '');
        const fullChunkId = `${baseId}_thinking_${idx}`;
        const isHighlighted = highlightedChunkId === fullChunkId;
        const highlightedContent = highlightSpans(p);

        return `<span id="chunk-${fullChunkId}" class="text-chunk ${isHighlighted ? 'is-highlighted' : ''}">${highlightedContent}</span>`;
      })
      .join('\n\n');
    return sanitizer.bypassSecurityTrustHtml(html);
  }

  const finalHtml = highlightSpans(text);
  return sanitizer.bypassSecurityTrustHtml(finalHtml);
}
