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
 * @fileoverview Lower-level helper utilities.
 * 
 * Includes:
 * - Time formatters (turning milliseconds to label like "+1m 20s")
 * - Text measurement approximations (deciding node heights based on string lengths)
 */

export function sanitizeId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9-]/g, '_');
}

/** Computes a short deterministic 32-bit hash for a string. */
export function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit integer
  }
  return 't' + Math.abs(hash).toString(36);
}


/** Formats elapsed time in milliseconds to a string (+m:ss or +ss). */
export function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    if (remainingSeconds === 0) {
      return `+${minutes}m`;
    }
    return `+${minutes}m ${remainingSeconds}s`;
  }
  return `+${remainingSeconds}s`;
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

export function wordCount(text: string | undefined): number {
  return (text || '').split(/\s+/).filter(w => w.length > 0).length;
}

/** Computes the total tokens for a step given selected token types. */
export function getStepTokens(usage: any, selectedTypes?: Set<string>): number {
  if (!usage) return 0;
  if (!selectedTypes) {
    return (usage.input_tokens || usage.prompt_tokens || 0) +
           (usage.output_tokens || usage.completion_tokens || 0) +
           (usage.cache_read_tokens || 0) +
           (usage.cache_write_tokens || 0);
  }
  let sum = 0;
  if (selectedTypes.has('input_tokens')) sum += (usage.input_tokens || usage.prompt_tokens || 0);
  if (selectedTypes.has('output_tokens')) sum += (usage.output_tokens || usage.completion_tokens || 0);
  if (selectedTypes.has('cache_read_tokens')) sum += (usage.cache_read_tokens || 0);
  if (selectedTypes.has('cache_write_tokens')) sum += (usage.cache_write_tokens || 0);
  return sum;
}

/**
 * Tokens a step occupies on the tokens-mode axis: its selected token usage, or
 * (if that is zero/missing) a word count of its text as a stand-in.
 */
export function stepAxisTokens(step: any, selectedTypes?: Set<string>): number {
  const tokens = getStepTokens(step.token_usage, selectedTypes);
  if (tokens > 0) return tokens;
  return wordCount(step.nodes?.map((n: any) => n.text).join(' ') || step.content || step.reasoning_content);
}
