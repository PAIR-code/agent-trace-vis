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
 * @fileoverview Types, interfaces, and constants for the Analysis Layers
 * feature — multi-layer search overlays for agent trace analysis.
 */

import { SearchReport, SearchResult } from '../shared/search/search.service';

/** A single analysis layer with its search results and visual config. */
export interface AnalysisLayer {
  id: string;
  name: string;
  query: string;
  mode: 'fuzzy' | 'semantic';
  color: string;
  enabled: boolean;
  results: Map<string, SearchResult>;
  /** The model's report per trace from the last semantic search. */
  reports: SearchReport[];
  /** Model used for the last semantic search. */
  model?: string;
  /** How long the last search took, in milliseconds. */
  durationMs?: number;
  loading: boolean;
  isPreset: boolean;
  /** For a preset: the group its chip is shown in. */
  category?: PresetCategory;
  createdAt: number;
}

/**
 * Groups the preset chips are shown in, in toolbar order (after "Your
 * searches", the user's own searches).
 */
export const PRESET_CATEGORIES = ['Problem-solving dynamics', 'Transparency', 'Ambiguity', 'User'] as const;
export type PresetCategory = typeof PRESET_CATEGORIES[number];

/** A preset query template that can be one-click added as a layer. */
export interface AnalysisPreset {
  name: string;
  category: PresetCategory;
  query: string;
  mode: 'fuzzy' | 'semantic';
  description: string;
}

/** Curated default color range for Presets: alternating purple and blue shades for high visual contrast. */
export const PRESET_COLORS: string[] = [
  '#8b5cf6', // violet (dark purple)
  '#38bdf8', // light sky blue (light blue)
  '#4f46e5', // dark indigo (dark blue)
  '#a855f7', // purple (light purple)
  '#3b82f6', // blue (medium blue)
  '#06b6d4', // cyan (light cyan)
  '#6366f1', // indigo (medium purple-blue)
  '#0ea5e9', // sky blue (bright blue)
];

/** Curated default color range for User AI semantic searches: alternating shades of teal, green, and yellow. */
export const USER_AI_COLORS: string[] = [
  '#0d9488', // dark teal
  '#eab308', // yellow
  '#22c55e', // green
  '#a3e635', // bright lime
  '#14b8a6', // teal
  '#f59e0b', // amber yellow
  '#10b981', // emerald green
  '#84cc16', // lime green
];

/** Curated default color range for User Text searches: classic orange search highlight color. */
export const USER_TEXT_COLORS: string[] = [
  'rgb(255, 150, 50)', // classic orange highlight
];

/** Built-in preset queries for common agent behavior analysis. */
export const ANALYSIS_PRESETS: AnalysisPreset[] = [
  {
    name: 'Looping',
    category: 'Problem-solving dynamics',
    query: 'The agent is repeating the same logical pattern or approach without making progress',
    mode: 'semantic',
    description: 'Detects circular reasoning loops',
  },
  {
    name: 'User frustrated',
    category: 'User',
    query: 'The user is expressing explicit anger, annoyance, exasperation, or negative emotional frustration toward the agent',
    mode: 'semantic',
    description: 'Explicit negative sentiment detection',
  },
  {
    name: 'User correcting agent',
    category: 'User',
    query: 'The user is pointing out a mistake, telling the agent it did something incorrectly or wrong, and providing course corrections or alternate instructions',
    mode: 'semantic',
    description: 'Detects user feedback correcting agent mistakes',
  },
  {
    name: 'Permission error',
    category: 'Problem-solving dynamics',
    query: 'The agent or tool encounters a permission denied error, access violation, or insufficient privileges',
    mode: 'semantic',
    description: 'Detects access denied and permission errors',
  },
  {
    name: 'Ambiguous request',
    category: 'Ambiguity',
    query: 'The agent is confused or uncertain because the user prompt is ambiguous, contradictory, or incorrect',
    mode: 'semantic',
    description: 'Detects agent confusion from ambiguous user prompts',
  },
  {
    name: 'Handling ambiguity',
    category: 'Ambiguity',
    query: 'The agent identifies multiple possible options in an ambiguous situation and makes an autonomous decision on how to proceed',
    mode: 'semantic',
    description: 'Detects autonomous decision-making under ambiguity',
  },
  {
    name: 'Asks for clarification',
    category: 'Ambiguity',
    query: 'The agent asks the user for clarification, additional details, or confirmation',
    mode: 'semantic',
    description: 'Detects when the agent asks the user for clarification',
  },
  {
    name: 'Tool repetition',
    category: 'Problem-solving dynamics',
    query: 'The agent is calling the same tool repeatedly in quick succession',
    mode: 'semantic',
    description: 'Redundant tool usage',
  },
  {
    name: 'Not following directions',
    category: 'Transparency',
    query: 'The agent is ignoring or contradicting explicit user instructions',
    mode: 'semantic',
    description: 'Instruction compliance',
  },
  {
    name: 'Stuck',
    category: 'Problem-solving dynamics',
    query: 'The agent appears stuck, not making meaningful progress toward the goal',
    mode: 'semantic',
    description: 'General stalling detection',
  },
  {
    name: 'Suspicious behavior',
    category: 'Transparency',
    query: 'Agent is doing something the user might find suspicious',
    mode: 'semantic',
    description: 'Detects potentially suspicious agent actions',
  },
  {
    name: 'Out-of-scope files',
    category: 'Transparency',
    query: 'Agent is looking at or editing files that are outside the expected context',
    mode: 'semantic',
    description: 'Detects file access outside the expected context',
  },
];

// ─── Exported analysis config (download as JSON) ────────────────────

/** Semantic (LLM judge) search method, as written to an exported config. */
export interface AnalysisConfigSemanticMethod {
  model: string;
  generationConfig: { temperature: number; responseMimeType: string };
  /** One model call per trace; turns from different traces are never mixed. */
  scope: 'perTrace';
  /** Format of each turn in `{conversation}` (`{step}` is 1-based); turns are joined with '\n'. */
  turnFormat: string;
  /**
   * Full prompt; placeholders: `{query}`, `{conversation}`. The model returns
   * `{found, report, evidence: [{step, spans, explanation}]}`; evidence steps
   * are the matches.
   */
  promptTemplate: string;
}

/** Fuzzy (text match) search method, as written to an exported config. */
export interface AnalysisConfigFuzzyMethod {
  type: 'caseInsensitiveSubstring';
}

/** A single search in an exported config. */
export interface AnalysisConfigSearch {
  /** Display label of the layer chip (not sent to the model). */
  name: string;
  /** The text that is searched. */
  query: string;
  /** Key into {@link AnalysisConfigV1.methods}. */
  method: 'semantic' | 'fuzzy';
  source: 'preset' | 'user';
  /** What this search found on the exported examples; only when results are exported. */
  results?: AnalysisSearchResults;
}

/** An example (trace) that exported results cover. */
export interface AnalysisResultsExample {
  /** The trace's own id (`trace_id` / `session_id`), else `<dataset>#<index>`. */
  id: string;
  title: string;
  /** Where it was loaded from: source (e.g. `folder`), dataset id, and example index. */
  source?: string;
  dataset?: string;
  index?: number;
}

/** One matching turn. */
export interface AnalysisSearchMatch {
  /** {@link AnalysisResultsExample.id} of the example the turn is in. */
  exampleId: string;
  nodeId: string;
  /** Semantic searches: the turn's 1-based step in its trace, and why it is evidence. */
  step?: number;
  explanation?: string;
}

/** A semantic search's report on one example. */
export interface AnalysisSearchExampleReport {
  /** {@link AnalysisResultsExample.id} of the example. */
  exampleId: string;
  found: boolean;
  report: string;
}

/** A search's results, as already found in the app (searches are not re-run to export). */
export interface AnalysisSearchResults {
  /**
   * `complete`: ran on every exported example. `running`: still running, so
   * the matches are partial or empty. `notRun`: the search is turned off, so
   * it has no current results.
   */
  status: 'complete' | 'running' | 'notRun';
  /** Examples with at least one match, in {@link AnalysisConfigResults.examples} order. */
  matchedExampleIds: string[];
  matches: AnalysisSearchMatch[];
  /** Semantic searches: the model's report per example, in example order. */
  reports?: AnalysisSearchExampleReport[];
}

/** The examples that exported results cover. */
export interface AnalysisConfigResults {
  note: string;
  examples: AnalysisResultsExample[];
}

/** Downloadable config describing all analysis searches and how to run them. */
export interface AnalysisConfigV1 {
  schema: 'agent-trace-vis/autoraters';
  version: 1;
  exportedAt: string;
  methods: {
    semantic?: AnalysisConfigSemanticMethod;
    fuzzy?: AnalysisConfigFuzzyMethod;
  };
  searches: AnalysisConfigSearch[];
  /** Present when results are exported; see {@link AnalysisConfigSearch.results}. */
  results?: AnalysisConfigResults;
}
