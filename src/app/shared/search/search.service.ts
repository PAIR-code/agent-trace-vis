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
 * @fileoverview Search service providing fuzzy text matching and Gemini-powered
 * semantic search with span-level highlights.
 */

import { Injectable } from '@angular/core';
import { Observable, of, from, forkJoin } from 'rxjs';
import { map } from 'rxjs/operators';

export interface ReferenceChip {
  nodeId: string;
  label: string;   // e.g. "Zebra - 9:35am"
  text: string;     // The full text of the referenced turn
}

export interface SpanHighlight {
  text: string;   // The exact substring to highlight
  score: number;  // 1-5 relevance score for this span
}

export interface SearchResult {
  score: number;               // 1-5 overall turn score
  spans: SpanHighlight[];      // Highlighted spans within the turn
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

@Injectable({ providedIn: 'root' })
export class SearchService {

  private memoryCache = new Map<string, Map<string, SearchResult>>();

  /** Computes a short deterministic 32-bit hash for a string. */
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash |= 0; // Convert to 32bit integer
    }
    return 't' + Math.abs(hash).toString(36);
  }

  /** Clear all cached search results from memory and localStorage. */
  clearCache(): void {
    this.memoryCache.clear();
    try {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('agentic_traces_search_cache_')) {
          keysToRemove.push(key);
        }
      }
      for (const key of keysToRemove) {
        localStorage.removeItem(key);
      }
      console.log('[Search] Cache cleared successfully.');
    } catch (e) {
      console.warn('[Search] Failed to clear localStorage cache:', e);
    }
  }

  /** Prunes cache entries in localStorage down to limit. */
  private pruneCache(limit: number = 100): void {
    try {
      const cacheEntries: Array<{ key: string; timestamp: number }> = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith('agentic_traces_search_cache_')) {
          const val = localStorage.getItem(key);
          if (val) {
            try {
              const parsed = JSON.parse(val);
              const ts = typeof parsed.timestamp === 'number' ? parsed.timestamp : 0;
              cacheEntries.push({ key, timestamp: ts });
            } catch {
              cacheEntries.push({ key, timestamp: 0 });
            }
          }
        }
      }

      if (cacheEntries.length >= limit) {
        // Sort oldest first
        cacheEntries.sort((a, b) => a.timestamp - b.timestamp);
        const toRemoveCount = cacheEntries.length - limit + 1;
        for (let i = 0; i < toRemoveCount; i++) {
          localStorage.removeItem(cacheEntries[i].key);
        }
        console.log(`[Search] Pruned ${toRemoveCount} oldest entries from localStorage cache.`);
      }
    } catch (e) {
      console.warn('[Search] Failed to prune localStorage cache:', e);
    }
  }

  /**
   * Main entry point. Detects search mode from inputs and returns
   * a Map<nodeId, SearchResult> with scores (1-5) and span highlights.
   */
  search(
    query: string,
    referenceChips: ReferenceChip[],
    nodes: Array<{ id: string; role: string; speaker?: string; text: string; traceId?: string }>,
    mode: 'fuzzy' | 'semantic' = 'fuzzy',
    apiKey: string = ''
  ): Observable<Map<string, SearchResult>> {
    const trimmed = query.trim();

    if (!trimmed && referenceChips.length === 0) {
      return of(new Map());
    }

    if (mode === 'semantic') {
      if (!apiKey) {
        console.warn('[Search] Semantic mode requested but no API key — falling back to fuzzy.');
        mode = 'fuzzy';
      } else {
        console.log('[Search] Mode: SEMANTIC', referenceChips.length > 0 ? '(with reference chips)' : '');

        // Group nodes by traceId
        const groups = new Map<string, Array<{ id: string; role: string; speaker?: string; text: string; traceId?: string }>>();
        for (const node of nodes) {
          const tid = node.traceId || 'default';
          const list = groups.get(tid) || [];
          list.push(node);
          groups.set(tid, list);
        }

        const observables: Observable<Map<string, SearchResult>>[] = [];
        for (const [tid, traceNodes] of groups.entries()) {
          observables.push(this.semanticSearch(trimmed, referenceChips, traceNodes, apiKey));
        }

        if (observables.length === 0) {
          return of(new Map());
        }

        return forkJoin(observables).pipe(
          map(maps => {
            const merged = new Map<string, SearchResult>();
            for (const m of maps) {
              for (const [key, val] of m) {
                merged.set(key, val);
              }
            }
            return merged;
          })
        );
      }
    }

    console.log('[Search] Mode: FUZZY');
    const fuzzyResult = this.fuzzyMatch(trimmed, nodes);
    return of(fuzzyResult);
  }

  // ─── Fuzzy String Match ───────────────────────────────────────────

  private fuzzyMatch(
    query: string,
    nodes: Array<{ id: string; text: string }>
  ): Map<string, SearchResult> {
    const results = new Map<string, SearchResult>();
    const q = query.toLowerCase();

    for (const node of nodes) {
      const text = node.text.toLowerCase();

      // Exact case-insensitive substring match only → score 5 (strong match)
      if (text.includes(q)) {
        // Find the actual matched substring preserving original casing
        const idx = text.indexOf(q);
        const matchedText = node.text.substring(idx, idx + query.length);
        results.set(node.id, {
          score: 5,
          spans: [{ text: matchedText, score: 5 }],
        });
      }
    }

    return results;
  }

  // ─── Semantic / Similarity Search via Gemini ──────────────────────

  private semanticSearch(
    query: string,
    referenceChips: ReferenceChip[],
    nodes: Array<{ id: string; role: string; speaker?: string; text: string; traceId?: string }>,
    apiKey: string
  ): Observable<Map<string, SearchResult>> {
    if (!apiKey) {
      console.warn('SearchService: No Gemini API key provided, falling back to fuzzy match.');
      return of(query ? this.fuzzyMatch(query, nodes) : new Map());
    }

    const prompt = this.buildPrompt(query, referenceChips, nodes);
    const promptHash = this.hashString(prompt);
    const cacheKey = `agentic_traces_search_cache_${promptHash}`;

    // 1. Check in-memory cache
    if (this.memoryCache.has(promptHash)) {
      console.log('[Search] Cache hit (memory) for query:', query);
      return of(this.memoryCache.get(promptHash)!);
    }

    // 2. Check localStorage cache
    try {
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        console.log('[Search] Cache hit (localStorage) for query:', query);
        const parsed = JSON.parse(cachedData);
        // Supports both older format (direct results object) and new format ({timestamp, results}):
        const resultsObj = parsed && parsed.results ? parsed.results : parsed;
        const resultsMap = new Map<string, SearchResult>(Object.entries(resultsObj));

        // Update timestamp in localStorage so it stays fresh in LRU order
        try {
          const cacheEntry = {
            timestamp: Date.now(),
            results: resultsObj
          };
          localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
        } catch {}

        this.memoryCache.set(promptHash, resultsMap);
        return of(resultsMap);
      }
    } catch (e) {
      console.warn('[Search] Failed to read from localStorage cache:', e);
    }

    console.log('[Search] Prompt sent to Gemini:\n', prompt);
    return from(this.callGemini(prompt, apiKey)).pipe(
      map(responseText => {
        console.log('[Search] Raw Gemini response:', responseText);
        const results = this.parseResults(responseText, nodes);
        console.log('[Search] Parsed results:', Object.fromEntries(results));

        // 3. Cache the new results
        // Keep in-memory cache pruned to limit
        if (this.memoryCache.size >= 100) {
          const oldestKey = this.memoryCache.keys().next().value;
          if (oldestKey) {
            this.memoryCache.delete(oldestKey);
          }
        }
        this.memoryCache.set(promptHash, results);

        // Prune and write to localStorage cache
        this.pruneCache(100);
        try {
          const resultsObj = Object.fromEntries(results);
          const cacheEntry = {
            timestamp: Date.now(),
            results: resultsObj
          };
          localStorage.setItem(cacheKey, JSON.stringify(cacheEntry));
        } catch (e) {
          console.warn('[Search] Failed to write to localStorage cache:', e);
        }

        return results;
      })
    );
  }

  private buildPrompt(
    query: string,
    referenceChips: ReferenceChip[],
    nodes: Array<{ id: string; role: string; speaker?: string; text: string }>
  ): string {
    // Build the conversation context
    const conversation = nodes.map(n => {
      const speaker = (n as any).speaker || n.role;
      return `[ID=${n.id}] ${speaker}: ${n.text}`;
    }).join('\n');

    // Collect a few real IDs for the example
    const exampleIds = nodes.slice(0, 2).map(n => n.id);

    let searchInstruction: string;

    if (referenceChips.length > 0) {
      const examples = referenceChips.map(c =>
        `  - ID="${c.nodeId}": "${c.text.substring(0, 200)}"`
      ).join('\n');

      if (query) {
        searchInstruction = `Find conversation turns that are SIMILAR to these example turns AND match this description: "${query}".\n\nReference examples:\n${examples}`;
      } else {
        searchInstruction = `Find conversation turns that are SIMILAR in intent, tone, content, or behavioral pattern to these example turns:\n${examples}`;
      }
    } else {
      searchInstruction = `Find conversation turns that match this description: "${query}"`;
    }

    return `You are a strict relevance judge analyzing a conversation. For each turn, rate how well it matches the search query using a 1-5 integer scale. Focus on semantic meaning, not just exact word overlap.

${searchInstruction}

Here is the full conversation:
${conversation}

### IMPORTANT:

Again, you are a strict relevance judge analyzing a conversation. For each turn, rate how well it matches the search query using a 1-5 integer scale. Focus on semantic meaning, not just exact word overlap.

${searchInstruction}

### Match Scoring Guidelines (5-Point Scale)

5 - Strong Match: The turn clearly and directly matches the query. The concept is explicitly present or strongly implied. Little to no ambiguity.
4 - Good Match: The turn matches the query, but less directly or with minor ambiguity. The concept is present but may be indirect, partial, or require light interpretation.
3 - Partial / Weak Match: The turn is loosely related to the query but does not clearly express it. Some relevant signals, but unclear or incomplete.
2 - Weak / Likely Not a Match: The turn has minimal or tangential relevance. Only a faint or indirect connection to the query.
1 - Not a Match: The turn does not match the query at all. No meaningful semantic connection.

### General Principles
- Prioritize meaning over exact words. Match based on concepts, synonyms, and implications.
- Use context when needed. Consider surrounding turns if necessary to interpret tone or meaning.
- Handle abstract queries carefully. For subjective queries (e.g., "rude," "passive aggressive"), rely on reasonable human judgment.
- When unsure, prefer the middle (3) for ambiguous or borderline cases rather than forcing a strong decision.
- Be consistent. Apply the same standard across all examples.

### Output Rules
- Use the EXACT ID values from the conversation (e.g. "${exampleIds[0]}", "${exampleIds[1]}").
- For each matching turn, provide the overall score AND an array of "spans" — the specific word(s) or phrase(s) from the turn text that support the match. Each span has a "text" (exact substring from the turn) and a "score" (1-5, how strongly that span supports the match).
- Spans should be EXACT substrings of the turn text (copy-paste from the turn, preserving casing).
- A span can be a single word, a phrase, or the entire turn text.
- Return ONLY valid JSON in this exact format, with no other text:
{"scores": {"${exampleIds[0]}": {"score": 5, "spans": [{"text": "exact phrase from the turn", "score": 5}]}, "${exampleIds[1]}": {"score": 3, "spans": [{"text": "a word", "score": 3}, {"text": "another phrase", "score": 2}]}}}`;
  }

  private async callGemini(prompt: string, apiKey: string): Promise<string> {
    const model = 'gemini-flash-latest';
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

    const data: GeminiResponse = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini returned an empty response.');
    }
    return text;
  }

  private parseResults(
    responseText: string,
    nodes: Array<{ id: string }>
  ): Map<string, SearchResult> {
    const results = new Map<string, SearchResult>();
    try {
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        console.error('[Search] Could not find JSON in Gemini response:', responseText);
        return results;
      }

      const parsed = JSON.parse(jsonMatch[0]);
      console.log('[Search] Parsed JSON object:', parsed);
      const scoreObj = parsed.scores || parsed;

      const validIds = new Set(nodes.map(n => n.id));

      for (const [rawId, rawValue] of Object.entries(scoreObj)) {
        const id = validIds.has(rawId) ? rawId : rawId.replace(/^node_id_/, '');
        if (!validIds.has(id)) {
          console.warn(`[Search] Skipped: id="${rawId}" not found in valid IDs`);
          continue;
        }

        let score: number;
        let spans: SpanHighlight[] = [];

        if (typeof rawValue === 'number') {
          // Legacy format: just a number
          score = rawValue;
        } else if (typeof rawValue === 'string') {
          score = parseFloat(rawValue);
        } else if (typeof rawValue === 'object' && rawValue !== null) {
          // New format: {score: number, spans: [...]}
          const obj = rawValue as any;
          score = typeof obj.score === 'number' ? obj.score : parseFloat(obj.score);
          if (Array.isArray(obj.spans)) {
            spans = obj.spans
              .filter((s: any) => s && typeof s.text === 'string' && s.text.length > 0)
              .map((s: any) => ({
                text: s.text,
                score: Math.max(1, Math.min(5, Math.round(
                  typeof s.score === 'number' ? s.score : parseFloat(s.score) || 3
                ))),
              }));
          }
        } else {
          continue;
        }

        if (isNaN(score) || score < 2) continue;
        score = Math.max(1, Math.min(5, Math.round(score)));

        results.set(id, { score, spans });
      }
    } catch (e) {
      console.error('[Search] Failed to parse Gemini response:', e, responseText);
    }
    return results;
  }
}
