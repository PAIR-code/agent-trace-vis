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
 * @fileoverview Computes the main track (the backbone) drawn behind the agent column.
 * 
 * Shows the progress of execution over time:
 * - Solid lines: active execution or thinking.
 * - Dotted lines: idle waiting periods (waiting for API responses or delay).
 * - Squiggle segments: rate limit retry loops.
 */

import { BackboneLine, BASE_OFFSET } from './layout-types';
import { sanitizeId } from './layout-utils';

export function buildBackboneLines(
  traceId: string,
  cx: number,
  waitingRects: any[],
  traceMaxY: number
): BackboneLine[] {
  const lines: BackboneLine[] = [];

  // Add agent backbone line segments
  const backboneSegments: any[] = [];
  let lastY = BASE_OFFSET;

  waitingRects.forEach((rect: any) => {
    if (rect.y > lastY) {
      backboneSegments.push({ y1: lastY, y2: rect.y, type: 'solid' });
    }
    backboneSegments.push({ y1: rect.y, y2: rect.y + rect.height, type: rect.isSquiggle ? 'squiggle' : 'dotted' });
    lastY = rect.y + rect.height;
  });

  if (lastY < traceMaxY) {
    backboneSegments.push({ y1: lastY, y2: traceMaxY, type: 'solid' });
  }

  backboneSegments.forEach((seg, segIndex) => {
    if (seg.type === 'squiggle') {
      const y1 = seg.y1;
      const y2 = seg.y2;

      lines.push({
        id: `${traceId}_agent_backbone_line_${segIndex}_p1`,
        traceId,
        path: `M ${cx} ${y1} L ${cx} ${y1 + 10}`,
        stroke: `url(#grad-${sanitizeId(traceId)})`,
        strokeWidth: 1.5,
        opacity: 0.7,
        strokeDasharray: '4,6'
      });

      lines.push({
        id: `${traceId}_agent_backbone_line_${segIndex}_p2`,
        traceId,
        path: `M ${cx} ${y1 + 10} q -5 2.5 0 5 q 5 2.5 0 5`,
        stroke: `url(#grad-${sanitizeId(traceId)})`,
        strokeWidth: 3,
        opacity: 0.7,
      });

      lines.push({
        id: `${traceId}_agent_backbone_line_${segIndex}_p3`,
        traceId,
        path: `M ${cx} ${y1 + 20} L ${cx} ${y2}`,
        stroke: `url(#grad-${sanitizeId(traceId)})`,
        strokeWidth: 1.5,
        opacity: 0.7,
        strokeDasharray: '4,6'
      });
    } else {
      const path = `M ${cx} ${seg.y1} L ${cx} ${seg.y2}`;
      const strokeDasharray = seg.type === 'dotted' ? '4,6' : undefined;

      lines.push({
        id: `${traceId}_agent_backbone_line_${segIndex}`,
        traceId,
        path,
        stroke: `url(#grad-${sanitizeId(traceId)})`,
        strokeWidth: seg.type === 'dotted' ? 1.5 : 3,
        opacity: 0.7,
        strokeDasharray
      });
    }
  });

  return lines;
}
