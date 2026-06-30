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
 * @fileoverview Groups trace nodes into threaded messages for the conversation panel.
 */

import { VisNode } from './layout-helper';
import { TraceNodeType } from './layout-types';

export interface ThreadMessage {
  id: string;
  traceId: string;
  type: string;
  label: string;
  text: string;
  data: any;
  timestamp?: string;
  color?: string | null;
  children: VisNode[];
}

export function groupThreadMessages(activeTraceId: string, nodes: VisNode[]): ThreadMessage[] {
  const filteredNodes = nodes.filter(n => n.traceId === activeTraceId && n.type !== TraceNodeType.THINKING_AREA);
  
  // Sort nodes chronologically
  filteredNodes.sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    if (ta !== tb) return ta - tb;
    return nodes.indexOf(a) - nodes.indexOf(b);
  });

  const groups: ThreadMessage[] = [];
  let currentParent: ThreadMessage | null = null;
  const nestable = new Set<string>([
    TraceNodeType.TOOL_CALL,
    TraceNodeType.TOOL_DATA,
    TraceNodeType.SYSTEM,
    TraceNodeType.ERROR
  ]);

  for (const node of filteredNodes) {
    if (node.type === TraceNodeType.THINKING) {
      const lastGroup = groups[groups.length - 1];
      if (lastGroup && lastGroup.type === TraceNodeType.THINKING && lastGroup.data === node.data) {
        lastGroup.text += '\n\n' + node.text;
        continue;
      }
    }

    if (nestable.has(node.type)) {
      // Nest under the previous agent parent
      if (currentParent) {
        if (!currentParent.children) currentParent.children = [];
        currentParent.children.push(node);
      } else {
        groups.push({
          id: node.id,
          traceId: node.traceId,
          type: node.type,
          label: (node as any).label || '',
          text: (node as any).text || '',
          data: node.data,
          timestamp: node.timestamp,
          color: (node as any).color || null,
          children: []
        });
      }
    } else {
      // user_input, response, thinking — top-level items
      const group: ThreadMessage = {
        id: node.id,
        traceId: node.traceId,
        type: node.type,
        label: (node as any).label || '',
        text: (node as any).text || '',
        data: node.data,
        timestamp: node.timestamp,
        color: (node as any).color || null,
        children: []
      };
      groups.push(group);
      
      // Only agent turns (thinking/response) can be parents for nesting
      if (node.type === TraceNodeType.THINKING || node.type === TraceNodeType.RESPONSE) {
        currentParent = group;
      } else {
        currentParent = null;
      }
    }
  }

  return groups;
}
