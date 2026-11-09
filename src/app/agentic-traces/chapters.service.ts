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
 * @fileoverview Background LLM annotation service that segments visible traces
 * into short contiguous "chapters" and identifies key turning-point "events"
 * using the same Gemini model as semantic search.
 */

import { Injectable, signal } from '@angular/core';
import { Subscription, from } from 'rxjs';
import { ANALYSIS_PRESETS } from './analysis-layers.types';
import { TraceLayout } from './layout-types';
import { Mark } from './marks';

export interface TraceChapter {
  startNodeId: string;
  endNodeId: string;
  label: string;
  summary: string;
}

export interface TraceKeyEvent {
  nodeId: string;
  label: string;
  summary: string;
}

export interface TraceAnnotations {
  chapters: TraceChapter[];
  events: TraceKeyEvent[];
}

export type AnnotationMode = 'both' | 'chapters' | 'events' | 'off';

/** Height in px of the unified upper chapter/event bar. */
export const CHAPTERS_STRIP_HEIGHT = 20;
export const EVENTS_STRIP_HEIGHT = 0;

export function annotationBarHeight(mode: AnnotationMode): number {
  return mode === 'off' ? 0 : CHAPTERS_STRIP_HEIGHT;
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

const CACHE_PREFIX = 'agentic_traces_chapters_cache_v8_';
const LEGACY_CACHE_PREFIX = 'agentic_traces_chapters_cache_';

@Injectable({ providedIn: 'root' })
export class ChaptersService {
  /** Whether the upper chapter bar is shown ('chapters' / 'both') or hidden ('off'). */
  mode = signal<AnnotationMode>('chapters');

  /** Trace ID -> resolved chapters and key events. */
  annotations = signal<Map<string, TraceAnnotations>>(new Map());

  /** Trace IDs currently waiting on a background Gemini request. */
  loadingIds = signal<Set<string>>(new Set());

  private memoryCache = new Map<string, TraceAnnotations>();
  private subscriptions = new Map<string, Subscription>();

  /** Trigger non-blocking background annotation for all currently laid-out traces. */
  annotateTraces(layouts: TraceLayout[], apiKey: string): void {
    if (this.mode() === 'off') return;

    for (const trace of layouts) {
      if (this.annotations().has(trace.id) || this.loadingIds().has(trace.id)) {
        continue;
      }
      if (!trace.marks || trace.marks.length === 0) {
        continue;
      }
      this.annotateSingleTrace(trace.id, trace.marks, apiKey);
    }
  }

  /** Clear cached chapter annotations from memory and localStorage. */
  clearCache(): number {
    for (const sub of this.subscriptions.values()) {
      sub.unsubscribe();
    }
    this.subscriptions.clear();
    this.loadingIds.set(new Set());
    this.annotations.set(new Map());
    this.memoryCache.clear();

    let count = 0;
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(LEGACY_CACHE_PREFIX)) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
        count++;
      }
    } catch {
      // Ignore storage access errors
    }
    return count;
  }

  private annotateSingleTrace(traceId: string, marks: Mark[], apiKey: string): void {
    const prompt = this.buildPrompt(marks);
    const promptHash = this.hashString(prompt);
    const cacheKey = `${CACHE_PREFIX}${promptHash}`;

    // 1. Check in-memory cache
    const memCached = this.memoryCache.get(promptHash);
    if (memCached) {
      this.setTraceAnnotation(traceId, memCached);
      return;
    }

    // 2. Check localStorage cache (works even if apiKey isn't provided yet)
    try {
      const raw = localStorage.getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { timestamp?: number; data?: TraceAnnotations };
        const data = parsed?.data ?? (parsed as unknown as TraceAnnotations);
        if (data && Array.isArray(data.chapters)) {
          this.memoryCache.set(promptHash, data);
          this.setTraceAnnotation(traceId, data);
          return;
        }
      }
    } catch {
      // Ignore corrupt cache entry
    }

    // 3. If not cached, only call Gemini when an API key is available
    if (!apiKey) {
      return;
    }

    this.markLoading(traceId, true);
    this.subscriptions.get(traceId)?.unsubscribe();

    const sub = from(this.callGemini(prompt, apiKey)).subscribe({
      next: responseText => {
        const parsed = this.parseResponse(responseText, marks);
        this.memoryCache.set(promptHash, parsed);
        this.saveToCache(cacheKey, parsed);
        this.setTraceAnnotation(traceId, parsed);
        this.markLoading(traceId, false);
        this.subscriptions.delete(traceId);
      },
      error: err => {
        console.warn(`[Chapters] Failed to annotate trace "${traceId}":`, err);
        this.markLoading(traceId, false);
        this.subscriptions.delete(traceId);
      },
    });

    this.subscriptions.set(traceId, sub);
  }

  private setTraceAnnotation(traceId: string, data: TraceAnnotations): void {
    this.annotations.update(prev => {
      const next = new Map(prev);
      next.set(traceId, data);
      return next;
    });
  }

  private markLoading(traceId: string, isLoading: boolean): void {
    this.loadingIds.update(prev => {
      const next = new Set(prev);
      if (isLoading) next.add(traceId);
      else next.delete(traceId);
      return next;
    });
  }

  private buildPrompt(marks: Mark[]): string {
    const lines = marks.map(m => {
      const snippet = (m.text || m.label || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500);
      return `[ID=${m.id}] ${m.type}: ${snippet}`;
    }).join('\n');

    const firstId = marks[0]?.id ?? 'node_0';
    const lastId = marks[marks.length - 1]?.id ?? firstId;
    const midId = marks[Math.floor(marks.length / 2)]?.id ?? firstId;

    const targetCount = marks.length <= 6 ? '2 to 3' : marks.length <= 20 ? '3 to 5' : '4 to 7';

    // Programmatically include the default search chips from ANALYSIS_PRESETS so any edits
    // to the search chips are automatically reflected in chapterization and its cache hash.
    const searchChipSignals = ANALYSIS_PRESETS
      .map(p => `- ${p.name}: ${p.query}`)
      .join('\n');

    return `You are analyzing an AI agent execution trace to produce a self-contained high-level summary of what happened in the context of the original goal—and how the trajectory advances that goal or diverges/detours from it.

CRITICAL REQUIREMENT — UNDERSTANDABLE WITHOUT READING THE TRACE:
It MUST be possible for a reader to understand what happened in the trace at a high level by JUST looking at the sequence of summary chapters, without ever looking at the trace itself:
- FIRST CHAPTER = INITIAL USER INSTRUCTION: The very first chapter MUST start at "${firstId}" (with "startNodeId": "${firstId}", "endNodeId": "${firstId}") and summarize the initial user instruction / task request in 2–4 words (e.g., "Goal: fix label overlap", "Ask: gender filter & bios", "Task: 5 Pokemon charts").
- Do NOT reference obscure code symbols, CSS selectors, variable names, file internals, or numbered options that require reading the trace to understand (e.g., write "Stop clipped chart bands" instead of "Cap label maxY"; write "Fix squished x-axis" instead of "Fix .container width"; write "Move labels below bands" instead of "Pick option 2").

Return a single chronological sequence of ${targetCount} non-overlapping "chapters" (unifying multi-turn phases and single-turn key events):
- If an item is a single-turn event (like the initial user instruction or a specific course-correction/error), set "startNodeId" and "endNodeId" to that same node ID so it spans just that turn.
- If an item is a multi-turn phase of work, set "startNodeId" and "endNodeId" to the first and last node IDs of that phase.

Here is the trace (${marks.length} nodes, from first ID="${firstId}" to last ID="${lastId}"):
${lines}

### DEFAULT SEARCH CHIP BEHAVIORS TO SURFACE WHEN PRESENT:
If any of the following behaviors (from the viewer's default search chips) occur in the trace, make sure they show up as a chapter or single-turn event—phrased specifically so the reader knows what happened in context:
${searchChipSignals}

### STRICT RULES FOR LABELS:
- ALWAYS START WITH THE USER INSTRUCTION: The first chapter in "chapters" must summarize the opening user request at "${firstId}".
- SELF-CONTAINED & GOAL-ANCHORED: Every subsequent label should make sense on its own without reading the trace, showing either how the goal is advancing or how execution diverged/detoured (e.g., "Ask user for label layout", "Move labels below bands", "X-axis squished after edit", "Fix squished x-axis", "Blocked reading other repo", "No donut; use stacked bar").
- NEVER USE BARE GENERIC META-LABELS ALONE: Do not output vague labels like "Requirements Clarification", "User Feedback", "Correction Request", "Initial Implementation", "Bug Fixes", "User Prompt", or a bare chip name without context. Always say *what* is being asked, clarified, corrected, built, or blocked!
- STAY FACTUAL & OBSERVABLE: State what concretely happened relative to the goal.
- KEEP LABELS ULTRA-SHORT: 2 to 4 words max (under 26 characters).
- RAW TEXT ONLY: Do NOT include numbers (never write "1.", "2.", "Chapter 1"), bullets, flags, or emojis.
- Chronological order without overlapping; use EXACT IDs from [ID=...] in the trace for "startNodeId" and "endNodeId".
- In each item's 1-sentence "summary", state what happened in plain language and how it supported or diverged from the overall goal.

Return ONLY valid JSON in this exact structure:
{
  "goal": "Fix overlapping Google and Brown text labels on the timeline without distorting the chart layout.",
  "chapters": [
    {"startNodeId": "${firstId}", "endNodeId": "${firstId}", "label": "Fix timeline label overlap", "summary": "User asks the agent to fix overlapping Google and Brown labels on the timeline."},
    {"startNodeId": "${midId}", "endNodeId": "${lastId}", "label": "Move labels & fix x-axis", "summary": "Moves the timeline labels below the bands after user confirmation and resolves a side-effect where the x-axis became squished."}
  ]
}`;
  }

  private async callGemini(prompt: string, apiKey: string): Promise<string> {
    const model = 'gemini-flash-lite-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const body = {
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Gemini API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as GeminiResponse;
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini returned an empty response.');
    }
    return text;
  }

  private cleanLabel(raw: unknown): string {
    if (typeof raw !== 'string') return '';
    return raw
      // Strip leading numbering like "1. ", "1) ", "Chapter 1: "
      .replace(/^(?:chapter\s*\d+[:.\-\s]*|\d+[.)\-:\s]+)/i, '')
      // Strip common flag/pin/bullet symbols if model included any
      .replace(/^[⚑🚩📌◆•*]+\s*/u, '')
      .trim();
  }

  private parseResponse(responseText: string, marks: Mark[]): TraceAnnotations {
    const empty: TraceAnnotations = { chapters: [], events: [] };
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return empty;

      const parsed = JSON.parse(jsonMatch[0]) as {
        chapters?: Array<Record<string, unknown>>;
        events?: Array<Record<string, unknown>>;
      };

      const indexById = new Map<string, number>();
      marks.forEach((m, i) => indexById.set(m.id, i));

      const resolveId = (raw: unknown, preferEnd = false): string | null => {
        if (typeof raw !== 'string') return null;
        const cleaned = raw.replace(/^\[?ID=/i, '').replace(/\]$/, '').trim();
        if (indexById.has(cleaned)) return cleaned;
        // Fallback if the LLM returned a step prefix like "step_5" when node IDs are "step_5_thinking", "step_5_response"
        const prefix = `${cleaned}_`;
        const matches = marks.filter(m => m.id.startsWith(prefix));
        if (matches.length > 0) {
          return (preferEnd ? matches[matches.length - 1] : matches[0]).id;
        }
        return null;
      };

      const rawChapters = Array.isArray(parsed.chapters) ? parsed.chapters : [];
      const chapters: TraceChapter[] = [];
      for (const ch of rawChapters) {
        const rawStart = ch['startNodeId'] ?? ch['nodeId'];
        const rawEnd = ch['endNodeId'] ?? rawStart;
        const startId = resolveId(rawStart, false);
        const endId = resolveId(rawEnd, true);
        const label = this.cleanLabel(ch['label']);
        const summary = typeof ch['summary'] === 'string' ? ch['summary'].trim() : '';
        if (!startId || !endId || !label) continue;

        const i0 = indexById.get(startId)!;
        const i1 = indexById.get(endId)!;
        chapters.push({
          startNodeId: i0 <= i1 ? startId : endId,
          endNodeId: i0 <= i1 ? endId : startId,
          label,
          summary,
        });
      }

      // If any separate events were returned, fold them into chapters as 1-turn items if not already starting at that node
      const rawEvents = Array.isArray(parsed.events) ? parsed.events : [];
      const existingStarts = new Set(chapters.map(c => c.startNodeId));
      for (const ev of rawEvents) {
        const startId = resolveId(ev['nodeId'] ?? ev['startNodeId'], false);
        const endId = resolveId(ev['nodeId'] ?? ev['endNodeId'] ?? ev['startNodeId'], true);
        const label = this.cleanLabel(ev['label']);
        const summary = typeof ev['summary'] === 'string' ? ev['summary'].trim() : '';
        if (!startId || !endId || !label || existingStarts.has(startId)) continue;
        existingStarts.add(startId);
        chapters.push({ startNodeId: startId, endNodeId: endId, label, summary });
      }

      chapters.sort((a, b) => (indexById.get(a.startNodeId) ?? 0) - (indexById.get(b.startNodeId) ?? 0));

      return { chapters, events: [] };
    } catch (e) {
      console.warn('[Chapters] Failed to parse Gemini response:', e);
      return empty;
    }
  }

  private saveToCache(cacheKey: string, data: TraceAnnotations): void {
    this.pruneCache(100);
    try {
      localStorage.setItem(cacheKey, JSON.stringify({ timestamp: Date.now(), data }));
    } catch {
      // Ignore quota errors
    }
  }

  private pruneCache(limit = 100): void {
    try {
      const entries: Array<{ key: string; timestamp: number }> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(CACHE_PREFIX)) {
          const val = localStorage.getItem(key);
          if (val) {
            try {
              const parsed = JSON.parse(val) as { timestamp?: number };
              entries.push({ key, timestamp: typeof parsed.timestamp === 'number' ? parsed.timestamp : 0 });
            } catch {
              entries.push({ key, timestamp: 0 });
            }
          }
        }
      }
      if (entries.length >= limit) {
        entries.sort((a, b) => a.timestamp - b.timestamp);
        const toRemove = entries.length - limit + 1;
        for (let i = 0; i < toRemove; i++) {
          localStorage.removeItem(entries[i].key);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }

  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return 'c' + Math.abs(hash).toString(36);
  }
}
