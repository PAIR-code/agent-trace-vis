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
 * @fileoverview Computes the main track (the backbone) drawn behind the agent row.
 * 
 * Shows the progress of execution over time:
 * - Solid lines: active execution, thinking, and tool use.
 * - Dotted lines: idle waiting periods (waiting for user input when "show user wait" is on).
 */

import { BackboneLine, BASE_OFFSET } from './layout-types';
import { Mark } from './marks';
import { GapRect } from './x-scale';

/** Color of the step whose latest drawn mark starts at or before x. */
function getSegmentColor(x: number, marks: Mark[], defaultColor: string): string {
  let activeColor = defaultColor;
  let maxNodeX = -1;
  for (const n of marks) {
    if (n.hidden) continue;
    const stepColor = n.stepRef.color;
    if (stepColor && n.x <= x && n.x >= maxNodeX) {
      maxNodeX = n.x;
      activeColor = stepColor;
    }
  }
  return activeColor;
}

export function buildBackboneLines(
  traceId: string,
  cy: number,
  gaps: GapRect[],
  traceMaxX: number,
  lineColor: string,
  marks: Mark[],
  /** Where the line begins: the axis origin, or for a subagent where it was launched. */
  startX: number = BASE_OFFSET,
): BackboneLine[] {
  const lines: BackboneLine[] = [];

  // Add agent backbone line segments
  const backboneSegments: any[] = [];
  let lastX = startX;

  gaps.forEach(gap => {
    // Hidden gaps have width 0 and are omitted completely.
    if (gap.compressed || gap.width <= 0) return;
    const gapEnd = gap.x + gap.width;
    if (gapEnd <= startX) return;
    const gapX = Math.max(gap.x, startX);
    if (gapX >= traceMaxX) return;
    if (gapX > lastX) {
      backboneSegments.push({ x1: lastX, x2: gapX, type: 'solid' });
    }
    const segEnd = Math.min(gapEnd, traceMaxX);
    backboneSegments.push({ x1: gapX, x2: segEnd, type: 'dotted' });
    lastX = segEnd;
  });

  if (lastX < traceMaxX) {
    backboneSegments.push({ x1: lastX, x2: traceMaxX, type: 'solid' });
  }

  backboneSegments.forEach((seg, segIndex) => {
    const segColor = getSegmentColor(seg.x1, marks, lineColor);
    const path = `M ${seg.x1} ${cy} L ${seg.x2} ${cy}`;
    const strokeDasharray = seg.type === 'dotted' ? '4,6' : undefined;

    lines.push({
      id: `${traceId}_agent_backbone_line_${segIndex}`,
      traceId,
      path,
      stroke: segColor,
      strokeWidth: seg.type === 'dotted' ? 1.5 : 3,
      opacity: seg.type === 'dotted' ? 0.7 : 1,
      strokeDasharray
    });
  });

  return lines;
}
