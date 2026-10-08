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
 * @fileoverview Layout of the files lane under each trace track: one row per
 * file, spanning from its first access to the end of the trace, with a dot per
 * view/search and a downward bar per edit (taller = more lines written).
 *
 * Markers take their x from the trace node's mark, so they line up with the
 * main track and share its hover / selection / search state.
 */

import { FileEvent, normalizeFilePath } from './file-events';
import { Mark } from './marks';

/** Height of one expanded file row. */
export const FILE_ROW_HEIGHT = 24;

export interface FileViewMarker {
  x: number;
  label: string;
  isSearch: boolean;
  node: Mark;
}

export interface FileEditSegment {
  x: number;
  width: number;
  /** Downward from the row's line, by lines written (log scale). */
  barHeight: number;
  label: string;
  node: Mark;
}

export interface FileRow {
  filePath: string;
  basename: string;
  isPlan: boolean;
  startX: number;
  endX: number;
  views: FileViewMarker[];
  edits: FileEditSegment[];
  /** Ids of every node with a marker on this row. */
  nodeIds: Set<string>;
}

export interface FileLane {
  rows: FileRow[];
  /** Height of the expanded lane. */
  totalHeight: number;
}

/** Lays out one trace's file events against its marks. */
export function buildFileLane(events: FileEvent[], marks: Mark[], contentWidth: number): FileLane {
  const markById = new Map(marks.map(m => [m.id, m]));
  const placed = events
    .filter(ev => markById.has(ev.nodeId))
    .map(ev => ({ ...ev, node: markById.get(ev.nodeId)!, x: markById.get(ev.nodeId)!.x }))
    .sort((a, b) => a.x - b.x);

  // Group by file. Different spellings of the same path (relative vs absolute,
  // or same basename) are merged into the first-seen key.
  const groups = new Map<string, typeof placed>();
  for (const ev of placed) {
    const norm = normalizeFilePath(ev.filePath);
    const basename = norm.split('/').pop() ?? norm;
    const key = [...groups.keys()].find(k =>
      k === norm || k.endsWith('/' + norm) || norm.endsWith('/' + k) ||
      (k.split('/').pop() === basename && basename.length > 3)) ?? norm;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(ev);
  }

  // Rows run to the end of the trace.
  const drawn = marks.filter(m => !m.hidden);
  const endX = Math.max(
    drawn.length > 0 ? Math.max(...drawn.map(m => m.x + m.width)) : contentWidth,
    ...placed.map(e => e.x));

  const rows = [...groups.entries()].map(([key, evs]): FileRow & { key: string } => {
    const first = evs[0];
    const basename = normalizeFilePath(first.filePath).split('/').pop() ?? key;
    const isPlan = evs.some(e => e.isPlan);
    return {
      key,
      filePath: first.filePath,
      basename,
      isPlan,
      startX: first.x,
      endX,
      views: evs.filter(e => e.kind !== 'edit').map(e => ({
        x: e.x,
        isSearch: e.kind === 'search',
        label: e.kind === 'search' ? `${basename}: ${e.node.text || 'grep search'}` : `${basename}: viewed`,
        node: e.node,
      })),
      edits: evs.filter(e => e.kind === 'edit').map(e => ({
        x: e.x,
        width: 7,
        barHeight: linesToBarHeight(e.linesCount),
        label: e.linesCount > 0 ? `${basename}: ${e.linesCount} lines written` : `${basename}: written`,
        node: e.node,
      })),
      nodeIds: new Set(evs.map(e => e.nodeId)),
    };
  });

  // Edited files first, then view-only; each group by first access.
  const edited = (r: FileRow) => r.edits.length > 0;
  rows.sort((a, b) =>
    Number(edited(b)) - Number(edited(a)) || a.startX - b.startX || a.key.localeCompare(b.key));

  return {
    rows: rows.map(({ key, ...row }) => row),
    totalHeight: Math.max(FILE_ROW_HEIGHT, rows.length * FILE_ROW_HEIGHT + 8),
  };
}

/** Lines written → bar height: 1 line ≈ 8px, 100 lines ≈ 21px, capped at 26px. */
function linesToBarHeight(linesCount: number): number {
  if (linesCount <= 0) return 6;
  return Math.min(26, Math.round(6 + Math.log1p(linesCount) * 3.2));
}
