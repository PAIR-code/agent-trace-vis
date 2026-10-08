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
 * In time mode, long idle periods between activity are detected as "gaps".
 * Gaps are drawn as dotted backbone segments, and when "hide gaps" is on,
 * each gap is compressed to a fixed width (drawn as a squiggle).
 */

import { BASE_OFFSET } from './layout-types';
import { formatElapsedTime } from './layout-utils';

/** Pixel width a hidden (compressed) gap is drawn at. */
const COMPRESSED_GAP_WIDTH = 30;
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
 * scale. If `compressGaps` is set, any gap wider than COMPRESSED_GAP_WIDTH at
 * this scale is squeezed to exactly that width.
 */
export function buildAxis(start: number, scale: number, gaps: TimeRange[] = [], compressGaps = false): XAxis {
  const compressed = compressGaps ? gaps.filter(g => (g.end - g.start) * scale > COMPRESSED_GAP_WIDTH) : [];

  // Each compressed gap removes (gapWidth - COMPRESSED_GAP_WIDTH) pixels from
  // everything after it; positions inside a gap are spread across the
  // compressed width.
  const toX = (t: number): number => {
    let removed = 0;
    for (const g of compressed) {
      if (t <= g.start) break;
      const excess = (g.end - g.start) * scale - COMPRESSED_GAP_WIDTH;
      const fractionPast = Math.min(1, (t - g.start) / (g.end - g.start));
      removed += fractionPast * excess;
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
 * Finds idle gaps between laid-out elements. `extents` are the [left, right]
 * pixel extents of the visible elements on a linear axis built with `scale`.
 * A gap is any stretch wider than MIN_GAP_WIDTH (measured at `baseScale`)
 * covered by no element. Returned in axis units.
 */
export function findIdleGaps(
  extents: Array<[number, number]>,
  start: number,
  scale: number,
  baseScale: number,
): TimeRange[] {
  const toT = (x: number) => start + (x - BASE_OFFSET) / scale;
  const threshold = Math.max(MIN_GAP_WIDTH, MIN_GAP_WIDTH * (scale / baseScale));
  const gaps: TimeRange[] = [];
  let coveredUntil = 5;
  for (const [left, right] of [...extents].sort((a, b) => a[0] - b[0])) {
    if (left - coveredUntil > threshold) {
      gaps.push({ start: toT(coveredUntil), end: toT(left) });
    }
    coveredUntil = Math.max(coveredUntil, right);
  }
  return gaps;
}

/**
 * When gaps are compressed, returns the factor by which to grow the scale so
 * the active (non-gap) content fills `targetSpan` again. `maxX` is the right
 * edge of the content on the uncompressed axis built with `scale`.
 */
export function fillScaleMultiplier(gaps: TimeRange[], scale: number, maxX: number, targetSpan: number): number {
  const compressed = gaps.filter(g => (g.end - g.start) * scale > COMPRESSED_GAP_WIDTH);
  const compressedWidth = compressed.length * COMPRESSED_GAP_WIDTH;
  const removed = compressed.reduce((sum, g) => sum + (g.end - g.start) * scale - COMPRESSED_GAP_WIDTH, 0);
  const activeWidth = maxX - removed - BASE_OFFSET - compressedWidth;
  const targetActiveWidth = Math.max(50, targetSpan - BASE_OFFSET - compressedWidth);
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
  yAxisMode: 'time' | 'tokens',
  span: number,
  scale: number,
  hideGaps: boolean,
): Array<{ label: string; x: number }> {
  const intervals = yAxisMode === 'time' ? TIME_INTERVALS : TOKEN_INTERVALS;
  const interval = niceInterval(span, intervals);
  const ticks: Array<{ label: string; x: number }> = [];
  for (let d = 0; d <= span; d += interval) {
    const label = yAxisMode === 'tokens' ? formatTokens(d) : hideGaps ? '' : formatElapsedTime(d);
    ticks.push({ label, x: BASE_OFFSET + d * scale });
  }
  return ticks;
}
