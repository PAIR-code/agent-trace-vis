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
 * @fileoverview Drop-target measurement for reordering trace rows.
 *
 * Rows have variable height (the files lane grows with the number of files),
 * so we measure the rendered rows instead of assuming a fixed pitch.
 */

/** Where a dragged row would land, and where to draw the indicator. */
export interface DropTarget {
  /** Insertion index among the rows (0..rowCount). */
  index: number;
  /** Indicator y, relative to the `.row-lanes` container. */
  indicatorTop: number;
}

/** Half the vertical gap between rows (`.trace-background-row` margin-bottom). */
const HALF_ROW_GAP = 14;

/** Measures the drop target for the pointer position of a dragover event. */
export function measureDrop(event: DragEvent): DropTarget | null {
  const lanes = (event.currentTarget as HTMLElement)
    .closest('.vis-scroll-area')?.querySelector('.row-lanes');
  if (!lanes) return null;
  const rows = Array.from(lanes.querySelectorAll(':scope > .trace-background-row'))
    .map(el => el.getBoundingClientRect());
  if (rows.length === 0) return null;

  const origin = lanes.getBoundingClientRect().top;
  const index = rows.filter(r => r.top + r.height / 2 < event.clientY).length;
  const indicatorTop = index < rows.length
    ? rows[index].top - origin - HALF_ROW_GAP
    : rows[rows.length - 1].bottom - origin + HALF_ROW_GAP;
  return { index, indicatorTop };
}
