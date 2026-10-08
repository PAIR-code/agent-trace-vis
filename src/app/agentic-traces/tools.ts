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
 * @fileoverview What kind of tool each tool call is, decided once.
 *
 * `TOOLS` maps tool names (which vary by agent harness) to a step type and a
 * label. The trace loader stores the step type on each node; everything
 * downstream (mark icons, the files lane) reads only that step type, via
 * `toolIcon` and `fileAccess` below. Labels are for display only.
 *
 * To support a new harness's tool names, add them to the matching entry.
 */

import { ReasoningStepType as S } from './layout-types';
import type { ToolCall } from './trace';

interface ToolSpec {
  stepType: S;
  /** Whether a lower-cased tool name belongs to this entry. */
  matches: (name: string) => boolean;
  /** Display label; entries without one use `"<tool_name>: <file>"`. */
  label?: (input: Record<string, any>, file: string | null, name: string) => string;
}

const has = (...subs: string[]) => (name: string) => subs.some(s => name.includes(s));
const is = (...names: string[]) => (name: string) => names.includes(name);
const either = (...fs: ((name: string) => boolean)[]) => (name: string) => fs.some(f => f(name));
/** First non-empty string among `keys` in the input, else `fallback`. */
const field = (input: Record<string, any>, keys: string[], fallback: string) =>
  keys.map(k => input[k]).find(v => v) || fallback;

const firstTitle = (list: unknown) => Array.isArray(list) ? list[0]?.title : undefined;

/** Tool families, checked in order; the first match wins. */
const TOOLS: ToolSpec[] = [
  {
    stepType: S.VIEW_FILE,
    matches: either(
      has('view_file', 'viewfile', 'read_file', 'readfile', 'fileread', 'file_read', 'view_content', 'read_content'),
      is('view', 'read', 'cat', 'open')),
    label: (_, file) => `View: ${file || 'file'}`,
  },
  {
    stepType: S.MULTI_REPLACE_FILE_CONTENT,
    matches: has('multi_replace', 'multireplace'),
    label: (_, file) => `Edit: ${file || 'file'}`,
  },
  {
    stepType: S.REPLACE_FILE_CONTENT,
    matches: either(
      has('replace_file', 'replacefile', 'edit_file', 'editfile', 'file_edit', 'fileedit', 'str_replace',
          'apply_diff', 'patch', 'modify_file'),
      is('edit', 'replace')),
    label: (_, file) => `Edit: ${file || 'file'}`,
  },
  {
    stepType: S.WRITE_TO_FILE,
    matches: either(
      has('write_to_file', 'writefile', 'write_file', 'file_write', 'filewrite', 'save_file'),
      is('write', 'create_file')),
    label: (_, file) => `Write: ${file || 'file'}`,
  },
  {
    stepType: S.NOTEBOOK_EDIT,
    matches: has('notebook'),
    label: (_, file) => `Notebook: ${file || 'notebook'}`,
  },
  {
    stepType: S.GREP_SEARCH,
    matches: either(has('grep'), is('rg')),
    label: input => `Grep: ${field(input, ['Query', 'query', 'pattern'], 'search')}`,
  },
  {
    stepType: S.FIND_BY_NAME,
    matches: either(has('find', 'file_search'), is('glob')),
  },
  {
    stepType: S.LIST_DIRECTORY,
    matches: either(has('list_directory', 'listdir', 'list_dir'), is('ls', 'dir')),
    label: input => {
      const dir = field(input, ['DirectoryPath', 'directory', 'path'], 'dir');
      return `List: ${dir.split('/').pop() || dir}`;
    },
  },
  {
    stepType: S.RUN_COMMAND,
    matches: either(has('run_command', 'runcommand', 'execute', 'terminal'), is('bash', 'sh', 'cmd', 'run')),
    label: input => `Run: ${field(input, ['CommandLine', 'command', 'cmd'], 'command')}`,
  },
  {
    stepType: S.READ_URL_CONTENT,
    matches: has('read_url', 'fetch'),
    label: input => `URL: ${field(input, ['Url', 'url'], 'fetch')}`,
  },
  {
    stepType: S.SEARCH_WEB,
    matches: has('search_web', 'websearch', 'google'),
    label: input => `Web: ${field(input, ['Query', 'query'], 'web search')}`,
  },
  {
    stepType: S.CODE_SEARCH,
    matches: has('code_search'),
  },
  // Dashboard-building agents: charts count as files (read with get_*, else written).
  {
    stepType: S.VIEW_FILE,
    matches: name => name.includes('chart') && name.startsWith('get_'),
    label: (input, _, name) => chartLabel(input, name),
  },
  {
    stepType: S.REPLACE_FILE_CONTENT,
    matches: has('chart'),
    label: (input, _, name) => chartLabel(input, name),
  },
  {
    stepType: S.GENERIC,
    matches: has('metric'),
    label: (input, _, name) => firstTitle(input['metrics']) ? `Metric: ${firstTitle(input['metrics'])}` : `Metric (${name})`,
  },
  { stepType: S.GENERIC, matches: has('filter'), label: (_, __, name) => `Filter (${name})` },
  { stepType: S.GENERIC, matches: is('set_header'), label: input => input['title'] ? `Header: ${input['title']}` : 'Header' },
  { stepType: S.GENERIC, matches: is('set_layout'), label: () => 'Layout' },
  { stepType: S.GENERIC, matches: is('profile_data'), label: () => 'SQL Profile' },
  { stepType: S.GENERIC, matches: is('ask_user'), label: () => 'Ask User' },
  { stepType: S.GENERIC, matches: is('upsert_memories'), label: () => 'Save Memory' },
  { stepType: S.GENERIC, matches: is('transition_phase'), label: () => 'Phase Transition' },
];

function chartLabel(input: Record<string, any>, name: string): string {
  const title = firstTitle(input['charts']);
  return title ? `Chart: ${title}` : `Chart (${name})`;
}

/** Step type and display label for a tool call. */
export function classifyTool(tc: ToolCall): { stepType: S; label: string } {
  const name = tc.tool_name.toLowerCase();
  const spec = TOOLS.find(t => t.matches(name));
  // Labels read fields only from object inputs (a raw string input is ignored).
  const input = typeof tc.input === 'object' && tc.input !== null ? tc.input as Record<string, any> : {};
  const path = inputFilePath(tc.input);
  const file = path ? path.split('/').pop() ?? null : null;
  if (spec?.label) return { stepType: spec.stepType, label: spec.label(input, file, tc.tool_name) };
  return { stepType: spec?.stepType ?? S.GENERIC, label: file ? `${tc.tool_name}: ${file}` : tc.tool_name };
}

// ---------------------------------------------------------------------------
// What each step type means downstream
// ---------------------------------------------------------------------------

export type FileAccess = 'view' | 'search' | 'edit';

const FILE_ACCESS: Partial<Record<S, FileAccess>> = {
  [S.VIEW_FILE]: 'view',
  [S.GREP_SEARCH]: 'search',
  [S.FIND_BY_NAME]: 'search',
  [S.WRITE_TO_FILE]: 'edit',
  [S.REPLACE_FILE_CONTENT]: 'edit',
  [S.MULTI_REPLACE_FILE_CONTENT]: 'edit',
  [S.NOTEBOOK_EDIT]: 'edit',
};

/** How a step touches files, or null. These are drawn in the files lane, not the main track. */
export function fileAccess(stepType: S | undefined): FileAccess | null {
  return (stepType && FILE_ACCESS[stepType]) || null;
}

/** Glyph for a tool mark: a terminal for commands, a magnifier for web / code search. */
export function toolIcon(stepType: S | undefined): 'command' | 'search' | undefined {
  switch (stepType) {
    case S.RUN_COMMAND:
    case S.LIST_DIRECTORY:
      return 'command';
    case S.SEARCH_WEB:
    case S.CODE_SEARCH:
    case S.READ_URL_CONTENT:
      return 'search';
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Reading tool inputs
// ---------------------------------------------------------------------------

/** Input keys that name a file, most specific first (harnesses disagree on naming). */
export const PATH_KEYS = [
  'TargetFile', 'AbsolutePath', 'NotebookPath', 'file_path', 'filePath',
  'filepath', 'path', 'file', 'filename', 'file_name', 'target_file',
  'absolute_path', 'notebook_path', 'uri', 'document', 'src', 'dest',
];
/** Input keys that name a search directory (or occasionally a single file). */
export const SEARCH_PATH_KEYS = ['SearchPath', 'search_path', 'searchPath'];

/** Trims whitespace and surrounding quotes / backticks. */
export function stripQuotes(s: string): string {
  return s.trim().replace(/^['"`\s]+|['"`\s]+$/g, '');
}

/** A tool input as an object: JSON strings are parsed; anything else becomes {}. */
export function asObject(input: unknown): Record<string, any> {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      return {};
    }
  }
  return typeof input === 'object' && input !== null ? input as Record<string, any> : {};
}

/** The first file (or search) path named in a tool input, or null. */
export function inputFilePath(input: unknown): string | null {
  const obj = asObject(input);
  const val = [...PATH_KEYS, ...SEARCH_PATH_KEYS].map(k => obj[k]).find(v => v !== undefined && v !== null);
  return typeof val === 'string' ? stripQuotes(val) || null : null;
}
