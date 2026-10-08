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
 * @fileoverview File events: which trace nodes read, searched, or edited which
 * files. Pure parsing of trace data; `file-lane.ts` turns these into rows.
 */

import { ReasoningStepType as S, ReasoningTrace } from './layout-types';
import { FileAccess, PATH_KEYS, SEARCH_PATH_KEYS, asObject, fileAccess, stripQuotes } from './tools';

/** One file touched by one trace node. */
export interface FileEvent {
  nodeId: string;
  filePath: string;
  kind: FileAccess;
  /** Lines written (edits only). */
  linesCount: number;
  /** A plan / spec / todo document. */
  isPlan: boolean;
}

/** All file events in a trace, in trace order. */
export function extractFileEvents(trace: ReasoningTrace): FileEvent[] {
  const events: FileEvent[] = [];
  for (const step of trace.steps) {
    for (const node of step.nodes) {
      if (!node.data) continue;
      const kind = fileAccess(node.stepType);
      const input = node.data.toolCall?.input ?? node.data.input;

      if (!kind) {
        // Tools that aren't file tools but still write files as a side effect.
        // The mark stays in the tools lane; the write shows in the files lane.
        for (const filePath of extractIndirectWrites(node.stepType, input, node.data.observation)) {
          events.push({ nodeId: node.id, filePath, kind: 'edit', linesCount: 0, isPlan: isPlanPath(filePath, input) });
        }
        continue;
      }

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

/**
 * Files a non-file tool wrote as a side effect: the page a URL fetch saved to
 * disk, or files a shell command created (redirects, tee, Python `open(.., 'w')`,
 * `Path(..).write_text`, curl / wget output). Heuristic; shell parsing is best effort.
 */
function extractIndirectWrites(stepType: S | undefined, input: unknown, observation: unknown): string[] {
  if (stepType === S.READ_URL_CONTENT) {
    const m = observationText(observation).match(/saved to:\s*`?(?:file:\/\/)?([^\s`]+)/i);
    return m ? [m[1]] : [];
  }
  if (stepType !== S.RUN_COMMAND) return [];

  const obj = asObject(input);
  const cmd = decodeString(obj['CommandLine'] ?? obj['command'] ?? obj['cmd']);
  if (!cmd) return [];
  const baseCwd = decodeString(obj['Cwd'] ?? obj['cwd']);

  // `cd DIR` changes where later relative paths resolve.
  const cds = [...cmd.matchAll(/(?:^|[;&|]\s*)cd\s+(['"]?)([^\s'";&|]+)\1/g)]
    .map(m => ({ index: m.index ?? 0, dir: m[2] }));
  const cwdAt = (index: number) =>
    cds.filter(c => c.index < index).reduce((cwd, c) => joinPath(cwd, c.dir), baseCwd);

  const found: string[] = [];
  const add = (raw: string, index: number) => {
    const p = raw.trim();
    if (!looksLikeFilePath(p)) return;
    found.push(joinPath(cwdAt(index), p));
  };
  const q = `\\\\?['"]`;  // a quote, possibly backslash-escaped inside a shell string
  const patterns: RegExp[] = [
    /(?:^|[^<>&\d=-])>>?\s*(['"]?)([^\s'"|;&<>()]+)\1/g,                              // > file, >> file
    /\btee\s+(?:-a\s+)?(['"]?)([^\s'"|;&<>]+)\1/g,                                     // tee file
    new RegExp(`\\bopen\\(\\s*${q}([^'"\\\\]+)${q}\\s*,\\s*${q}[wax]b?\\+?${q}`, 'g'),    // open('f', 'w')
    new RegExp(`\\bPath\\(\\s*${q}([^'"\\\\]+)${q}\\s*\\)\\.write_(?:text|bytes)`, 'g'), // Path('f').write_text
    /\bcurl\b[^;&|]*?\s(?:-o|--output)\s+(['"]?)([^\s'"]+)\1/g,                         // curl -o file
    /\bwget\b[^;&|]*?\s(?:-O|--output-document)\s+(['"]?)([^\s'"]+)\1/g,                 // wget -O file
  ];
  for (const re of patterns) {
    for (const m of cmd.matchAll(re)) add(m[2] ?? m[1], m.index ?? 0);
  }
  // curl -O URL saves to the URL's basename.
  for (const m of cmd.matchAll(/\bcurl\b[^;&|]*/g)) {
    for (const o of m[0].matchAll(/\s(?:-O|--remote-name)\s+(['"]?)(https?:\/\/[^\s'"]+)\1/g)) {
      const name = o[2].split(/[?#]/)[0].split('/').pop();
      if (name) add(name, m.index ?? 0);
    }
  }
  return [...new Set(found)];
}

function observationText(observation: unknown): string {
  return String(typeof observation === 'string' ? observation : asObject(observation)['content'] || '');
}

/** A tool input string, JSON-decoded if it was stored as a JSON string literal. */
function decodeString(v: unknown): string {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    try {
      const parsed = JSON.parse(s);
      if (typeof parsed === 'string') return parsed;
    } catch { /* fall through */ }
  }
  return stripQuotes(s);
}

/** Filters out redirect targets that aren't files (/dev/null, numbers, `x > y` comparisons). */
function looksLikeFilePath(p: string): boolean {
  if (!p || p.startsWith('/dev/') || p.startsWith('&') || p.includes('$') || p.includes('{')) return false;
  if (/^[\d.]+$/.test(p)) return false;
  return p.includes('/') || /\.[a-zA-Z0-9]{1,8}$/.test(p);
}

function joinPath(cwd: string, p: string): string {
  if (!cwd || p.startsWith('/') || p.startsWith('~')) return p;
  const parts = cwd.replace(/\/+$/, '').split('/');
  for (const seg of p.split('/')) {
    if (seg === '..') parts.pop();
    else if (seg && seg !== '.') parts.push(seg);
  }
  return parts.join('/');
}

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
