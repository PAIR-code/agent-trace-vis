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
 * @fileoverview Token coloring engine: computes per-token background colors
 * across traces based on frequency, dataset, score, or answer schemes.
 */

import * as d3 from 'd3';

export type ColoringScheme = 'count' | 'total_count' | 'dataset' | 'score' | 'answer' | 'chromogram';

/** Metadata attached to each trace for coloring purposes. */
export interface TraceInfo {
  /** Unique id for the trace (e.g., dataset_file + index). */
  id: string;
  /** Which dataset this trace belongs to. */
  dataset: string;
  /** Score: 0 or 1 (integer). */
  score: number;
  /** Answer string. */
  answer: string;
  /** Normalized tokens for this trace. */
  normalizedTokens: string[];
}

/** Pre-computed statistics for all tokens across all traces. */
export interface TokenStats {
  /** How many *traces* contain this token (once per trace). */
  traceCount: Map<string, number>;
  /** Total occurrence count across all traces. */
  totalCount: Map<string, number>;
  /** Per-dataset trace count for this token. */
  datasetCounts: Map<string, Map<string, number>>;
  /** Per-score trace count (key is score as string). */
  scoreCounts: Map<string, Map<string, number>>;
  /** Per-answer trace count. */
  answerCounts: Map<string, Map<string, number>>;
  /** Global max for each stat (for normalization). */
  maxTraceCount: number;
  maxTotalCount: number;
  /** List of unique datasets. */
  datasets: string[];
  /** List of unique scores. */
  scores: string[];
  /** List of unique answers. */
  answers: string[];
}

/** Compute token stats from all traces. */
export function computeTokenStats(traces: TraceInfo[]): TokenStats {
  const traceCount = new Map<string, number>();
  const totalCount = new Map<string, number>();
  const datasetCounts = new Map<string, Map<string, number>>();
  const scoreCounts = new Map<string, Map<string, number>>();
  const answerCounts = new Map<string, Map<string, number>>();

  const datasetsSet = new Set<string>();
  const scoresSet = new Set<string>();
  const answersSet = new Set<string>();

  for (const trace of traces) {
    datasetsSet.add(trace.dataset);
    scoresSet.add(String(trace.score));
    answersSet.add(trace.answer);

    // Unique tokens in this trace (for traceCount)
    const uniqueInTrace = new Set(trace.normalizedTokens);

    for (const token of uniqueInTrace) {
      traceCount.set(token, (traceCount.get(token) ?? 0) + 1);

      // Dataset counts
      if (!datasetCounts.has(token)) datasetCounts.set(token, new Map());
      const dc = datasetCounts.get(token)!;
      dc.set(trace.dataset, (dc.get(trace.dataset) ?? 0) + 1);

      // Score counts
      const scoreKey = String(trace.score);
      if (!scoreCounts.has(token)) scoreCounts.set(token, new Map());
      const sc = scoreCounts.get(token)!;
      sc.set(scoreKey, (sc.get(scoreKey) ?? 0) + 1);

      // Answer counts
      if (!answerCounts.has(token)) answerCounts.set(token, new Map());
      const ac = answerCounts.get(token)!;
      ac.set(trace.answer, (ac.get(trace.answer) ?? 0) + 1);
    }

    // Total counts (including duplicates within the trace)
    for (const token of trace.normalizedTokens) {
      totalCount.set(token, (totalCount.get(token) ?? 0) + 1);
    }
  }

  const maxTraceCount = Math.max(1, ...Array.from(traceCount.values()));
  const maxTotalCount = Math.max(1, ...Array.from(totalCount.values()));

  return {
    traceCount,
    totalCount,
    datasetCounts,
    scoreCounts,
    answerCounts,
    maxTraceCount,
    maxTotalCount,
    datasets: Array.from(datasetsSet).sort(),
    scores: Array.from(scoresSet).sort(),
    answers: Array.from(answersSet).sort((a, b) => {
      const numA = parseFloat(a);
      const numB = parseFloat(b);
      if (!isNaN(numA) && !isNaN(numB)) {
        return numA - numB;
      }
      return a.localeCompare(b);
    }),
  };
}

// ────────────────────────────────────────────────
// Color palettes
// ────────────────────────────────────────────────

/** Dataset colors — using D3 scheme. */
const DATASET_COLORS = d3.schemeTableau10;

/** Score colors: 0 = red, 1 = blue. */
const SCORE_COLORS: Record<string, string> = {
  '0': d3.schemeTableau10[2],
  '1': d3.schemeTableau10[3],
};

/** Generate a color for unique answer values — evenly spaced hues. */
function answerColor(index: number, total: number): string {
  const hue = (index / Math.max(total, 1)) * 360;
  const [r, g, b] = hslToRgb(hue, 70, 50);
  return `rgb(${r}, ${g}, ${b})`;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100;
  l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

// ────────────────────────────────────────────────
// Get color for a single token
// ────────────────────────────────────────────────

/**
 * Returns an `rgba(...)` CSS color string for a token under the given scheme.
 */
export function getTokenColor(
  normalizedToken: string,
  rawToken: string,
  scheme: ColoringScheme,
  stats: TokenStats,
): string {
  if (/^\s+$/.test(rawToken)) return 'transparent';

  switch (scheme) {
    case 'count': {
      const count = stats.traceCount.get(normalizedToken) ?? 0;
      const t = count / stats.maxTraceCount;
      // Dark purple scale — more opaque = higher count
      return `rgba(90, 50, 160, ${0.05 + t * 0.85})`;
    }

    case 'total_count': {
      const count = stats.totalCount.get(normalizedToken) ?? 0;
      const t = Math.log2(count + 1) / Math.log2(stats.maxTotalCount + 1);
      return `rgba(20, 100, 120, ${0.05 + t * 0.85})`;
    }

    case 'dataset': {
      const dc = stats.datasetCounts.get(normalizedToken);
      if (!dc) return 'transparent';
      return blendCategoricalColors(dc, stats.datasets, DATASET_COLORS);
    }

    case 'score': {
      const sc = stats.scoreCounts.get(normalizedToken);
      if (!sc) return 'transparent';
      const colors = stats.scores.map(s => SCORE_COLORS[s] ?? '#808080');
      return blendCategoricalColors(sc, stats.scores, colors);
    }

    case 'answer': {
      const ac = stats.answerCounts.get(normalizedToken);
      if (!ac) return 'transparent';
      const colors = stats.answers.map((_, i) => answerColor(i, stats.answers.length));
      return blendCategoricalColors(ac, stats.answers, colors);
    }

    case 'chromogram': {
      if (!normalizedToken) return 'transparent';
      const firstChar = normalizedToken[0];
      const code = firstChar.charCodeAt(0);
      
      let rank = -1;
      if (code >= 48 && code <= 57) { // 0-9
        rank = code - 48;
      } else if (code >= 97 && code <= 122) { // a-z
        rank = code - 97 + 10;
      }
      
      if (rank !== -1) {
        const t = rank / 35;
        return d3.interpolateTurbo(t);
      }
      return 'transparent';
    }

    default:
      return 'transparent';
  }
}

/**
 * Blend multiple categorical colors weighted by counts.
 * Result is the weighted average of the category colors, with alpha
 * proportional to how "concentrated" the distribution is.
 */
function blendCategoricalColors(
  countMap: Map<string, number>,
  categories: string[],
  palette: readonly string[],
): string {
  let totalCount = 0;
  for (const cat of categories) {
    totalCount += countMap.get(cat) ?? 0;
  }
  if (totalCount === 0) return 'transparent';

  let r = 0, g = 0, b = 0;
  for (let i = 0; i < categories.length; i++) {
    const count = countMap.get(categories[i]) ?? 0;
    const weight = count / totalCount;
    const colorStr = palette[i % palette.length];
    const c = d3.color(colorStr);
    if (c) {
      const rgb = c.rgb();
      r += rgb.r * weight;
      g += rgb.g * weight;
      b += rgb.b * weight;
    }
  }

  return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
}

/**
 * Returns the dataset color palette for the legend.
 */
export function getDatasetColors(datasets: string[]): { label: string; color: string }[] {
  return datasets.map((ds, i) => {
    const c = DATASET_COLORS[i % DATASET_COLORS.length];
    return { label: ds, color: c };
  });
}

/**
 * Returns the score color palette for the legend.
 */
export function getScoreColors(): { label: string; color: string }[] {
  return [
    { label: 'Score 0', color: SCORE_COLORS['0'] },
    { label: 'Score 1', color: SCORE_COLORS['1'] },
  ];
}

/**
 * Returns the chromogram color palette for the legend.
 */
export function getChromogramLegend(): { label: string; color: string }[] {
  return [
    { label: '0-9', color: d3.interpolateTurbo(5 / 35) },
    { label: 'a-m', color: d3.interpolateTurbo(16 / 35) },
    { label: 'n-z', color: d3.interpolateTurbo(28 / 35) },
  ];
}

/**
 * Returns a CSS linear gradient for the continuous chromogram legend.
 */
export function getChromogramGradient(): string {
  const stops = [];
  for (let i = 0; i <= 10; i++) {
    stops.push(d3.interpolateTurbo(i / 10));
  }
  return `linear-gradient(to right, ${stops.join(', ')})`;
}
