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
 * @fileoverview Detects and compresses idle gaps in time-axis mode.
 */

import { VisNode } from './layout-types';
import { TraceNodeType } from './layout-types';
import { swapPathCoords } from './layout-utils';

export function compressGaps(params: {
  traceNodes: VisNode[];
  yAxisMode: string;
  scale: number;
  baseScale: number;
  hideGaps: boolean;
  traceMaxY: number;
}): {
  waitingRects: any[];
  gapsToReduce: { originalY: number; originalHeight: number; shift: number }[];
  traceMaxY: number;
} {
  const { traceNodes, yAxisMode, scale, baseScale, hideGaps } = params;
  let traceMaxY = params.traceMaxY;
  const waitingRects: any[] = [];
  const sortedNodes = [...traceNodes].filter(n => !n.hidden).sort((a, b) => a.y - b.y);
  
  let currentMaxY = 5;
  sortedNodes.forEach(n => {
    if (n.y > currentMaxY) {
      const gapY = currentMaxY;
      const gapHeight = n.y - currentMaxY;
      const threshold = Math.max(20, 20 * (scale / baseScale));
      if (yAxisMode === 'time' && gapHeight > threshold) {
        waitingRects.push({ y: gapY, height: gapHeight });
      }
    }
    currentMaxY = Math.max(currentMaxY, n.y + n.height);
  });
  
  const gapsToReduce: { originalY: number, originalHeight: number, shift: number }[] = [];
  if (hideGaps && yAxisMode === 'time') {
    const reducedHeight = 30;
    let currentTotalShift = 0;

    waitingRects.forEach((rect: any) => {
      const originalY = rect.y;
      const originalHeight = rect.height;

      if (originalHeight > reducedHeight) {
        const shift = originalHeight - reducedHeight;
        gapsToReduce.push({ originalY, originalHeight, shift });

        rect.y -= currentTotalShift;
        rect.height = reducedHeight;
        rect.isSquiggle = true;

        currentTotalShift += shift;
      } else {
        rect.y -= currentTotalShift;
      }
    });

    // Now apply shifts to nodes
    traceNodes.forEach(n => {
      let nodeShift = 0;
      gapsToReduce.forEach(g => {
        if (n.y >= g.originalY + g.originalHeight) {
          nodeShift += g.shift;
        }
      });
      n.y -= nodeShift;
      // Shift internal connection lines
      if (n.type !== TraceNodeType.USER_INPUT && n.type !== TraceNodeType.THINKING && n.connectionLine) {
        n.connectionLine.path = swapPathCoords(n.connectionLine.path); // temporarily swap back and recalculate later
      }
    });

    traceMaxY -= currentTotalShift;
  }

  return { waitingRects, gapsToReduce, traceMaxY };
}
