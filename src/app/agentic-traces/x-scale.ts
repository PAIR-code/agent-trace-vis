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
 * @fileoverview The horizontal axis: maps a trace position (a timestamp in ms,
 * or a cumulative token count) to an x pixel coordinate.
 *
 * In time mode, idle periods spent waiting for the user to respond are detected
 * as "gaps". By default, the missing time is hidden entirely. When "show user wait"
 * is on, gaps are drawn at full width as dotted backbone segments.
 */

import { AxisMode, BASE_OFFSET, TraceNodeType } from './layout-types';
import { formatElapsedTime } from './layout-utils';
import type { Mark } from './marks';

/** Minimum idle width, in pixels at the base scale, that counts as a gap. */
const MIN_GAP_WIDTH = 20;

/** An idle period, in axis units (ms or tokens). */
export interface TimeRange {
  start: number;
  end: number;
}

/** A gap as drawn: x/width in pixels. */
export interface GapRect {
  x: number;
  width: number;
  compressed: boolean;
}

export interface XAxis {
  /** Pixels per axis unit in active (non-gap) segments. */
  scale: number;
  /** Maps an axis position to x. */
  toX(t: number): number;
  /** Idle gaps, in pixels. */
  gaps: GapRect[];
}

/**
 * Builds an axis starting at `start` (drawn at BASE_OFFSET) with the given
 * scale. If `compressGaps` is set, any gap is compressed (the missing time
 * is hidden entirely).
 */
export function buildAxis(start: number, scale: number, gaps: TimeRange[] = [], compressGaps = false): XAxis {
  const compressed = compressGaps ? gaps.filter(g => g.end > g.start) : [];

  // Each compressed gap removes its entire duration ((g.end - g.start) * scale)
  // from everything after it.
  const toX = (t: number): number => {
    let removed = 0;
    for (const g of compressed) {
      if (t <= g.start) break;
      const duration = (g.end - g.start) * scale;
      const fractionPast = Math.min(1, (t - g.start) / (g.end - g.start));
      removed += fractionPast * duration;
    }
    return BASE_OFFSET + (t - start) * scale - removed;
  };

  return {
    scale,
    toX,
    gaps: gaps.map(g => ({
      x: toX(g.start),
      width: toX(g.end) - toX(g.start),
      compressed: compressed.includes(g),
    })),
  };
}

/**
 * Finds idle periods spent waiting for user input in time mode.
 *
 * Only gaps immediately preceding user input steps are considered. Tool calls,
 * agent thinking, execution time, and subagent work do NOT create gaps.
 * A gap is any period wider than MIN_GAP_WIDTH (measured at `baseScale`)
 * between the end of prior activity and the start of a user input mark.
 * Returned in axis units (milliseconds).
 */
export function findUserWaitGaps(
  members: Array<{ marks: Mark[] }>,
  start: number,
  scale: number,
  baseScale: number,
): TimeRange[] {
  const toT = (x: number) => start + (x - BASE_OFFSET) / scale;
  const threshold = Math.max(MIN_GAP_WIDTH, MIN_GAP_WIDTH * (scale / baseScale));
  const gaps: TimeRange[] = [];

  const allMarks = members.flatMap(m => m.marks).filter(m => !m.hidden);
  const userMarks = allMarks
    .filter(m => m.type === TraceNodeType.USER_INPUT)
    .sort((a, b) => a.x - b.x);

  for (const u of userMarks) {
    const priorMarks = allMarks.filter(m => m !== u && m.x < u.x);
    if (priorMarks.length === 0) continue;

    const prevEnd = Math.max(...priorMarks.map(m => m.x + (m.span || m.width)));
    if (u.x - prevEnd > threshold) {
      gaps.push({
        start: toT(prevEnd),
        end: toT(u.x),
      });
    }
  }

  return gaps;
}

/**
 * When gaps are compressed (hidden), returns the factor by which to grow the scale so
 * the active (non-gap) content fills `targetSpan` again. `maxX` is the right
 * edge of the content on the uncompressed axis built with `scale`.
 */
export function fillScaleMultiplier(gaps: TimeRange[], scale: number, maxX: number, targetSpan: number): number {
  const compressed = gaps.filter(g => g.end > g.start);
  const removed = compressed.reduce((sum, g) => sum + (g.end - g.start) * scale, 0);
  const activeWidth = maxX - removed - BASE_OFFSET;
  const targetActiveWidth = Math.max(50, targetSpan - BASE_OFFSET);
  if (activeWidth <= 0) return 1;
  const mult = targetActiveWidth / activeWidth;
  return Math.abs(mult - 1) > 0.02 ? mult : 1;
}

// ─── Ticks ──────────────────────────────────────────────────────────

const TIME_INTERVALS = [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
const TOKEN_INTERVALS = [100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];

/** Largest "nice" interval that fits about six ticks across `span`. */
function niceInterval(span: number, intervals: number[]): number {
  const rough = span / 6;
  for (let i = intervals.length - 1; i >= 0; i--) {
    if (rough >= intervals[i]) return intervals[i];
  }
  return intervals[0];
}

function formatTokens(tokens: number): string {
  if (tokens === 0) return '0';
  if (tokens >= 1000000) return `+${(tokens / 1000000).toFixed(1).replace('.0', '')}M`;
  if (tokens >= 1000) return `+${(tokens / 1000).toFixed(1).replace('.0', '')}k`;
  return `+${tokens}`;
}

/**
 * Tick marks for the shared axis ruler. With hidden gaps, elapsed-time labels
 * would be misleading, so ticks are unlabeled and only show the interval spacing.
 */
export function computeTicks(
  yAxisMode: AxisMode,
  span: number,
  scale: number,
  gapsHidden: boolean,
): Array<{ label: string; x: number }> {
  if (yAxisMode === 'sequence') return [];
  const intervals = yAxisMode === 'time' ? TIME_INTERVALS : TOKEN_INTERVALS;
  const interval = niceInterval(span, intervals);
  const ticks: Array<{ label: string; x: number }> = [];
  for (let d = 0; d <= span; d += interval) {
    const label = yAxisMode === 'tokens' ? formatTokens(d) : gapsHidden ? '' : formatElapsedTime(d);
    ticks.push({ label, x: BASE_OFFSET + d * scale });
  }
  return ticks;
}
