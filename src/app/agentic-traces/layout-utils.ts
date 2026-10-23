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
 * @fileoverview Small shared helpers: ids, time labels, text, and token counts.
 */

import type { AxisMode } from './layout-types';
import { TraceNodeType } from './layout-types';

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
 * Tokens a step occupies on the tokens-mode axis: its selected token usage;
 * else its reasoning tokens (a part of output, so only when output tokens are
 * selected; some harnesses report those per step but totals only per turn);
 * else a word count of its text as a stand-in.
 */
export function stepAxisTokens(step: any, selectedTypes?: Set<string>): number {
  const tokens = getStepTokens(step.token_usage, selectedTypes);
  if (tokens > 0) return tokens;
  if (step.reasoningTokens > 0 && (!selectedTypes || selectedTypes.has('output_tokens'))) return step.reasoningTokens;
  return wordCount(step.nodes?.map((n: any) => n.text).join(' ') || step.content || step.reasoning_content);
}

/** Rough token count of a text (about four characters per token). */
export function estimateTokens(text: string | undefined): number {
  return Math.ceil((text || '').length / 4);
}

/**
 * How a step's length on the tokens axis divides among its nodes: the tokens
 * the model produced went to its reasoning, to each tool call's arguments
 * (a file edit's new content, a command line, ...) and to its reply, so each
 * gets a share of the axis and the same distance means the same tokens
 * whatever they were spent on. Exact where the trace says so (per-step
 * reasoning tokens); otherwise each part's share is estimated from the size of
 * its text. Returns, per node id, its [start, end] offset within the step in
 * axis units (`length` is the step's total length).
 */
export function stepTokenSegments(step: any, length: number): Map<string, [number, number]> {
  const nodes: any[] = step.nodes ?? [];
  const weightOf = (n: any): number => {
    if (n.type === TraceNodeType.THINKING) return step.reasoningTokens || estimateTokens(n.text);
    if (n.data?.toolCall) {
      const input = n.data.toolCall.input;
      return estimateTokens(typeof input === 'string' ? input : JSON.stringify(input ?? {}));
    }
    return estimateTokens(n.text);
  };
  const weights = nodes.map(n => Math.max(1, weightOf(n)));
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  const segments = new Map<string, [number, number]>();
  let at = 0;
  nodes.forEach((n, i) => {
    const w = length * weights[i] / total;
    segments.set(n.id, [at, at + w]);
    at += w;
  });
  return segments;
}

/**
 * Length of a step on a non-time axis: its tokens in tokens mode, or one unit
 * per node in sequence mode (time mode without timestamps).
 */
export function stepAxisLength(step: any, mode: AxisMode, selectedTypes?: Set<string>): number {
  return mode === 'sequence' ? Math.max(1, step.nodes?.length ?? 0) : stepAxisTokens(step, selectedTypes);
}
