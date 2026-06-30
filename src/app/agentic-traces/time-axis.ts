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
 * @fileoverview Computes Y-axis scale and tick intervals for the timeline mode.
 * 
 * Shows elapsed time (+5s, +1m, etc.) along the side ruler, aligned with node execution timestamps.
 * - Detects duration extremes (max duration) to scale coordinates.
 * - Calculates "nice" intervals (snapped to seconds/minutes) so ticks are clean.
 */

import { ReasoningTrace, ReasoningTraceStep, BASE_OFFSET } from './layout-types';
import { formatElapsedTime } from './layout-utils';

export interface TimeAxisConfig {
  scale: number;
  baseScale: number;
  maxDuration: number;
  timeTicks: { label: string; y: number; x?: number }[];
  intervalLabel: string;
}

export function computeTimeAxis(
  traces: any[],
  selectedTraceIds: Set<string>,
  yAxisMode: string,
  hideGaps: boolean
): TimeAxisConfig {
  const idsArray = [...selectedTraceIds];

  // Find max duration for time mode
  let maxDuration = 1;
  if (yAxisMode === 'time') {
    idsArray.forEach(id => {
      const trace = traces.find(t => t.id === id);
      if (!trace || !trace.data) return;
      const steps = (trace.data as ReasoningTrace).steps || [];
      const timestamps: number[] = [];
      steps.forEach((s: ReasoningTraceStep) => {
        if (s.timestamp) timestamps.push(new Date(s.timestamp).getTime());
        if (s.completedAt) timestamps.push(new Date(s.completedAt).getTime());
      });
      if (timestamps.length > 1) {
        const duration = Math.max(...timestamps) - Math.min(...timestamps);
        if (duration > maxDuration) maxDuration = duration;
      }
    });
  }

  const baseScale = 800 / maxDuration;
  const scale = baseScale;
  const durationForInterval = maxDuration;

  const timeTicks: { label: string, y: number, x?: number }[] = [];
  let intervalLabel = '';
  if (yAxisMode === 'time') {
    const niceIntervals = [1000, 5000, 10000, 30000, 60000, 120000, 300000, 600000, 1800000, 3600000];
    const roughInterval = durationForInterval / 6;
    let interval = niceIntervals[0];
    for (let i = niceIntervals.length - 1; i >= 0; i--) {
      if (roughInterval >= niceIntervals[i]) {
        interval = niceIntervals[i];
        break;
      }
    }
    
    const seconds = Math.floor(interval / 1000);
    const minutes = Math.floor(seconds / 60);
    intervalLabel = minutes > 0 ? `${minutes}m` : `${seconds}s`;

    for (let duration = 0; duration <= durationForInterval; duration += interval) {
      const y = BASE_OFFSET + duration * scale;
      const label = hideGaps ? '' : formatElapsedTime(duration);
      timeTicks.push({ label, y });
    }
  }

  return { scale, baseScale, maxDuration, timeTicks, intervalLabel };
}
