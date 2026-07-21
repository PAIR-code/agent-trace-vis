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
 * @fileoverview Types, interfaces, and constants for the Analysis Layers
 * feature — multi-layer search overlays for agent trace analysis.
 */

import { SearchResult } from '../shared/search/search.service';

/** A single analysis layer with its search results and visual config. */
export interface AnalysisLayer {
  id: string;
  name: string;
  query: string;
  mode: 'fuzzy' | 'semantic';
  color: string;
  enabled: boolean;
  results: Map<string, SearchResult>;
  loading: boolean;
  isPreset: boolean;
  createdAt: number;
}

/** A preset query template that can be one-click added as a layer. */
export interface AnalysisPreset {
  name: string;
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
    query: 'The agent is repeating the same logical pattern or approach without making progress',
    mode: 'semantic',
    description: 'Detects circular reasoning loops',
  },
  {
    name: 'User frustrated',
    query: 'The user is expressing explicit anger, annoyance, exasperation, or negative emotional frustration toward the agent',
    mode: 'semantic',
    description: 'Explicit negative sentiment detection',
  },
  {
    name: 'User correcting agent',
    query: 'The user is pointing out a mistake, telling the agent it did something incorrectly or wrong, and providing course corrections or alternate instructions',
    mode: 'semantic',
    description: 'Detects user feedback correcting agent mistakes',
  },
  {
    name: 'Permission error',
    query: 'The agent or tool encounters a permission denied error, access violation, or insufficient privileges',
    mode: 'semantic',
    description: 'Detects access denied and permission errors',
  },
  {
    name: 'Ambiguous request',
    query: 'The agent is confused or uncertain because the user prompt is ambiguous, contradictory, or incorrect',
    mode: 'semantic',
    description: 'Detects agent confusion from ambiguous user prompts',
  },
  {
    name: 'Handling ambiguity',
    query: 'The agent identifies multiple possible options in an ambiguous situation and makes an autonomous decision on how to proceed',
    mode: 'semantic',
    description: 'Detects autonomous decision-making under ambiguity',
  },
  {
    name: 'Asks for clarification',
    query: 'The agent asks the user for clarification, additional details, or confirmation',
    mode: 'semantic',
    description: 'Detects when the agent asks the user for clarification',
  },
  {
    name: 'Tool repetition',
    query: 'The agent is calling the same tool repeatedly in quick succession',
    mode: 'semantic',
    description: 'Redundant tool usage',
  },
  {
    name: 'Not following directions',
    query: 'The agent is ignoring or contradicting explicit user instructions',
    mode: 'semantic',
    description: 'Instruction compliance',
  },
  {
    name: 'Stuck',
    query: 'The agent appears stuck, not making meaningful progress toward the goal',
    mode: 'semantic',
    description: 'General stalling detection',
  },
];
