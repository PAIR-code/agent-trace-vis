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
 * @fileoverview The content a file create / edit tool call wrote, as lines for
 * the side panel. Tool results for these calls are usually just "Created
 * file." or "Edited file.", so the panel shows the written content instead.
 */

import { ReasoningStepType as S } from './layout-types';
import { asObject } from './tools';

/** Lines shown before a "Show more" toggle. */
export const FILE_CONTENT_PREVIEW_LINES = 20;

/** `add` / `del` are diff lines, `hunk` separates edits, `ctx` is plain content. */
export type FileContentLineKind = 'add' | 'del' | 'hunk' | 'ctx';

export interface FileContentLine {
  kind: FileContentLineKind;
  text: string;
}

export interface FileContentPreview {
  /** True for edits (lines are a diff), false for a created file's content. */
  isDiff: boolean;
  lines: FileContentLine[];
}

/** Keys holding a created file's full content, in priority order. */
const CREATE_KEYS = ['CodeContent', 'Content', 'content', 'file_text', 'contents', 'text', 'code'];
/** Keys holding the text an edit replaces. */
const OLD_KEYS = ['TargetContent', 'Target', 'old_str', 'old_string', 'oldString', 'oldText', 'old_text', 'search'];
/** Keys holding the text an edit writes. */
const NEW_KEYS = ['ReplacementContent', 'Replacement', 'new_str', 'new_string', 'newString', 'newText', 'new_text', 'replace'];
/** Keys holding a list of edits for multi-edit tools. */
const CHUNK_LIST_KEYS = ['ReplacementChunks', 'edits', 'chunks', 'replacements'];
/** Keys holding a unified diff / patch string. */
const PATCH_KEYS = ['patch', 'diff', 'input'];

function firstString(obj: Record<string, any>, keys: string[]): string | undefined {
  for (const k of keys) {
    if (typeof obj[k] === 'string') return obj[k];
  }
  return undefined;
}

function splitLines(text: string): string[] {
  return text.replace(/\n$/, '').split('\n');
}

/** One old/new replacement as `del` lines followed by `add` lines. */
function replacementLines(chunk: Record<string, any>): FileContentLine[] {
  const oldText = firstString(chunk, OLD_KEYS);
  const newText = firstString(chunk, NEW_KEYS);
  const lines: FileContentLine[] = [];
  if (oldText) lines.push(...splitLines(oldText).map(text => ({ kind: 'del' as const, text })));
  if (newText) lines.push(...splitLines(newText).map(text => ({ kind: 'add' as const, text })));
  return lines;
}

/** A unified diff or `*** Begin Patch` block, classified by line prefix. */
function patchLines(patch: string): FileContentLine[] {
  return splitLines(patch).map(line => {
    if (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('***')) {
      return { kind: 'hunk' as const, text: line };
    }
    if (line.startsWith('+')) return { kind: 'add' as const, text: line.slice(1) };
    if (line.startsWith('-')) return { kind: 'del' as const, text: line.slice(1) };
    return { kind: 'ctx' as const, text: line.startsWith(' ') ? line.slice(1) : line };
  });
}

function looksLikePatch(text: string): boolean {
  return /^(\*\*\* Begin Patch|diff --git|--- |@@ )/m.test(text);
}

function editLines(input: unknown): FileContentLine[] {
  if (typeof input === 'string') return looksLikePatch(input) ? patchLines(input) : [];
  const obj = asObject(input);

  const list = CHUNK_LIST_KEYS.map(k => obj[k]).find(v => Array.isArray(v)) as unknown[] | undefined;
  if (list) {
    const chunks = list.map(asObject).map(replacementLines).filter(l => l.length > 0);
    if (chunks.length === 1) return chunks[0];
    return chunks.flatMap((lines, i) => [{ kind: 'hunk' as const, text: `@@ edit ${i + 1} of ${chunks.length} @@` }, ...lines]);
  }

  const single = replacementLines(obj);
  if (single.length > 0) return single;

  const patch = firstString(obj, PATCH_KEYS);
  if (patch && looksLikePatch(patch)) return patchLines(patch);
  return [];
}

/**
 * The content a file tool call wrote, or null when the call isn't a file
 * create / edit or its input carries no content.
 */
export function fileContentPreview(input: unknown, stepType: S | undefined): FileContentPreview | null {
  if (stepType === S.WRITE_TO_FILE) {
    const content = firstString(asObject(input), CREATE_KEYS);
    if (!content) return null;
    return { isDiff: false, lines: splitLines(content).map(text => ({ kind: 'ctx', text })) };
  }
  if (stepType === S.REPLACE_FILE_CONTENT || stepType === S.MULTI_REPLACE_FILE_CONTENT) {
    const lines = editLines(input);
    if (lines.length > 0) return { isDiff: true, lines };
    // Some edit tools rewrite the whole file; show that content instead.
    const content = firstString(asObject(input), CREATE_KEYS);
    return content ? { isDiff: false, lines: splitLines(content).map(text => ({ kind: 'ctx', text })) } : null;
  }
  return null;
}
