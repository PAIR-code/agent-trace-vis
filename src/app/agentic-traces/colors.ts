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
 * @fileoverview Color palette, speaker styles, and model-to-color mapping.
 */

import { color as d3Color } from 'd3';


export interface SpeakerStyle {
  color: string;
  bg: string;
  border: string;
}

export function lightenColor(colorStr: string, factor: number): string {
  const c = d3Color(colorStr);
  if (!c) return colorStr;
  const rgb = c.rgb();
  rgb.r = Math.floor(rgb.r + (255 - rgb.r) * factor);
  rgb.g = Math.floor(rgb.g + (255 - rgb.g) * factor);
  rgb.b = Math.floor(rgb.b + (255 - rgb.b) * factor);
  return rgb.toString();
}

export function createStyle(color: string, bgLightness: 'very-light' | 'white' = 'very-light', borderStyle: string = 'solid'): SpeakerStyle {
  return {
    color: color,
    bg: bgLightness === 'white' ? '#ffffff' : lightenColor(color, 0.9),
    border: `1px ${borderStyle} ${lightenColor(color, 0.5)}`
  };
}

export const COLORS = {
  // Brand colors & core components
  USER: '#374151',          // Dark Gray
  USER_BG: '#ffffff',       // User bubble background
  USER_BORDER: '#9ca3af',   // User bubble border
  
  AGENT: '#e9a944',         // Fallback Agent / Muted Mustard
  
  
  // Viewer-specific conversation bubble colors


  VIEWER_THINKING: '#5C7B99', // Muted Blue-gray for thinking text

  VIEWER_RESPONSE: '#4A627A', // Darker Blue-gray
  
  TOOL: '#78909c',          // Gray
  TOOL_LINE: '#c4c9d0',     // Light gray for lines/borders

  // Tool cards in message lists


  ERROR: '#ef4444',         // Red
  ERROR_LIGHT: '#e57373',   // Light Red for node / legend
};

export const SPEAKER_STYLES: { [key: string]: SpeakerStyle } = {
  'user_input': {
    color: COLORS.USER,
    bg: COLORS.USER_BG,
    border: `1px solid ${COLORS.USER_BORDER}`
  },
  'thinking': createStyle(COLORS.VIEWER_THINKING),
  'response': createStyle(COLORS.VIEWER_RESPONSE),
  'tool_call': createStyle(COLORS.TOOL, 'white', 'dashed'),
  'tool_data': createStyle(COLORS.TOOL, 'white'),
  'system': createStyle(COLORS.TOOL, 'white'),
  'error': createStyle(COLORS.ERROR)
};

// Standard Agent Palette: Map known agent names to distinct theme colors
const AGENT_COLORS: Record<string, string> = {
  'jetski': '#e9a944',          // Muted Mustard
  'swe-agent': '#5fa592',       // Sage
  'developer agent': '#6a85c2', // Slate Blue
  'agent': '#e9a944',           // Default Agent color
};

// Muted, earthy categorical palette (the first four are the core colors)
const DISTINCT_PALETTE = [
  '#5fa592', // Sage
  '#e9a944', // Muted Mustard
  '#6a85c2', // Slate Blue
  '#e06a43', // Terracotta / Coral
  '#a86fb5', // Dusty Plum
  '#9aa83f', // Olive
  '#3a9bab', // Teal
  '#db7489', // Dusty Rose
  '#c98945', // Caramel
  '#6db35a', // Moss Green
  '#4e66b0', // Indigo Slate
  '#b8553f', // Brick
];

export function getAgentColor(agentName?: string | null, model?: string | null): string {
  const cleanAgent = (agentName || 'Agent').trim();
  const cleanModel = (model || '').trim();

  // If a model is provided, check for known model brands for distinctive palette colors
  if (cleanModel) {
    const lowerModel = cleanModel.toLowerCase();
    if (lowerModel.includes('gemini') || lowerModel.includes('google')) {
      return '#6a85c2'; // Slate Blue
    }
    if (lowerModel.includes('claude') || lowerModel.includes('anthropic') || lowerModel.includes('sonnet') || lowerModel.includes('opus') || lowerModel.includes('haiku')) {
      return '#e9a944'; // Muted Mustard
    }
    if (lowerModel.includes('gpt') || lowerModel.includes('openai') || lowerModel.includes('cerebras')) {
      return '#5fa592'; // Sage
    }
    if (lowerModel.includes('llama') || lowerModel.includes('meta')) {
      return '#4e66b0'; // Indigo Slate
    }
    if (lowerModel.includes('mistral')) {
      return '#3a9bab'; // Teal
    }
    if (lowerModel.includes('qwen')) {
      return '#9aa83f'; // Olive
    }
  }

  // Check known exact agent names if no distinct model
  if (!cleanModel || cleanModel.toLowerCase() === cleanAgent.toLowerCase()) {
    const lowerAgent = cleanAgent.toLowerCase();
    if (AGENT_COLORS[lowerAgent]) {
      return AGENT_COLORS[lowerAgent];
    }
  }

  // By name alone, so every step of the same agent gets one color whatever its model.
  const key = cleanAgent;

  if (key.toLowerCase() === 'agent') {
    return COLORS.AGENT;
  }

  // Fallback: pick from DISTINCT_PALETTE using hash
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = key.charCodeAt(i) + ((hash << 5) - hash);
  }
  const idx = Math.abs(hash) % DISTINCT_PALETTE.length;
  return DISTINCT_PALETTE[idx];
}

/**
 * Team members usually share one model, so model-based colors would make them
 * all alike. Each member instead gets its own palette color, by its position
 * in the team's member list.
 */
export function teamMemberColor(members: readonly string[], agent: string): string {
  const i = Math.max(0, members.indexOf(agent));
  return DISTINCT_PALETTE[i % DISTINCT_PALETTE.length];
}


