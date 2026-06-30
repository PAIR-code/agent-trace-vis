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
 * @fileoverview Jaccard similarity utilities (pairwise, matrix, char-ngram,
 * fuzzy token merging via union-find).
 */

import { normalizeToken } from '../unstructured-traces/tokenizer';

// ────────────────────────────────────────────────
// Core pair-wise Jaccard
// ────────────────────────────────────────────────

/** Jaccard similarity between two sets: |A ∩ B| / |A ∪ B|. */
export function jaccardSimilarity(setA: Set<string>, setB: Set<string>): number {
  let intersectionSize = 0;
  const [small, large] = setA.size < setB.size ? [setA, setB] : [setB, setA];
  for (const item of small) {
    if (large.has(item)) {
      intersectionSize++;
    }
  }
  const unionSize = setA.size + setB.size - intersectionSize;
  return unionSize === 0 ? 0 : intersectionSize / unionSize;
}

// ────────────────────────────────────────────────
// Matrix form (for unstructured-reasoning-graph)
// ────────────────────────────────────────────────

/**
 * Build a full NxN Jaccard-similarity matrix from an array of texts.
 * Each text is tokenized by whitespace and normalized.
 */
export function jaccardSimilarityMatrix(texts: string[]): number[][] {
  const n = texts.length;
  const tokenSets = texts.map(text => {
    const tokens = text.split(/\s+/).map(t => normalizeToken(t)).filter(Boolean);
    return new Set(tokens);
  });

  const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    matrix[i][i] = 1;
    for (let j = i + 1; j < n; j++) {
      const sim = jaccardSimilarity(tokenSets[i], tokenSets[j]);
      matrix[i][j] = sim;
      matrix[j][i] = sim;
    }
  }
  return matrix;
}

// ────────────────────────────────────────────────
// Character n-gram Jaccard for single tokens
// ────────────────────────────────────────────────

/**
 * Build a set of character n-grams (default bigrams) from a string.
 * Used for fuzzy token-level comparison where full-word tokenization
 * would produce singleton sets.
 */
export function charNgrams(s: string, n = 2): Set<string> {
  const grams = new Set<string>();
  const lower = s.toLowerCase();
  if (lower.length < n) {
    grams.add(lower);
    return grams;
  }
  for (let i = 0; i <= lower.length - n; i++) {
    grams.add(lower.substring(i, i + n));
  }
  return grams;
}

/**
 * Jaccard similarity between two strings using character n-grams.
 * Returns a value in [0, 1].
 */
export function jaccardTokenSimilarity(a: string, b: string, ngramSize = 2): number {
  if (a === b) return 1;
  const gramsA = charNgrams(a, ngramSize);
  const gramsB = charNgrams(b, ngramSize);
  return jaccardSimilarity(gramsA, gramsB);
}

// ────────────────────────────────────────────────
// Fuzzy merge via Union-Find (two-phase)
// ────────────────────────────────────────────────

/** A precomputed similarity pair (indices into the tokens array). */
export interface SimilarityPair {
  i: number;
  j: number;
  sim: number;
}

/**
 * Phase 1 (expensive): precompute all pairwise Jaccard char-ngram
 * similarities for a set of unique tokens. Returns an array of
 * {i, j, sim} pairs — only pairs with sim > 0 are stored.
 *
 * Cache the result; it only needs to be recomputed when the token set changes.
 */
export function precomputeTokenSimilarities(
  tokens: string[],
  ngramSize = 2,
): SimilarityPair[] {
  const gramSets = tokens.map(t => charNgrams(t, ngramSize));
  const pairs: SimilarityPair[] = [];

  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      const sim = jaccardSimilarity(gramSets[i], gramSets[j]);
      if (sim > 0) {
        pairs.push({ i, j, sim });
      }
    }
  }

  return pairs;
}

/**
 * Phase 2 (cheap): given precomputed similarity pairs, apply a threshold
 * via union-find and return a Map from each token to its canonical
 * representative (highest-count member of its cluster).
 */
export function mergeTokensByThreshold(
  tokens: string[],
  pairs: SimilarityPair[],
  threshold: number,
  tokenCounts?: Map<string, number>,
): Map<string, string> {
  if (threshold >= 1) {
    const identity = new Map<string, string>();
    for (const t of tokens) identity.set(t, t);
    return identity;
  }

  // Union-Find
  const parent = new Int32Array(tokens.length);
  const rank = new Int32Array(tokens.length);
  for (let i = 0; i < tokens.length; i++) parent[i] = i;

  function find(x: number): number {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path halving
      x = parent[x];
    }
    return x;
  }

  function unite(a: number, b: number) {
    a = find(a);
    b = find(b);
    if (a === b) return;
    if (rank[a] < rank[b]) [a, b] = [b, a];
    parent[b] = a;
    if (rank[a] === rank[b]) rank[a]++;
  }

  // Only unite pairs above threshold
  for (const p of pairs) {
    if (p.sim >= threshold) {
      unite(p.i, p.j);
    }
  }

  // Group by root
  const groups = new Map<number, number[]>();
  for (let i = 0; i < tokens.length; i++) {
    const root = find(i);
    let g = groups.get(root);
    if (!g) {
      g = [];
      groups.set(root, g);
    }
    g.push(i);
  }

  // Pick canonical: highest-count member, or lexicographically first
  const mapping = new Map<string, string>();
  for (const members of groups.values()) {
    let bestIdx = members[0];
    let bestCount = tokenCounts?.get(tokens[bestIdx]) ?? 0;
    for (let k = 1; k < members.length; k++) {
      const c = tokenCounts?.get(tokens[members[k]]) ?? 0;
      if (c > bestCount || (c === bestCount && tokens[members[k]] < tokens[bestIdx])) {
        bestIdx = members[k];
        bestCount = c;
      }
    }
    const canonical = tokens[bestIdx];
    for (const idx of members) {
      mapping.set(tokens[idx], canonical);
    }
  }

  return mapping;
}

/**
 * Convenience wrapper: precompute + merge in one call.
 * Use the two-phase API if you need to re-threshold without recomputing.
 */
export function fuzzyMergeTokens(
  tokens: string[],
  threshold: number,
  tokenCounts?: Map<string, number>,
  ngramSize = 2,
): Map<string, string> {
  const pairs = precomputeTokenSimilarities(tokens, ngramSize);
  return mergeTokensByThreshold(tokens, pairs, threshold, tokenCounts);
}
