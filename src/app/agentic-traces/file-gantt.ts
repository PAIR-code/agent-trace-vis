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
 * @fileoverview Computes the data model for the "files" sub-track in the
 * horizontal (row) layout. For each file touched by the agent, this builds a
 * Gantt-style bar that spans from first access to end-of-trace, with
 * variable bar height (joy-plot style, hanging downward) that reflects the
 * cumulative net content change at each edit event.
 *
 * Usage:
 *   const gantt = buildFileGanttData(trace, contentWidth);
 *   // Render gantt.rows as SVG in the file-gantt sub-track.
 */

import { ReasoningTrace, ReasoningStepType } from './layout-types';

// ---------------------------------------------------------------------------
// Public data types
// ---------------------------------------------------------------------------

/** What kind of access this event represents. */
export type FileAccessKind = 'view' | 'search' | 'add' | 'remove' | 'rewrite';

/** A single file-access event extracted from a trace step. */
export interface FileEvent {
  /** Normalised (basename-free) file path as it appears in the tool input. */
  filePath: string;
  /** Basename for display. */
  basename: string;
  kind: FileAccessKind;
  /** True if this file is identified as a plan/specification document. */
  isPlan: boolean;
  /**
   * Amount of lines written / modified in this edit (0 for view events).
   */
  linesCount: number;
  /** Horizontal position in the rendered SVG (pixels), already in row-layout x space. */
  x: number;
  /** The corresponding layout VisNode for click navigation. */
  node: any;
}

/** Discrete view/search marker on the continuous file track. */
export interface FileViewMarker {
  x: number;
  label: string;
  /** True if this is a grep/search event rather than a direct view/read. */
  isSearch?: boolean;
  /** The corresponding layout VisNode for click navigation. */
  node: any;
}

/** Discrete edit segment on top of the continuous file track. */
export interface FileEditSegment {
  /** Left edge in SVG x (row layout). */
  x: number;
  /** Width in pixels of this edit segment. */
  width: number;
  /** Height in pixels (downward from baseline), proportional to lines written. */
  barHeight: number;
  /** Number of lines written/modified. */
  linesCount: number;
  /** True if this is a plan file segment. */
  isPlan: boolean;
  /** Tooltip label. */
  label: string;
  /** The corresponding layout VisNode for click navigation. */
  node: any;
}

/** All data needed to render one file row. */
export interface FileGanttRow {
  filePath: string;
  basename: string;
  /** True if the file was never written to — render at half opacity. */
  viewOnly: boolean;
  /** True if this is a plan or specification document. */
  isPlan: boolean;
  /** x pixel where the track starts (first access/view). */
  startX: number;
  /** x pixel where the track ends (end of trace). */
  endX: number;
  /** Discrete view event markers on this file track. */
  views: FileViewMarker[];
  /** Discrete edit segments on this file track. */
  edits: FileEditSegment[];
}

/** The full data structure for one trace's file gantt. */
export interface FileGanttData {
  rows: FileGanttRow[];
  /** Pixel height needed to render all rows (for SVG sizing). */
  totalHeight: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Vertical space allocated per file row (baseline-to-baseline). */
export const FILE_ROW_HEIGHT = 24;

// ---------------------------------------------------------------------------
// Step-type classification helpers
// ---------------------------------------------------------------------------

const EDIT_STEP_TYPES = new Set<ReasoningStepType>([
  ReasoningStepType.WRITE_TO_FILE,
  ReasoningStepType.REPLACE_FILE_CONTENT,
  ReasoningStepType.MULTI_REPLACE_FILE_CONTENT,
  ReasoningStepType.NOTEBOOK_EDIT,
  ReasoningStepType.CODE_ACTION,
]);

const VIEW_STEP_TYPES = new Set<ReasoningStepType>([
  ReasoningStepType.VIEW_FILE,
  ReasoningStepType.VIEW_CONTENT_CHUNK,
  ReasoningStepType.VIEW_FILE_OUTLINE,
  ReasoningStepType.GREP_SEARCH,
  ReasoningStepType.FIND_BY_NAME,
  ReasoningStepType.FIND,
]);

/** Extract file or chart artifact paths from a tool call input object and observation. */
export function extractFilePaths(
  input: Record<string, any> | string | undefined,
  toolName?: string,
  observation?: Record<string, any> | string | undefined
): string[] {
  const paths: string[] = [];

  let obj: Record<string, any> = {};
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      obj = {};
    }
  } else if (typeof input === 'object' && input !== null) {
    obj = input;
  }

  // 1. Check observation output for matching file paths (e.g. grep results across single or multiple files)
  let obsContent = '';
  if (typeof observation === 'string') {
    obsContent = observation;
  } else if (typeof observation === 'object' && observation !== null) {
    obsContent = observation['content'] || '';
  }

  const obsFilePaths: string[] = [];
  if (obsContent) {
    const lines = obsContent.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
        try {
          const parsed = JSON.parse(trimmed);
          const f = parsed.File || parsed.file || parsed.filename || parsed.path || parsed.data?.path?.text;
          if (typeof f === 'string' && f.trim()) {
            obsFilePaths.push(f.trim().replace(/^['"`\s]+|['"`\s]+$/g, ''));
          }
        } catch {}
      } else {
        const filePathMatch = trimmed.match(/File Path:\s*`?(?:file:\/\/)?([^`\n]+)`?/i);
        if (filePathMatch && filePathMatch[1]) {
          obsFilePaths.push(filePathMatch[1].trim());
        }
      }
    }
  }

  if (obsFilePaths.length > 0) {
    paths.push(...obsFilePaths);
  }

  // 2. Standard file path keys (for coding agents)
  const standardKeys = [
    'TargetFile', 'AbsolutePath', 'NotebookPath', 'file_path', 'filePath',
    'filepath', 'path', 'file', 'filename', 'file_name', 'target_file',
    'absolute_path', 'notebook_path', 'uri', 'document', 'src', 'dest',
    'SearchPath', 'search_path', 'searchPath'
  ];
  for (const k of standardKeys) {
    const val = obj[k];
    if (typeof val === 'string' && val.trim()) {
      let clean = val.trim().replace(/^['"`\s]+|['"`\s]+$/g, '');
      if (clean) {
        if (obsFilePaths.length === 0 || (k !== 'SearchPath' && k !== 'search_path' && k !== 'searchPath')) {
          paths.push(clean);
        } else if (obsFilePaths.length > 0 && /\.[a-zA-Z0-9]+$/.test(clean)) {
          paths.push(clean);
        }
      }
    }
  }

  // Check Includes list if present
  const includes = obj['Includes'] || obj['includes'];
  if (Array.isArray(includes)) {
    for (const inc of includes) {
      if (typeof inc === 'string' && inc.trim() && !inc.includes('*')) {
        paths.push(inc.trim().replace(/^['"`\s]+|['"`\s]+$/g, ''));
      }
    }
  }

  // 3. Chart artifact extraction (for dashboard agents)
  const tName = (toolName || '').toLowerCase();

  if (tName.includes('chart')) {
    const charts = obj['charts'];
    if (Array.isArray(charts)) {
      for (const c of charts) {
        if (typeof c === 'object' && c !== null) {
          const cName = c['name'] || c['title'] || c['id'];
          if (typeof cName === 'string' && cName.trim()) {
            paths.push(`charts/${cName.trim()}`);
          }
        }
      }
    } else if (typeof charts === 'object' && charts !== null) {
      const cName = charts['name'] || charts['title'] || charts['id'];
      if (typeof cName === 'string' && cName.trim()) {
        paths.push(`charts/${cName.trim()}`);
      }
    }

    const cId = obj['name'] || obj['chart'] || obj['chart_name'] || obj['id'];
    if (typeof cId === 'string' && cId.trim() && !paths.length) {
      paths.push(`charts/${cId.trim()}`);
    }

    const names = obj['names'];
    if (Array.isArray(names)) {
      for (const n of names) {
        if (typeof n === 'string' && n.trim()) {
          paths.push(`charts/${n.trim()}`);
        }
      }
    }
  }

  return Array.from(new Set(paths.filter(p => p.length > 0)));
}

export function extractFilePath(input: Record<string, any> | string | undefined, toolName?: string): string | null {
  const paths = extractFilePaths(input, toolName);
  return paths.length > 0 ? paths[0] : null;
}

/** Normalize file path for canonical matching. */
export function normalizeFilePath(rawPath: string): string {
  let p = rawPath.replace(/\\/g, '/').trim();
  p = p.replace(/^['"`\s]+|['"`\s]+$/g, '');
  p = p.replace(/^\.\//, '');
  return p;
}

/** Calculate lines written / modified in an edit tool call. */
function computeEditLines(stepType: ReasoningStepType, input: Record<string, any> | string | undefined): number {
  if (!input) return 5;
  let obj: Record<string, any> = {};
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return 5;
    }
  } else if (typeof input === 'object' && input !== null) {
    obj = input;
  } else {
    return 5;
  }

  const content: string =
    obj['CodeContent'] ??
    obj['ReplacementContent'] ??
    obj['Content'] ??
    obj['content'] ??
    obj['text'] ??
    obj['new_str'] ??
    obj['code'] ??
    '';

  if (typeof content === 'string' && content.length > 0) {
    return Math.max(1, content.split('\n').length);
  }
  return 5;
}

/** Helper to detect if a file path or input represents a planning/specification document. */
export function isPlanPath(filePath: string, input?: Record<string, any>): boolean {
  const pathLower = filePath.toLowerCase();
  const basename = (filePath.split('/').pop() ?? filePath).toLowerCase();

  if (
    basename.includes('plan') ||
    pathLower.includes('plan') ||
    basename.includes('todo') ||
    basename.includes('roadmap') ||
    basename.includes('spec') ||
    basename.includes('scratchpad')
  ) {
    return true;
  }

  if (input) {
    if (input['IsArtifact'] === true) return true;
    const artifactType = input['ArtifactMetadata']?.ArtifactType;
    if (typeof artifactType === 'string' && artifactType.toLowerCase().includes('plan')) {
      return true;
    }
  }

  return false;
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

/**
 * Builds the file gantt data for a single trace.
 *
 * @param trace         The parsed ReasoningTrace containing step/node data.
 * @param layoutNodes   The post-layout VisNodes for this trace (with x already
 *                      set to the time-axis position after row-layout x↔y swap).
 *                      Pass `trace.nodes` from the trace wrapper object.
 * @param contentWidth  The total SVG width in pixels (end-of-trace x position).
 */
export function buildFileGanttData(
  trace: ReasoningTrace,
  layoutNodes: any[],
  contentWidth: number,
): FileGanttData {
  const traceNodes: any[] = layoutNodes;

  // Build a map from node id → x position and VisNode (after row-layout swap)
  const nodeXMap = new Map<string, number>();
  const nodeMap = new Map<string, any>();
  for (const n of traceNodes) {
    nodeXMap.set(n.id, n.x ?? 0);
    nodeMap.set(n.id, n);
  }

  const allEvents: FileEvent[] = [];

  for (const step of trace.steps) {
    for (const node of step.nodes) {
      const data = node.data;
      if (!data) continue;

      const stepType = node.stepType;
      if (!stepType) continue;

      const isEdit = EDIT_STEP_TYPES.has(stepType);
      const isView = VIEW_STEP_TYPES.has(stepType);

      if (!isEdit && !isView) continue;

      const input: Record<string, any> | undefined =
        data?.toolCall?.input ?? data?.input ?? undefined;
      const toolName: string = data?.toolCall?.tool_name ?? node.text ?? '';
      const observation = data?.observation ?? undefined;
      const filePaths = extractFilePaths(input, toolName, observation);
      if (filePaths.length === 0) continue;

      for (const filePath of filePaths) {
        const basename = filePath.split('/').pop() ?? filePath;
        const nodeX = nodeXMap.get(node.id) ?? 0;
        const visNode = nodeMap.get(node.id) ?? node;

        let kind: FileAccessKind;
        let linesCount = 0;

        if (isView) {
          const isGrep = stepType === ReasoningStepType.GREP_SEARCH ||
                         stepType === ReasoningStepType.FIND_BY_NAME ||
                         stepType === ReasoningStepType.FIND ||
                         node.text?.toLowerCase().includes('grep') ||
                         node.text?.toLowerCase().startsWith('find:');
          kind = isGrep ? 'search' : 'view';
          linesCount = 0;
        } else {
          linesCount = computeEditLines(stepType, input);
          if (stepType === ReasoningStepType.WRITE_TO_FILE) {
            kind = 'rewrite';
          } else {
            kind = 'add';
          }
        }

        const isPlan = isPlanPath(filePath, input);

        allEvents.push({ filePath, basename, kind, isPlan, linesCount, x: nodeX, node: visNode });
      }
    }
  }

  // Sort by x (time order)
  allEvents.sort((a, b) => a.x - b.x);

  // -------------------------------------------------------------------------
  // 2. Group events by canonical file path.
  // -------------------------------------------------------------------------
  const fileMap = new Map<string, FileEvent[]>();
  const fileDisplayInfo = new Map<string, { filePath: string; basename: string }>();

  for (const ev of allEvents) {
    const norm = normalizeFilePath(ev.filePath);
    const basename = norm.split('/').pop() ?? norm;

    // Match against existing keys (exact match, or suffix/subpath match)
    let matchedKey: string | null = null;
    for (const k of fileMap.keys()) {
      if (
        k === norm ||
        k.endsWith('/' + norm) ||
        norm.endsWith('/' + k) ||
        (k.split('/').pop() === basename && basename.length > 3)
      ) {
        matchedKey = k;
        break;
      }
    }

    const key = matchedKey ?? norm;
    if (!fileMap.has(key)) {
      fileMap.set(key, []);
      fileDisplayInfo.set(key, { filePath: ev.filePath, basename });
    }
    fileMap.get(key)!.push(ev);
  }

  // Sort files: edited files first, then view-only files.
  // Within each group, order by earliest start time (startX ascending).
  const sortedPaths = [...fileMap.keys()].sort((a, b) => {
    const aEvents = fileMap.get(a)!;
    const bEvents = fileMap.get(b)!;
    const aEdited = aEvents.some(e => e.kind !== 'view' && e.kind !== 'search');
    const bEdited = bEvents.some(e => e.kind !== 'view' && e.kind !== 'search');

    if (aEdited !== bEdited) {
      return aEdited ? -1 : 1;
    }

    const aStart = aEvents[0]?.x ?? 0;
    const bStart = bEvents[0]?.x ?? 0;
    if (aStart !== bStart) {
      return aStart - bStart;
    }

    return a.localeCompare(b);
  });

  // -------------------------------------------------------------------------
  // 3. Build GanttRow per file.
  // -------------------------------------------------------------------------
  const visibleNodes = layoutNodes.filter((n: any) => !n.hidden);
  let traceEndX = visibleNodes.length > 0
    ? Math.max(...visibleNodes.map((n: any) => (n.x ?? 0) + (n.width ?? 0)))
    : contentWidth;

  if (allEvents.length > 0) {
    traceEndX = Math.max(traceEndX, ...allEvents.map(e => e.x));
  }

  const rows: FileGanttRow[] = [];

  for (const key of sortedPaths) {
    const events = fileMap.get(key)!;
    const displayInfo = fileDisplayInfo.get(key) ?? { filePath: key, basename: key.split('/').pop() ?? key };
    const viewOnly = events.every(e => e.kind === 'view' || e.kind === 'search');
    const isPlan = events.some(e => e.isPlan);
    const startX = events[0].x;
    const endX = traceEndX;

    const edits: FileEditSegment[] = [];
    const views: FileViewMarker[] = [];

    for (const ev of events) {
      if (ev.kind === 'view' || ev.kind === 'search') {
        const nodeStepType = ev.node?.stepType;
        const nodeText = ev.node?.text || '';
        const isSearch = ev.kind === 'search' ||
                         nodeStepType === ReasoningStepType.GREP_SEARCH ||
                         nodeText.toLowerCase().includes('grep') ||
                         nodeText.toLowerCase().startsWith('find:');
        const label = isSearch
          ? `${displayInfo.basename}: ${nodeText || 'grep search'}`
          : `${displayInfo.basename}: viewed`;

        views.push({
          x: ev.x,
          label,
          isSearch,
          node: ev.node,
        });
      } else {
        const linesCount = ev.linesCount;
        const barHeight = linesToBarHeight(linesCount);
        edits.push({
          x: ev.x,
          width: 7,
          barHeight,
          linesCount,
          isPlan,
          label: `${displayInfo.basename}: ${linesCount} lines written`,
          node: ev.node,
        });
      }
    }

    rows.push({
      filePath: displayInfo.filePath,
      basename: displayInfo.basename,
      viewOnly,
      isPlan,
      startX,
      endX,
      views,
      edits,
    });
  }

  const totalHeight = Math.max(FILE_ROW_HEIGHT, rows.length * FILE_ROW_HEIGHT + 8);

  return { rows, totalHeight };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps a number of lines written to a bar height in pixels.
 * Uses a logarithmic scale so massive writes don't overflow the row space.
 */
function linesToBarHeight(linesCount: number): number {
  if (linesCount <= 0) return 6;
  // Log scale:
  // 1 line -> 6px
  // 5 lines -> 12px
  // 20 lines -> 17px
  // 100 lines -> 22px
  // 500+ lines -> 26px
  const h = 6 + Math.log1p(linesCount) * 3.2;
  return Math.min(26, Math.round(h));
}
