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
 * @fileoverview File events: which trace nodes read, searched, or edited which
 * files. Pure parsing of trace data; `file-lane.ts` turns these into rows.
 */

import { ReasoningStepType, ReasoningTrace, ReasoningTraceNode } from './layout-types';

export type FileAccessKind = 'view' | 'search' | 'edit';

/** One file touched by one trace node. */
export interface FileEvent {
  nodeId: string;
  filePath: string;
  kind: FileAccessKind;
  /** Lines written (edits only). */
  linesCount: number;
  /** A plan / spec / todo document. */
  isPlan: boolean;
}

const EDIT_STEP_TYPES = new Set<string>([
  ReasoningStepType.WRITE_TO_FILE,
  ReasoningStepType.REPLACE_FILE_CONTENT,
  ReasoningStepType.MULTI_REPLACE_FILE_CONTENT,
  ReasoningStepType.NOTEBOOK_EDIT,
  ReasoningStepType.CODE_ACTION,
]);

const VIEW_STEP_TYPES = new Set<string>([
  ReasoningStepType.VIEW_FILE,
  ReasoningStepType.VIEW_CONTENT_CHUNK,
  ReasoningStepType.VIEW_FILE_OUTLINE,
]);

const SEARCH_STEP_TYPES = new Set<string>([
  ReasoningStepType.GREP_SEARCH,
  ReasoningStepType.FIND_BY_NAME,
  ReasoningStepType.FIND,
]);

/**
 * File edits, views, and grep/find searches. The timeline hides these nodes in
 * the main track because they are drawn in the files lane instead.
 */
export function isFileEventNode(node: ReasoningTraceNode): boolean {
  const stepType = node.stepType || '';
  if (EDIT_STEP_TYPES.has(stepType) || VIEW_STEP_TYPES.has(stepType) || SEARCH_STEP_TYPES.has(stepType)) {
    return true;
  }
  const text = (node.text || '').toLowerCase();
  return ['edit:', 'write:', 'chart:', 'view:', 'grep:', 'find:'].some(p => text.startsWith(p)) ||
    ['replace file content', 'write to file', 'notebook edit'].some(s => text.includes(s));
}

/** All file events in a trace, in trace order. */
export function extractFileEvents(trace: ReasoningTrace): FileEvent[] {
  const events: FileEvent[] = [];
  for (const step of trace.steps) {
    for (const node of step.nodes) {
      const stepType = node.stepType || '';
      const text = (node.text || '').toLowerCase();
      const kind: FileAccessKind | null =
        EDIT_STEP_TYPES.has(stepType) ? 'edit'
        : SEARCH_STEP_TYPES.has(stepType) || (VIEW_STEP_TYPES.has(stepType) &&
            (text.includes('grep') || text.startsWith('find:'))) ? 'search'
        : VIEW_STEP_TYPES.has(stepType) ? 'view'
        : null;
      if (!kind || !node.data) continue;

      const input = node.data.toolCall?.input ?? node.data.input;
      const toolName: string = node.data.toolCall?.tool_name ?? node.text ?? '';
      for (const filePath of extractFilePaths(input, toolName, node.data.observation)) {
        events.push({
          nodeId: node.id,
          filePath,
          kind,
          linesCount: kind === 'edit' ? countEditLines(input) : 0,
          isPlan: isPlanPath(filePath, input),
        });
      }
    }
  }
  return events;
}

/** Normalizes a file path for matching the same file across events. */
export function normalizeFilePath(rawPath: string): string {
  return stripQuotes(rawPath.replace(/\\/g, '/')).replace(/^\.\//, '');
}

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

function stripQuotes(s: string): string {
  return s.trim().replace(/^['"`\s]+|['"`\s]+$/g, '');
}

function asObject(input: unknown): Record<string, any> {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      return {};
    }
  }
  return typeof input === 'object' && input !== null ? input as Record<string, any> : {};
}

const PATH_KEYS = [
  'TargetFile', 'AbsolutePath', 'NotebookPath', 'file_path', 'filePath',
  'filepath', 'path', 'file', 'filename', 'file_name', 'target_file',
  'absolute_path', 'notebook_path', 'uri', 'document', 'src', 'dest',
];
const SEARCH_PATH_KEYS = ['SearchPath', 'search_path', 'searchPath'];

/** File (or chart artifact) paths referenced by a tool call's input and observation. */
function extractFilePaths(input: unknown, toolName: string, observation: unknown): string[] {
  const obj = asObject(input);
  const paths: string[] = [];

  // 1. Files listed in the observation (e.g. grep results across several files).
  const obsContent = typeof observation === 'string' ? observation : asObject(observation)['content'] || '';
  const obsPaths: string[] = [];
  for (const line of String(obsContent).split('\n')) {
    const trimmed = line.trim();
    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const parsed = asObject(trimmed);
      const f = parsed['File'] || parsed['file'] || parsed['filename'] || parsed['path'] || parsed['data']?.path?.text;
      if (typeof f === 'string' && f.trim()) obsPaths.push(stripQuotes(f));
    } else {
      const m = trimmed.match(/File Path:\s*`?(?:file:\/\/)?([^`\n]+)`?/i);
      if (m?.[1]) obsPaths.push(m[1].trim());
    }
  }
  paths.push(...obsPaths);

  // 2. Path-like input keys. A search directory only counts if nothing more
  //    specific was found (or it names a single file).
  for (const k of PATH_KEYS) {
    if (typeof obj[k] === 'string' && stripQuotes(obj[k])) paths.push(stripQuotes(obj[k]));
  }
  for (const k of SEARCH_PATH_KEYS) {
    const clean = typeof obj[k] === 'string' ? stripQuotes(obj[k]) : '';
    if (clean && (obsPaths.length === 0 || /\.[a-zA-Z0-9]+$/.test(clean))) paths.push(clean);
  }
  const includes = obj['Includes'] || obj['includes'];
  if (Array.isArray(includes)) {
    for (const inc of includes) {
      if (typeof inc === 'string' && inc.trim() && !inc.includes('*')) paths.push(stripQuotes(inc));
    }
  }

  // 3. Chart artifacts (dashboard agents).
  if (toolName.toLowerCase().includes('chart')) {
    const chartName = (c: any) => {
      const n = c?.['name'] || c?.['title'] || c?.['id'];
      return typeof n === 'string' && n.trim() ? `charts/${n.trim()}` : null;
    };
    const charts = obj['charts'];
    for (const c of Array.isArray(charts) ? charts : charts ? [charts] : []) {
      const p = chartName(c);
      if (p) paths.push(p);
    }
    const id = obj['name'] || obj['chart'] || obj['chart_name'] || obj['id'];
    if (typeof id === 'string' && id.trim() && !paths.length) paths.push(`charts/${id.trim()}`);
    if (Array.isArray(obj['names'])) {
      for (const n of obj['names']) {
        if (typeof n === 'string' && n.trim()) paths.push(`charts/${n.trim()}`);
      }
    }
  }

  return [...new Set(paths.filter(p => p.length > 0))];
}

/** Lines written by an edit tool call (5 if the content can't be found). */
function countEditLines(input: unknown): number {
  const obj = asObject(input);
  const content = obj['CodeContent'] ?? obj['ReplacementContent'] ?? obj['Content'] ??
    obj['content'] ?? obj['text'] ?? obj['new_str'] ?? obj['code'];
  return typeof content === 'string' && content.length > 0 ? Math.max(1, content.split('\n').length) : 5;
}

/** Whether a file is a plan / spec / todo document. */
function isPlanPath(filePath: string, input: unknown): boolean {
  const pathLower = filePath.toLowerCase();
  const basename = pathLower.split('/').pop() ?? pathLower;
  if (pathLower.includes('plan') || ['todo', 'roadmap', 'spec', 'scratchpad'].some(w => basename.includes(w))) {
    return true;
  }
  const obj = asObject(input);
  const artifactType = obj['ArtifactMetadata']?.ArtifactType;
  return obj['IsArtifact'] === true || (typeof artifactType === 'string' && artifactType.toLowerCase().includes('plan'));
}
