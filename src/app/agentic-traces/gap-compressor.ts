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
 * @fileoverview Detects and compresses idle gaps in time-axis mode along the horizontal timeline.
 */

import { VisNode } from './layout-types';
import { TraceNodeType } from './layout-types';

export function compressGaps(params: {
  traceNodes: VisNode[];
  yAxisMode: string;
  scale: number;
  baseScale: number;
  hideGaps: boolean;
  traceMaxX?: number;
  traceMaxY?: number;
}): {
  waitingRects: any[];
  gapsToReduce: { originalX: number; originalWidth: number; shift: number; originalY?: number; originalHeight?: number }[];
  traceMaxX: number;
  traceMaxY?: number;
} {
  const { traceNodes, yAxisMode, scale, baseScale, hideGaps } = params;
  let traceMaxX = params.traceMaxX ?? params.traceMaxY ?? 20;
  const waitingRects: any[] = [];
  const sortedNodes = [...traceNodes].filter(n => !n.hidden).sort((a, b) => a.x - b.x);
  
  let currentMaxX = 5;
  sortedNodes.forEach(n => {
    // Thinking nodes provide step-level bounds to avoid false gaps.
    const nodeLeft = (n as any).timeBasedX ?? n.x;
    const nodeRight = (n as any).timeBasedEndX ?? n.x + n.width;

    if (nodeLeft > currentMaxX) {
      const gapWidth = nodeLeft - currentMaxX;
      const threshold = Math.max(20, 20 * (scale / baseScale));
      if (yAxisMode === 'time' && gapWidth > threshold) {
        waitingRects.push({ x: currentMaxX, width: gapWidth, y: currentMaxX, height: gapWidth });
      }
    }
    currentMaxX = Math.max(currentMaxX, nodeRight);
  });
  
  const gapsToReduce: { originalX: number; originalWidth: number; shift: number; originalY?: number; originalHeight?: number }[] = [];
  if (hideGaps && yAxisMode === 'time') {
    const reducedWidth = 30;
    let currentTotalShift = 0;

    waitingRects.forEach((rect: any) => {
      const originalX = rect.x;
      const originalWidth = rect.width;

      if (originalWidth > reducedWidth) {
        const shift = originalWidth - reducedWidth;
        gapsToReduce.push({ originalX, originalWidth, shift, originalY: originalX, originalHeight: originalWidth });

        rect.x -= currentTotalShift;
        rect.width = reducedWidth;
        rect.y = rect.x;
        rect.height = rect.width;
        rect.isSquiggle = true;

        currentTotalShift += shift;
      } else {
        rect.x -= currentTotalShift;
        rect.y = rect.x;
      }
    });

    // Now apply shifts to nodes
    traceNodes.forEach(n => {
      let nodeShift = 0;
      gapsToReduce.forEach(g => {
        if (n.x >= g.originalX + g.originalWidth) {
          nodeShift += g.shift;
        }
      });
      n.x -= nodeShift;
    });

    traceMaxX -= currentTotalShift;
  }

  return { waitingRects, gapsToReduce, traceMaxX, traceMaxY: traceMaxX };
}
