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
 * @fileoverview Transforms column layout into row layout by swapping x↔y axes.
 */

import { VisNode, BackboneLine, ThinkingAreaNode } from './layout-types';
import { TraceNodeType } from './layout-types';
import { swapPathCoords } from './layout-utils';

export function applyRowLayout(params: {
  allNodes: VisNode[];
  backboneLines: BackboneLine[];
  timeTicks: { label: string; y: number; x?: number }[];
  yAxisMode: string;
  traces: any[];
  selectedTraceIds: Set<string>;
  layoutMode: string;
  maxContentHeight: number;
}): {
  contentWidth: number;
  maxContentHeight: number;
} {
  const {
    allNodes,
    backboneLines,
    timeTicks,
    yAxisMode,
    traces,
    selectedTraceIds,
    layoutMode,
  } = params;

  let maxContentHeight = params.maxContentHeight;
  let contentWidth = 500;
  const idsArray = [...selectedTraceIds];

  if (layoutMode === 'row') {
    // Swap node coordinates: x↔y, width↔height
    allNodes.forEach(n => {
      if (n.hidden) return;
      const ox = n.x, oy = n.y, ow = n.width, oh = n.height;
      n.x = oy;
      n.y = ox;
      n.width = oh;
      n.height = ow;

      if (n.type === TraceNodeType.THINKING_AREA) {
        (n as ThinkingAreaNode).path = swapPathCoords((n as ThinkingAreaNode).path);
      } else if (n.type !== TraceNodeType.USER_INPUT && n.type !== TraceNodeType.THINKING && n.connectionLine) {
        n.connectionLine.path = swapPathCoords(n.connectionLine.path);
        if (n.returnConnectionLine) {
          n.returnConnectionLine.path = swapPathCoords(n.returnConnectionLine.path);
        }
      }
    });

    // Swap backbone SVG paths
    backboneLines.forEach(l => {
      l.path = swapPathCoords(l.path);
    });

    // Swap horizontal ticks
    if (yAxisMode === 'time') {
      timeTicks.forEach(tick => {
        tick.x = tick.y;
        tick.y = 0;
      });
    }

    // Update per-trace dimension metadata for row mode
    idsArray.forEach(id => {
      const trace = traces.find(t => t.id === id);
      if (trace) {
        const tn = allNodes.filter(n => n.traceId === id && !n.hidden);
        if (tn.length > 0) {
          trace.maxTraceX = Math.max(...tn.map(n => n.x + n.width)) + 20;
          trace.maxTraceY = Math.max(...tn.map(n => n.y + n.height)) + 20;
        }
      }
    });

    // Recompute dimensions after swap
    const visibleNodes = allNodes.filter(n => !n.hidden);
    if (visibleNodes.length > 0) {
      contentWidth = Math.max(...visibleNodes.map(n => n.x + n.width)) + 100;
      maxContentHeight = Math.max(...visibleNodes.map(n => n.y + n.height));
    }
  } else {
    // Column Mode contentWidth
    const count = selectedTraceIds.size;
    const baseWidth = count * 140 + (count > 1 ? (count - 1) * 20 : 0);
    const axisWidth = yAxisMode === 'time' ? 60 : 0;
    contentWidth = Math.max(130, baseWidth + axisWidth);
  }

  return { contentWidth, maxContentHeight };
}
