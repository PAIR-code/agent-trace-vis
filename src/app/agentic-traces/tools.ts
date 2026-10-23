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

/** @fileoverview Tool-kind normalization and helpers used by the visualizer. */

import { ReasoningStepType as S } from './layout-types';
import type { ToolCall } from './trace';
import type { ToolKind } from './trace-extensions';

const has = (...subs: string[]) => (name: string) => subs.some(s => name.includes(s));
const is = (...names: string[]) => (name: string) => names.includes(name);
const either = (...fs: ((name: string) => boolean)[]) => (name: string) => fs.some(f => f(name));
/** First non-empty string among `keys` in the input, else `fallback`. */
const field = (input: Record<string, any>, keys: string[], fallback: string) =>
  keys.map(k => input[k]).find(v => v) || fallback;

const TOOL_KIND_STEP_TYPE: Record<ToolKind, S> = {
  'search.text': S.GREP_SEARCH,
  'search.files': S.FIND_BY_NAME,
  'search.web': S.SEARCH_WEB,
  'search.code': S.CODE_SEARCH,
  'read.file': S.VIEW_FILE,
  'read.url': S.READ_URL_CONTENT,
  'browse.directory': S.LIST_DIRECTORY,
  'change.external': S.GENERIC,
  'file.create': S.WRITE_TO_FILE,
  'file.edit': S.REPLACE_FILE_CONTENT,
  'file.edit.multiple': S.MULTI_REPLACE_FILE_CONTENT,
  'file.delete': S.DELETE_FILE,
  'notebook.edit': S.NOTEBOOK_EDIT,
  'execute.command': S.RUN_COMMAND,
  'delegate.agent': S.INVOKE_SUBAGENT,
  other: S.GENERIC,
};

function kindLabel(kind: ToolKind, input: Record<string, any>, file: string | null, name: string): string {
  switch (kind) {
    case 'search.text':
      return `Search: ${field(input, ['Query', 'query', 'pattern'], name)}`;
    case 'search.files':
      return `Find: ${field(input, ['Pattern', 'pattern', 'Query', 'query', 'path'], name)}`;
    case 'search.web':
      return `Web: ${field(input, ['Query', 'query'], 'web search')}`;
    case 'search.code':
      return `Code search: ${field(input, ['Query', 'query', 'pattern'], name)}`;
    case 'read.file':
      return `View: ${file || 'file'}`;
    case 'read.url':
      return `URL: ${field(input, ['Url', 'url'], 'fetch')}`;
    case 'browse.directory': {
      const dir = field(input, ['DirectoryPath', 'directory', 'path'], 'dir');
      return `List: ${dir.split('/').pop() || dir}`;
    }
    case 'change.external':
      return `External: ${name}`;
    case 'file.create':
      return `Create: ${file || 'file'}`;
    case 'file.edit':
    case 'file.edit.multiple':
      return `Edit: ${file || 'file'}`;
    case 'file.delete':
      return `Delete: ${file || 'file'}`;
    case 'notebook.edit':
      return `Notebook: ${file || 'notebook'}`;
    case 'execute.command':
      return `Run: ${field(input, ['CommandLine', 'command', 'cmd'], 'command')}`;
    case 'delegate.agent': {
      const role = stripQuotes(String(field(input, ['Role', 'role'], '')));
      return role ? `Subagent: ${role}` : 'Subagent';
    }
    case 'other':
      return file ? `${name}: ${file}` : name;
  }
}

/** Resolve the visual classification from a normalized kind and original call. */
export function classifyTool(tc: ToolCall, kind: ToolKind): { stepType: S; label: string } {
  // Labels read fields only from object inputs (a raw string input is ignored).
  const input = typeof tc.input === 'object' && tc.input !== null ? tc.input as Record<string, any> : {};
  const path = inputFilePath(tc.input);
  const file = path ? path.split('/').pop() ?? null : null;
  return { stepType: TOOL_KIND_STEP_TYPE[kind], label: kindLabel(kind, input, file, tc.tool_name) };
}

/** Best-effort fallback for imports missing metadata.tool_kinds entries. */
export function inferToolKind(toolName: string): ToolKind {
  const name = toolName.toLowerCase();
  if (name.includes('chart')) return name.startsWith('get_') ? 'read.file' : 'file.edit';
  if (either(
    has('view_file', 'viewfile', 'read_file', 'readfile', 'fileread', 'file_read', 'view_content', 'read_content'),
    is('view', 'read', 'cat', 'open'))(name)) return 'read.file';
  if (has('notebook')(name)) return 'notebook.edit';
  if (has('delete_file', 'remove_file', 'deletefile', 'removefile')(name)) return 'file.delete';
  if (has('multi_replace', 'multireplace')(name)) return 'file.edit.multiple';
  if (either(
    has('replace_file', 'replacefile', 'edit_file', 'editfile', 'file_edit', 'fileedit', 'str_replace',
      'apply_diff', 'patch', 'modify_file'),
    is('edit', 'replace'))(name)) return 'file.edit';
  if (either(
    has('write_to_file', 'writefile', 'write_file', 'file_write', 'filewrite', 'save_file'),
    is('write', 'create_file'))(name)) return 'file.create';
  if (either(has('grep'), is('rg'))(name)) return 'search.text';
  if (either(has('find', 'file_search'), is('glob'))(name)) return 'search.files';
  if (either(has('list_directory', 'listdir', 'list_dir'), is('ls', 'dir'))(name)) return 'browse.directory';
  if (either(has('run_command', 'runcommand', 'execute', 'terminal'), is('bash', 'sh', 'cmd', 'run'))(name)) {
    return 'execute.command';
  }
  if (has('read_url', 'fetch')(name)) return 'read.url';
  if (has('search_web', 'websearch', 'google')(name)) return 'search.web';
  if (has('code_search')(name)) return 'search.code';
  if (has('subagent', 'spawn_agent', 'invoke_agent', 'delegate')(name)) return 'delegate.agent';
  return 'other';
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
  [S.DELETE_FILE]: 'edit',
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
  'TargetFile', 'AbsolutePath', 'NotebookPath', 'Path', 'file_path', 'filePath',
  'filepath', 'path', 'file', 'filename', 'file_name', 'target_file',
  'absolute_path', 'notebook_path', 'uri', 'document', 'src', 'dest',
];
/** Input keys that name a search directory (or occasionally a single file). */
export const SEARCH_PATH_KEYS = ['SearchPath', 'SearchDirectory', 'search_path', 'searchPath'];

/** Trims whitespace and surrounding quotes / backticks. */
export function stripQuotes(s: string): string {
  return s.trim().replace(/^['"`\s]+|['"`\s]+$/g, '');
}

/** A tool input as an object: JSON strings are parsed; anything else becomes {}. */
export function asObject(input: unknown): Record<string, any> {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input) as Record<string, any>;
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
