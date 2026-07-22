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
 * @fileoverview Drag-and-drop calculation helpers for track reordering.
 */

export function calculateDropIndex(
  event: DragEvent,
  count: number,
  layoutMode: 'column' | 'row',
  yAxisMode: 'default' | 'time' | 'tokens'
): number | null {
  if (count === 0) return null;

  const visContent =
    (event.currentTarget as HTMLElement).closest('.vis-scroll-area')?.querySelector('.vis-content') as HTMLElement ||
    (event.currentTarget as HTMLElement);
  const rect = visContent.getBoundingClientRect();

  if (layoutMode === 'column') {
    const axisOffset = (yAxisMode === 'time' || yAxisMode === 'tokens') ? 60 : 0;
    const mouseX = event.clientX - rect.left;

    let dropIdx = 0;
    if (mouseX <= axisOffset + 70) {
      dropIdx = 0;
    } else if (mouseX >= axisOffset + (count - 1) * 160 + 70) {
      dropIdx = count;
    } else {
      const approxIndex = Math.floor((mouseX - axisOffset) / 160);
      const trackLeft = axisOffset + approxIndex * 160;
      const isAfter = mouseX > trackLeft + 70;
      dropIdx = isAfter ? approxIndex + 1 : approxIndex;
    }

    if (dropIdx < 0) dropIdx = 0;
    if (dropIdx > count) dropIdx = count;
    return dropIdx;
  } else {
    const axisOffset = ((yAxisMode === 'time' || yAxisMode === 'tokens') ? 60 : 0) + 18;
    const mouseY = event.clientY - rect.top;

    let dropIdx = 0;
    if (mouseY <= axisOffset + 70) {
      dropIdx = 0;
    } else if (mouseY >= axisOffset + (count - 1) * 160 + 70) {
      dropIdx = count;
    } else {
      const approxIndex = Math.floor((mouseY - axisOffset) / 160);
      const trackTop = axisOffset + approxIndex * 160;
      const isAfter = mouseY > trackTop + 70;
      dropIdx = isAfter ? approxIndex + 1 : approxIndex;
    }

    if (dropIdx < 0) dropIdx = 0;
    if (dropIdx > count) dropIdx = count;
    return dropIdx;
  }
}

export function getColDropIndicatorLeft(dropIndex: number | null, yAxisMode: string): number {
  if (dropIndex === null) return -9999;
  const axisOffset = (yAxisMode === 'time' || yAxisMode === 'tokens') ? 60 : 0;
  return axisOffset + dropIndex * 160 - 10;
}

export function getRowDropIndicatorTop(dropIndex: number | null, yAxisMode: string): number {
  if (dropIndex === null) return -9999;
  const axisOffset = ((yAxisMode === 'time' || yAxisMode === 'tokens') ? 60 : 0) + 18;
  return axisOffset + dropIndex * 160 - 10;
}
