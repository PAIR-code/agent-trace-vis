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

export function getModelColor(modelStr?: string | null): string {
  if (!modelStr) {
    return COLORS.AGENT;
  }
  const lower = modelStr.toLowerCase();
  
  if (lower.includes('gemini') || lower.includes('google')) {
    return '#6366f1'; // Indigo
  }
  if (lower.includes('claude') || lower.includes('anthropic') || lower.includes('opus') || lower.includes('sonnet') || lower.includes('haiku')) {
    return '#0284c7'; // Ocean Blue
  }
  if (lower.includes('gpt') || lower.includes('openai')) {
    return '#10b981'; // Emerald Green
  }
  if (lower.includes('llama')) {
    return '#2563eb'; // Royal Blue
  }
  if (lower.includes('mistral')) {
    return '#0d9488'; // Teal
  }
  if (lower.includes('qwen')) {
    return '#06b6d4'; // Cyan
  }
  if (lower === 'agent') {
    return '#64748b'; // Slate Gray for generic Agent
  }

  // Fallback: hash the string to generate a dynamic categorical color
  return hashStringToColor(modelStr);
}

export function getDarkerModelColor(modelStr?: string | null): string {
  return darkenColor(getModelColor(modelStr));
}

function hashStringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 65%, 45%)`;
}

