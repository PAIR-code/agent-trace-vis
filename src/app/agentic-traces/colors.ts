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
  return rgb.formatHex();
}

export function darkenColor(colorStr: string, factor: number = 1): string {
  const c = d3Color(colorStr);
  return c ? c.darker(factor).formatHex() : colorStr;
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
  
  AGENT: '#d97706',         // Fallback Agent / Warm Orange
  AGENT_DARK: '#78350f',    // Fallback Dark Agent
  AGENT_BORDER_LIGHT: '#e5e7eb', // Light border
  
  THINKING: '#fbd38d',      // Muted Yellow for nodes/legend
  THINKING_WAITING: '#b45309', // Darker brown/orange when waiting
  
  // Viewer-specific conversation bubble colors
  VIEWER_USER: '#374151',
  VIEWER_USER_BG: '#ffffff',
  VIEWER_USER_BORDER: '#9ca3af',

  VIEWER_AGENT: '#ca8a04', // Agent default text/badge color in message cards
  VIEWER_AGENT_BG: '#ffffff',
  VIEWER_AGENT_BORDER: '#d1d5db',

  VIEWER_THINKING: '#5C7B99', // Muted Blue-gray for thinking text
  VIEWER_THINKING_BG: '#fce4ec', // Pink background for thinking message card
  VIEWER_THINKING_BORDER: '#e0c4cc',
  VIEWER_THINKING_TEXT: '#b71c1c', // Dark red for thinking role badge

  VIEWER_RESPONSE: '#4A627A', // Darker Blue-gray
  
  TOOL: '#78909c',          // Gray
  TOOL_LINE: '#c4c9d0',     // Light gray for lines/borders

  // Tool cards in message lists
  TOOL_CALL_BG: '#fffbeb',
  TOOL_CALL_BORDER: '#d97706',
  TOOL_DATA_BG: '#e3f2fd',
  TOOL_DATA_BORDER: '#90caf9',
  TOOL_DATA_TEXT: '#1565c0',

  SYSTEM_BG: '#f3f4f6',
  SYSTEM_BORDER: '#e5e7eb',
  SYSTEM_TEXT: '#6b7280',

  ERROR: '#ef4444',         // Red
  ERROR_LIGHT: '#e57373',   // Light Red for node / legend
  ERROR_BG_LIGHT: '#fef2f2', // Light Red background
  ERROR_BORDER_LIGHT: '#fca5a5' // Light Red border
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

export const LINE_COLOR = COLORS.TOOL_LINE;

// Standard Agent Palette: Map known agent names to distinct theme colors
const AGENT_COLORS: Record<string, string> = {
  'jetski': '#d97706',          // Warm Orange
  'swe-agent': '#10b981',       // Emerald Green
  'developer agent': '#6366f1', // Indigo
  'agent': '#d97706',           // Default Agent color
};

// Maximally-distinct curated categorical palette
const DISTINCT_PALETTE = [
  '#0284c7', // Ocean Blue
  '#059669', // Emerald Green
  '#d97706', // Warm Amber / Orange
  '#4f46e5', // Indigo
  '#e11d48', // Crimson Rose
  '#7c3aed', // Violet / Purple
  '#0891b2', // Cyan
  '#ea580c', // Bright Orange
  '#16a34a', // Leaf Green
  '#db2777', // Pink
  '#ca8a04', // Gold
  '#475569', // Slate
];

export function getAgentColor(agentName?: string | null, model?: string | null): string {
  const cleanAgent = (agentName || 'Agent').trim();
  const cleanModel = (model || '').trim();

  // If a model is provided, check for known model brands for distinctive palette colors
  if (cleanModel) {
    const lowerModel = cleanModel.toLowerCase();
    if (lowerModel.includes('gemini') || lowerModel.includes('google')) {
      return '#4f46e5'; // Indigo
    }
    if (lowerModel.includes('claude') || lowerModel.includes('anthropic') || lowerModel.includes('sonnet') || lowerModel.includes('opus') || lowerModel.includes('haiku')) {
      return '#0284c7'; // Ocean Blue
    }
    if (lowerModel.includes('gpt') || lowerModel.includes('openai') || lowerModel.includes('cerebras')) {
      return '#059669'; // Emerald Green
    }
    if (lowerModel.includes('llama') || lowerModel.includes('meta')) {
      return '#2563eb'; // Royal Blue
    }
    if (lowerModel.includes('mistral')) {
      return '#0d9488'; // Teal
    }
    if (lowerModel.includes('qwen')) {
      return '#06b6d4'; // Cyan
    }
  }

  // Check known exact agent names if no distinct model
  if (!cleanModel || cleanModel.toLowerCase() === cleanAgent.toLowerCase()) {
    const lowerAgent = cleanAgent.toLowerCase();
    if (AGENT_COLORS[lowerAgent]) {
      return AGENT_COLORS[lowerAgent];
    }
  }

  let key = cleanAgent;
  if (cleanModel && cleanModel.toLowerCase() !== cleanAgent.toLowerCase()) {
    key = `${cleanAgent} (${cleanModel})`;
  }

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

export function getDarkerAgentColor(agentName?: string | null, model?: string | null): string {
  return darkenColor(getAgentColor(agentName, model));
}

// Backward-compatibility aliases
export const getModelColor = getAgentColor;
export const getDarkerModelColor = getDarkerAgentColor;

