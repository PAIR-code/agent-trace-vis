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

export function calculateDropIndex(event: DragEvent, count: number): number | null {
  if (count === 0) return null;

  const visContent =
    (event.currentTarget as HTMLElement).closest('.vis-scroll-area')?.querySelector('.vis-content') as HTMLElement ||
    (event.currentTarget as HTMLElement);
  const rect = visContent.getBoundingClientRect();

  const axisOffset = 60 + 18;
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

  return Math.max(0, Math.min(count, dropIdx));
}

export function getRowDropIndicatorTop(dropIndex: number | null): number {
  if (dropIndex === null) return -9999;
  return 60 + 18 + dropIndex * 160 - 10;
}
