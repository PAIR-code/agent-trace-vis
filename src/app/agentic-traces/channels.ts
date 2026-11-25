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
 * @fileoverview The horizontal lanes ("channels") that make up one trace track.
 *
 * This registry is the single source of truth for channel order, labels,
 * heights, and background colors. Layout (node y positions), lane backgrounds,
 * and lane labels are all derived from it — to add a channel, add an entry here.
 */

/** Channel ids. Which channel a mark sits in is decided by MARK_SPECS in marks.ts. */
export type ChannelId = 'user' | 'agent' | 'tools' | 'artifacts';

export interface Channel {
  id: ChannelId;
  label: string;
  height: number;
  background: string;
}

/**
 * Tallest a mark gets: a thinking block at full effort, or the longest speech
 * bar. Expanded lanes center their marks, so a lane is exactly this tall.
 */
export const MAX_MARK_HEIGHT = 22;

/** Height of one expanded lane. */
export const LANE_HEIGHT = MAX_MARK_HEIGHT;

/** Channels in top-to-bottom order. */
export const CHANNELS: readonly Channel[] = [
  { id: 'user', label: 'user / agent conversation', height: LANE_HEIGHT, background: '#f5f7f9' },
  { id: 'agent', label: 'agent internal processes', height: LANE_HEIGHT, background: '#eff2f5' },
  { id: 'tools', label: 'tools', height: LANE_HEIGHT, background: '#e9edf1' },
  // The agent's own plan / scratch files (see `isArtifact` in file-events.ts).
  { id: 'artifacts', label: 'scratch files', height: LANE_HEIGHT, background: '#e4e9ee' },
];

/**
 * The files lane under the channels. Not a mark channel: it has one row per
 * file and expands to show them all (see file-lane.ts). Collapsed, it is one
 * lane tall.
 */
export const FILES_LANE = { label: 'files', height: LANE_HEIGHT, background: '#dde3e9' };

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

/**
 * The collapsed track: one lane with every channel (and the file markers)
 * stacked on a single center line. Marks keep their size and anchoring; only
 * the line they hang off changes (see `collapsedY`). Marks sit above or hang
 * below that line, so it has room for the tallest mark on each side.
 */
const COLLAPSED_HEIGHT = 2 * (MAX_MARK_HEIGHT + 1);
export const COLLAPSED_TRACK = { height: COLLAPSED_HEIGHT, center: COLLAPSED_HEIGHT / 2, background: '#eff2f5' };

/**
 * A mark's y in the collapsed track. Mark y's are anchored to their channel's
 * center (marks.ts), so `y - channelCenter` is the anchor offset: re-apply it
 * to the shared center line.
 */
export function collapsedY(mark: { y: number; channel: ChannelId }): number {
  return mark.y - channelCenter(mark.channel) + COLLAPSED_TRACK.center;
}

/**
 * A mark's y in an expanded lane centered on `laneCenter`. Each channel has its
 * own lane there, so marks drop their anchoring (above / hang) and sit centered
 * on the lane's line.
 */
export function expandedY(mark: { height: number }, laneCenter: number): number {
  return laneCenter - mark.height / 2;
}

/**
 * Channels a trace actually uses: those with a drawn mark, plus `agent`, where
 * the backbone runs. Unused channels aren't drawn for that trace.
 */
export function usedChannels(marks: ReadonlyArray<{ channel: ChannelId; hidden?: boolean }>): Set<ChannelId> {
  const used = new Set<ChannelId>(['agent']);
  for (const m of marks) if (!m.hidden) used.add(m.channel);
  return used;
}

/** Lane positions when only `shown` channels are drawn, in `CHANNELS` order. */
export interface LaneGeometry {
  /** Track height: the shown channels' heights summed. */
  height: number;
  /** Center y of each shown channel, relative to the track. */
  centers: Map<ChannelId, number>;
}

export function laneGeometry(shown: ReadonlySet<ChannelId>): LaneGeometry {
  const centers = new Map<ChannelId, number>();
  let top = 0;
  for (const c of CHANNELS) {
    if (!shown.has(c.id)) continue;
    centers.set(c.id, top + c.height / 2);
    top += c.height;
  }
  return { height: top, centers };
}
