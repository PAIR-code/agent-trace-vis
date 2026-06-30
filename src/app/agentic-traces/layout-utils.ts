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
 * @fileoverview Lower-level helper utilities.
 * 
 * Includes:
 * - Time formatters (turning milliseconds to label like "+1m 20s")
 * - Layout adapters (flipping SVG drawing coordinates when rotating row to column layout)
 * - Text measurement approximations (deciding node heights based on string lengths)
 */

export function sanitizeId(id: string): string {
  return String(id || '').replace(/[^a-zA-Z0-9-]/g, '_');
}

/** Formats elapsed time in milliseconds to a string (+m:ss or +ss). */
export function formatElapsedTime(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    if (remainingSeconds === 0) {
      return `+${minutes}m`;
    }
    return `+${minutes}m ${remainingSeconds}s`;
  }
  return `+${remainingSeconds}s`;
}

/** Swaps x↔y coordinates in an SVG path string. */
export function swapPathCoords(pathStr: string): string {
  const result: string[] = [];
  const re = /([MCLQSTAHVZmclqstahvz])([^MCLQSTAHVZmclqstahvz]*)/g;
  let m;
  while ((m = re.exec(pathStr)) !== null) {
    const cmd = m[1];
    const args = m[2].trim();
    if (cmd === 'Z' || cmd === 'z') { result.push(cmd); continue; }
    if (cmd === 'H' || cmd === 'h') { result.push(cmd === 'H' ? 'V' : 'v'); result.push(args); continue; }
    if (cmd === 'V' || cmd === 'v') { result.push(cmd === 'V' ? 'H' : 'h'); result.push(args); continue; }
    const nums = args.match(/[-+]?[\d]*\.?[\d]+(?:[eE][-+]?\d+)?/g);
    if (!nums || nums.length === 0) { result.push(cmd); continue; }
    const swapped: string[] = [];
    for (let i = 0; i < nums.length - 1; i += 2) {
      swapped.push(nums[i + 1], nums[i]);
    }
    if (nums.length % 2 === 1) swapped.push(nums[nums.length - 1]);
    result.push(cmd + ' ' + swapped.join(' '));
  }
  return result.join(' ');
}

export function calcHeight(text: string): number {
  return Math.max(12, Math.min(80, text.length / 12));
}

export function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + '…' : text;
}
