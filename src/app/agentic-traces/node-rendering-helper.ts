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
 * @fileoverview Maps trace nodes to visual shapes and icon types for rendering.
 */

import { TraceNodeType, ReasoningStepType } from './layout-types';

export interface NodeVisualConfig {
  shape?: 'circle' | 'rect' | '';
  type: 'diff' | 'view' | 'search' | 'command' | 'external-search' | 'default';
  content?: string;
  shouldShift?: boolean;
}

export function getNodeVisualConfig(node: any): NodeVisualConfig {
  const text = node.text || '';
  const textLower = text.toLowerCase();
  const stepType = node.stepType || '';

  // Core conversation nodes keep their default shapes
  if (node.type === TraceNodeType.USER_INPUT || 
      node.type === TraceNodeType.RESPONSE || 
      node.type === TraceNodeType.THINKING ||
      node.type === TraceNodeType.SYSTEM) {
    return { shape: '', type: 'default' };
  }

  // Group 1: File Edits
  const isFileEdit = stepType === ReasoningStepType.REPLACE_FILE_CONTENT ||
                     stepType === ReasoningStepType.WRITE_TO_FILE ||
                     stepType === ReasoningStepType.MULTI_REPLACE_FILE_CONTENT ||
                     stepType === ReasoningStepType.NOTEBOOK_EDIT ||
                     stepType === ReasoningStepType.CODE_ACTION ||
                     textLower.includes('replace file content') ||
                     textLower.includes('write to file') ||
                     textLower.includes('multi replace file content') ||
                     textLower.includes('notebook edit');

  if (isFileEdit) {
    return { shape: 'rect', type: 'diff', shouldShift: true };
  }

  // Group 2: View Local Files
  const isView = stepType === ReasoningStepType.VIEW_FILE ||
                 stepType === ReasoningStepType.VIEW_CONTENT_CHUNK ||
                 stepType === ReasoningStepType.VIEW_FILE_OUTLINE ||
                 textLower.startsWith('view:');

  if (isView) {
    return { shape: 'rect', type: 'view', shouldShift: true };
  }

  // Group 3: Local Search
  const isLocalSearch = stepType === ReasoningStepType.GREP_SEARCH ||
                        stepType === ReasoningStepType.FIND_BY_NAME ||
                        textLower.startsWith('grep:');

  if (isLocalSearch) {
    return { shape: 'rect', type: 'search', shouldShift: true };
  }

  // Group 4: Commands
  const isCommand = stepType === ReasoningStepType.RUN_COMMAND ||
                    stepType === ReasoningStepType.LIST_DIRECTORY ||
                    stepType === ReasoningStepType.COMMAND_STATUS ||
                    stepType === ReasoningStepType.SEND_COMMAND_INPUT ||
                    textLower.startsWith('run:') ||
                    textLower.startsWith('list:');

  const isListDir = stepType === ReasoningStepType.LIST_DIRECTORY || textLower.startsWith('list:');

  if (isCommand) {
    return { 
      shape: 'rect', 
      type: 'command', 
      content: '>_', 
      shouldShift: isListDir // Keep shifting for list_dir as in original request
    };
  }

  // Group 5: External Search & Content
  const isExternalSearch = stepType === ReasoningStepType.SEARCH_WEB ||
                           stepType === ReasoningStepType.CODE_SEARCH ||
                           stepType === ReasoningStepType.READ_URL_CONTENT ||
                           textLower.startsWith('web:') ||
                           textLower.startsWith('search:') ||
                           textLower.startsWith('code search:');

  if (isExternalSearch) {
    return { shape: 'circle', type: 'external-search', content: '🔍' };
  }

  // Default: circles for everything else (Group 6 and others)
  return { shape: 'circle', type: 'default' };
}
