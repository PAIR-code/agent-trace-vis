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
 * @fileoverview The horizontal lanes ("channels") that make up one trace track.
 *
 * This registry is the single source of truth for channel order, labels,
 * heights, and background colors. Layout (node y positions), lane backgrounds,
 * and lane labels are all derived from it — to add a channel, add an entry here.
 */

/** Channel ids. Which channel a mark sits in is decided by MARK_SPECS in marks.ts. */
export type ChannelId = 'user' | 'agent' | 'tools';

export interface Channel {
  id: ChannelId;
  label: string;
  height: number;
  background: string;
}

/** Default height of one lane. */
export const LANE_HEIGHT = 140 / 3;

/** Channels in top-to-bottom order. */
export const CHANNELS: readonly Channel[] = [
  { id: 'user', label: 'user / agent conversation', height: LANE_HEIGHT, background: '#f4f7f9' },
  { id: 'agent', label: 'agent internal processes', height: LANE_HEIGHT, background: '#ebf0f4' },
  { id: 'tools', label: 'tools', height: LANE_HEIGHT, background: '#dde3ea' },
];

/**
 * The files lane under the channels. Not a mark channel: it has one row per
 * file and expands to show them all (see file-lane.ts). Collapsed, it is one
 * lane tall.
 */
export const FILES_LANE = { label: 'files', height: LANE_HEIGHT, background: '#cfd7e0' };

/** Total height of the channels in one trace track. */
export const TRACK_HEIGHT = CHANNELS.reduce((sum, c) => sum + c.height, 0);

/** Y coordinate of each channel's center line, relative to the track. */
const CHANNEL_CENTERS = new Map<ChannelId, number>();
let top = 0;
for (const c of CHANNELS) {
  CHANNEL_CENTERS.set(c.id, top + c.height / 2);
  top += c.height;
}

export function channelCenter(id: ChannelId): number {
  return CHANNEL_CENTERS.get(id)!;
}
