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
 * @fileoverview Computes the main track (the backbone) drawn behind the agent row.
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
  cy: number,
  waitingRects: any[],
  traceMaxX: number
): BackboneLine[] {
  const lines: BackboneLine[] = [];

  // Add agent backbone line segments
  const backboneSegments: any[] = [];
  let lastX = BASE_OFFSET;

  waitingRects.forEach((rect: any) => {
    const rx = rect.x ?? rect.y ?? 0;
    const rw = rect.width ?? rect.height ?? 0;
    if (rx > lastX) {
      backboneSegments.push({ x1: lastX, x2: rx, type: 'solid' });
    }
    backboneSegments.push({ x1: rx, x2: rx + rw, type: rect.isSquiggle ? 'squiggle' : 'dotted' });
    lastX = rx + rw;
  });

  if (lastX < traceMaxX) {
    backboneSegments.push({ x1: lastX, x2: traceMaxX, type: 'solid' });
  }

  backboneSegments.forEach((seg, segIndex) => {
    if (seg.type === 'squiggle') {
      const x1 = seg.x1;
      const x2 = seg.x2;

      lines.push({
        id: `${traceId}_agent_backbone_line_${segIndex}_p1`,
        traceId,
        path: `M ${x1} ${cy} L ${x1 + 10} ${cy}`,
        stroke: `url(#grad-${sanitizeId(traceId)})`,
        strokeWidth: 1.5,
        opacity: 0.7,
        strokeDasharray: '4,6'
      });

      lines.push({
        id: `${traceId}_agent_backbone_line_${segIndex}_p2`,
        traceId,
        path: `M ${x1 + 10} ${cy} q 2.5 -5 5 0 q 2.5 5 5 0`,
        stroke: `url(#grad-${sanitizeId(traceId)})`,
        strokeWidth: 3,
        opacity: 0.7,
      });

      lines.push({
        id: `${traceId}_agent_backbone_line_${segIndex}_p3`,
        traceId,
        path: `M ${x1 + 20} ${cy} L ${x2} ${cy}`,
        stroke: `url(#grad-${sanitizeId(traceId)})`,
        strokeWidth: 1.5,
        opacity: 0.7,
        strokeDasharray: '4,6'
      });
    } else {
      const path = `M ${seg.x1} ${cy} L ${seg.x2} ${cy}`;
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
