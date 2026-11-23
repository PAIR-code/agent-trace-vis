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
  'message.send': S.SEND_MESSAGE,
  'message.receive': S.RECEIVE_MESSAGE,
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
      return `Run: ${field(input, ['CommandLine', 'command', 'cmd'], name)}`;
    case 'delegate.agent': {
      const role = stripQuotes(String(field(input, ['Role', 'role'], '')));
      return role ? `Subagent: ${role}` : 'Subagent';
    }
    case 'message.send': {
      const to = input['to'] ?? input['recipient'] ?? input['user_id'];
      const recipients = Array.isArray(to) ? to.join(', ') : (to ? String(to) : 'all');
      const text = String(field(input, ['text', 'message', 'content'], ''));
      return text ? `Message → ${recipients}: ${text}` : `Message → ${recipients}`;
    }
    case 'message.receive':
      return name.replace(/_/g, ' ');
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
  if (has('send_message')(name)) return 'message.send';
  if (has('read_message', 'check_notification')(name)) return 'message.receive';
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

/** Whether a step sends or receives peer messages. These are drawn in the messages lane, not the tools lane. */
export function isMessageTool(stepType: S | undefined): boolean {
  return stepType === S.SEND_MESSAGE || stepType === S.RECEIVE_MESSAGE;
}

/** Glyphs that tell tool kinds apart in the tools lane (the "Tool icons" toggle shows or hides them). */
export type ToolIcon = 'command' | 'git' | 'python' | 'folder' | 'web' | 'search' | 'link' | 'agent';
export const TOOL_ICONS: ReadonlySet<string> =
  new Set<ToolIcon>(['command', 'git', 'python', 'folder', 'web', 'search', 'link', 'agent']);

/**
 * Simple shell commands shown by name (tiny text in the terminal box) rather
 * than a generic `>_`. At most four letters, to fit the 12px mark.
 */
const SIMPLE_COMMANDS: ReadonlySet<string> = new Set([
  'ls', 'cat', 'cd', 'pwd', 'echo', 'head', 'tail', 'wc', 'rm', 'cp', 'mv',
  'grep', 'rg', 'find', 'sed', 'awk', 'diff', 'curl', 'tree', 'npm', 'make',
]);
/** Leading words that wrap the real command (`sudo`, `env`, `timeout 30`, ...). */
const COMMAND_PREFIXES: ReadonlySet<string> = new Set(['sudo', 'env', 'time', 'nohup', 'exec', 'command']);
/** Commands that only set up the shell; the next command in the line is the real one. */
const SETUP_COMMANDS: ReadonlySet<string> = new Set(['cd', 'export', 'source', '.', 'set', 'unset', 'pushd', 'popd']);

/** A shell command's text, from a run-command tool input. */
export function commandText(input: unknown): string {
  if (typeof input === 'string' && !input.trim().startsWith('{')) return stripQuotes(input);
  const obj = asObject(input);
  const v = obj['CommandLine'] ?? obj['command'] ?? obj['cmd'];
  return typeof v === 'string' ? stripQuotes(v) : Array.isArray(v) ? v.join(' ') : '';
}

/**
 * Glyph for a shell command, by the program it runs: the git logo for git,
 * the Python logo for Python (python, pip, pytest, ...), the program's name for
 * simple commands (ls, cat, ...), else the generic terminal `>_`. Setup steps
 * like `cd dir &&` and wrappers like `sudo` / `timeout 30` are skipped.
 */
export function commandGlyph(command: string): { icon: ToolIcon; text?: string } {
  let firstSetup: string | undefined;
  for (const segment of command.split(/&&|\|\||;|\||\n/)) {
    const words = segment.trim().split(/\s+/).filter(Boolean);
    while (words.length > 0 && (/^\w+=/.test(words[0]) || COMMAND_PREFIXES.has(words[0]))) words.shift();
    if (words[0] === 'timeout') words.splice(0, /^\d/.test(words[1] ?? '') ? 2 : 1);
    if (words.length === 0) continue;
    const program = words[0].split('/').pop()!.toLowerCase();
    if (SETUP_COMMANDS.has(program)) {
      firstSetup ??= program;
      continue;
    }
    if (program === 'git') return { icon: 'git' };
    if (/^(python[\d.]*|pip\d*|pytest|ipython|jupyter)$/.test(program) ||
        words.some(w => /^python[\d.]*$/.test(w.split('/').pop()!))) {
      return { icon: 'python' };
    }
    if (SIMPLE_COMMANDS.has(program)) return { icon: 'command', text: program };
    return { icon: 'command' };
  }
  // Only setup steps (e.g. a bare `cd dir`).
  return firstSetup && SIMPLE_COMMANDS.has(firstSetup) ? { icon: 'command', text: firstSetup } : { icon: 'command' };
}

/**
 * Glyph for a tool mark: a terminal for commands, a folder for directory
 * listings, a globe for web search, a magnifier for code search, a link for
 * URL fetches, and a branch for subagent launches. Other tools (and file
 * tools, which are drawn in the files lane) get none: a plain circle.
 */
export function toolIcon(stepType: S | undefined): ToolIcon | undefined {
  switch (stepType) {
    case S.RUN_COMMAND: return 'command';
    case S.LIST_DIRECTORY: return 'folder';
    case S.SEARCH_WEB: return 'web';
    case S.CODE_SEARCH: return 'search';
    case S.READ_URL_CONTENT: return 'link';
    case S.INVOKE_SUBAGENT: return 'agent';
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
