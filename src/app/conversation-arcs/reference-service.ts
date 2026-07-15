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
 * @fileoverview Service for analyzing cross-turn sentence references using Gemini 2.0 Flash Lite.
 */

import { Injectable } from '@angular/core';
import { AnnotatedConversation, AnnotatedTurn, AnnotatedSentence, SentenceReference, WildChatConversation } from './types';
import { tokenize } from '../unstructured-traces/tokenizer';

@Injectable({ providedIn: 'root' })
export class ReferenceService {
  private readonly CACHE_PREFIX = 'conv_arcs_refs_';

  /**
   * Retreives or prompts for the Gemini API key.
   */
  getApiKey(): string {
    let key = localStorage.getItem('reasoning_vis_api_key') || '';
    if (!key) {
      key = prompt('Enter your Gemini API key for reference analysis:') || '';
      if (key) {
        localStorage.setItem('reasoning_vis_api_key', key);
      }
    }
    return key;
  }

  /**
   * Preprocesses a raw WildChat conversation: splits turns into sentences
   * and assigns global indices.
   */
  preprocessConversation(raw: WildChatConversation): AnnotatedConversation {
    let globalIndex = 0;
    const turns: AnnotatedTurn[] = raw.conversation.map((turn, turnIndex) => {
      // Split turn content into sentences using the existing sentence tokenizer pattern
      const rawSentences = this.splitIntoSentences(turn.content);
      
      const sentences: AnnotatedSentence[] = rawSentences.map((text, sentenceIndex) => {
        const sentence: AnnotatedSentence = {
          sentenceIndex,
          globalIndex: globalIndex++,
          text: text.trim(),
          charLength: text.trim().length,
          references: []
        };
        return sentence;
      });

      return {
        turnIndex,
        role: turn.role,
        content: turn.content,
        sentences
      };
    });

    return {
      id: raw.conversation_hash,
      model: raw.model,
      turns,
      totalSentences: globalIndex
    };
  }

  /**
   * Helper to split text into sentence-like chunks.
   */
  private splitIntoSentences(text: string): string[] {
    // Basic sentence splitting: split on .!? followed by whitespace, keeping them
    const parts = text.split(/((?<=[.!?])\s+)/);
    // Recombine the punctuation/whitespace with the sentence content
    const sentences: string[] = [];
    let currentSentence = '';
    
    for (const part of parts) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        currentSentence += part;
        if (currentSentence.trim()) {
          sentences.push(currentSentence);
        }
        currentSentence = '';
      } else {
        if (currentSentence) {
          sentences.push(currentSentence);
        }
        currentSentence = part;
      }
    }
    if (currentSentence && currentSentence.trim()) {
      sentences.push(currentSentence);
    }
    
    return sentences.map(s => s.trim()).filter(Boolean);
  }

  /**
   * Analyzes references in a conversation using the Single-Call approach (Strategy A).
   * Caches results.
   */
  async analyzeReferences(conversation: AnnotatedConversation, apiKey: string): Promise<SentenceReference[]> {
    if (!apiKey) {
      throw new Error('API key is required for reference analysis');
    }

    const cacheKey = `${this.CACHE_PREFIX}${conversation.id}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached) {
      try {
        const { timestamp, references } = JSON.parse(cached);
        // Only load from cache if references array is not empty
        if (references && Array.isArray(references) && references.length > 0 && Date.now() - timestamp < 7 * 24 * 60 * 60 * 1000) {
          console.log('[ReferenceService] Loaded references from cache.');
          return references;
        }
      } catch (e) {
        console.warn('[ReferenceService] Failed to parse cached references:', e);
      }
    }

    console.log('[ReferenceService] Requesting Gemini for reference analysis...');
    const prompt = this.buildSingleCallPrompt(conversation);
    const references = await this.callGemini(prompt, apiKey);

    // Cache results only if references are non-empty
    if (references && references.length > 0) {
      try {
        localStorage.setItem(cacheKey, JSON.stringify({
          timestamp: Date.now(),
          references
        }));
      } catch (e) {
        console.warn('[ReferenceService] Failed to cache references in localStorage:', e);
      }
    }

    return references;
  }

  /**
   * Prompts Gemini API.
   */
  private async callGemini(prompt: string, apiKey: string): Promise<SentenceReference[]> {
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

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) {
      throw new Error('Gemini returned an empty response.');
    }

    return this.parseGeminiResponse(text);
  }

  private parseGeminiResponse(responseText: string): SentenceReference[] {
    let cleanText = responseText.trim();

    // Strip markdown code block wrappers if present (e.g. ```json ... ```)
    if (cleanText.startsWith('```')) {
      const firstLineBreak = cleanText.indexOf('\n');
      if (firstLineBreak !== -1) {
        cleanText = cleanText.substring(firstLineBreak + 1);
      }
      if (cleanText.endsWith('```')) {
        cleanText = cleanText.substring(0, cleanText.length - 3);
      }
      cleanText = cleanText.trim();
    }

    // Find the first '{' and try parsing
    const startIdx = cleanText.indexOf('{');
    if (startIdx !== -1) {
      cleanText = cleanText.substring(startIdx);
    }

    try {
      const parsed = JSON.parse(cleanText);
      return this.extractRefs(parsed);
    } catch (e) {
      // Find the matching closing brace for the first '{' to ignore trailing junk/extra braces
      let braceCount = 0;
      let endIdx = -1;
      for (let i = 0; i < cleanText.length; i++) {
        if (cleanText[i] === '{') {
          braceCount++;
        } else if (cleanText[i] === '}') {
          braceCount--;
          if (braceCount === 0) {
            endIdx = i;
            break;
          }
        }
      }

      if (endIdx !== -1) {
        try {
          const parsed = JSON.parse(cleanText.substring(0, endIdx + 1));
          return this.extractRefs(parsed);
        } catch (innerError) {
          console.warn('[ReferenceService] Failed to parse matched brace JSON:', innerError);
        }
      }

      console.error('[ReferenceService] Failed to parse Gemini JSON response:', e, responseText);
      return [];
    }
  }

  private extractRefs(parsed: any): SentenceReference[] {
    const refs = parsed.references || [];
    return refs.map((ref: any) => ({
      sourceGlobal: typeof ref.source === 'number' ? ref.source : parseInt(ref.source, 10),
      targetGlobal: typeof ref.target === 'number' ? ref.target : parseInt(ref.target, 10),
      type: ref.type,
      strength: typeof ref.strength === 'number' ? ref.strength : parseInt(ref.strength, 10),
    })).filter((ref: any) =>
      !isNaN(ref.sourceGlobal) &&
      !isNaN(ref.targetGlobal) &&
      !isNaN(ref.strength) &&
      ref.type
    );
  }

  /**
   * Builds Strategy A (Single Call) prompt.
   */
  private buildSingleCallPrompt(conversation: AnnotatedConversation): string {
    const serializedSentences = conversation.turns.map(turn => {
      const header = `--- Turn ${turn.turnIndex} (${turn.role}) ---`;
      const sentencesText = turn.sentences.map(s => `[S${s.globalIndex}] ${s.text}`).join('\n');
      return `${header}\n${sentencesText}`;
    }).join('\n\n');

    return `You are analyzing a multi-turn conversation. Each sentence has a global index.

CONVERSATION:
${serializedSentences}

For EVERY sentence that references a sentence from a PREVIOUS turn, output a reference.
Do NOT include references between sentences in the SAME turn.

Reference types:
- "response": Directly answers, addresses, continues, or expands on the referenced sentence (representing a reply or thread of content)
- "summary": Summarizes, paraphrases, or rewrites
- "artifact": Creates, references, or edits a persistent block of content or data structure (like code snippets, lists, emails, template text, documents, etc.)
- "refusal": Refuses to answer, declines request, states inability to fulfill, or pushes back on assumptions (including statements like "I am not X, I am Y")

Strength (1-5): 1=tangential, 3=clear reference, 5=direct reply

Return ONLY valid JSON in this format:
{"references": [
  {"source": 2, "target": 0, "type": "response", "strength": 5},
  {"source": 6, "target": 3, "type": "refusal", "strength": 4}
]}

Be selective — only include genuine references, not coincidental topic overlap. Do not include any markdown wrappers or text outside the JSON object.`;
  }
}
