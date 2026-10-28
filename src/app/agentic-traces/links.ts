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
 * @fileoverview Lines drawn between rows, in one SVG over the row stack:
 *  - launch: a subagent's branch, from a dot on its parent's agent line (at
 *    the launching tool call) down to the subagent's agent line;
 *  - message: from the mark that sent a message to each mark that received
 *    it, in another row (`metadata.agent_messages`; see trace-extensions.ts);
 *  - unread: for a recipient whose row is shown but never received it, a
 *    short dashed stub from the send to that row.
 * Pure: positions come from the laid-out rows and their stacking.
 */

import { channelCenter, ChannelId, collapsedY, COLLAPSED_TRACK, FILES_LANE, laneGeometry, usedChannels } from './channels';
import type { TraceEntry, TraceLayout } from './layout-types';
import type { Mark } from './marks';
import { asObject, stripQuotes } from './tools';

/** Vertical space between rows (`.trace-background-row` margin-bottom in agentic-traces.css). */
const ROW_GAP = 28;

/** Where one row sits in the row stack, and how its lanes are laid out. */
export interface RowGeometry {
  top: number;
  collapsed: boolean;
  /** Center y of each shown channel within the row (expanded rows). */
  centers: Map<ChannelId, number>;
}

export interface Link {
  id: string;
  kind: 'launch' | 'message' | 'unread';
  path: string;
  color: string;
  /** The dot: at the start of a launch, at the end of a message or stub. */
  dot: { x: number; y: number };
  /** A message received left of where it was sent (tokens / steps mode: rows have their own axes). */
  backwards?: boolean;
  /** Marks at either end: hovering or selecting one highlights the line. */
  markIds: string[];
}

type Point = { x: number; y: number };

/**
 * Where each row sits in the row stack. Each row is its track plus its files
 * lane (expanded rows only), with ROW_GAP between.
 */
export function rowGeometry(rows: TraceLayout[], collapsed: Set<string>, filesExpanded: Set<string>): Map<string, RowGeometry> {
  const out = new Map<string, RowGeometry>();
  let y = 0;
  for (const r of rows) {
    if (collapsed.has(r.id)) {
      out.set(r.id, { top: y, collapsed: true, centers: new Map() });
      y += COLLAPSED_TRACK.height + ROW_GAP;
      continue;
    }
    // Same lane geometry the track draws: only the channels this row uses.
    const lanes = laneGeometry(usedChannels(r.marks));
    out.set(r.id, { top: y, collapsed: false, centers: lanes.centers });
    const files = r.files.rows.length === 0 ? 0
      : filesExpanded.has(r.id) ? Math.max(FILES_LANE.height, r.files.totalHeight) : FILES_LANE.height;
    y += lanes.height + files + ROW_GAP;
  }
  return out;
}

/** Every launch, message and unread line between the shown rows. */
export function buildLinks(rows: TraceLayout[], geometry: Map<string, RowGeometry>, entries: Map<string, TraceEntry>): Link[] {
  const laneY = (row: TraceLayout, ...lanes: ChannelId[]) => {
    const g = geometry.get(row.id)!;
    if (g.collapsed) return g.top + COLLAPSED_TRACK.center;
    const lane = lanes.find(l => g.centers.has(l));
    return g.top + (lane ? g.centers.get(lane)! : channelCenter(lanes[lanes.length - 1]));
  };
  const markCenter = (mark: Mark, row: TraceLayout): Point => {
    const g = geometry.get(row.id)!;
    const y = g.collapsed ? collapsedY(mark)
      : mark.y - channelCenter(mark.channel) + (g.centers.get(mark.channel) ?? channelCenter(mark.channel));
    return { x: mark.x + mark.width / 2, y: g.top + y + mark.height / 2 };
  };

  const links: Link[] = [];
  const byId = new Map(rows.map(r => [r.id, r]));

  // Launches.
  for (const r of rows) {
    const parent = r.parent && byId.get(r.parent.id);
    if (!parent) continue;
    const x = r.parent!.x, y1 = laneY(parent, 'agent'), y2 = laneY(r, 'agent');
    links.push({ id: `launch\u0000${r.id}`, kind: 'launch', path: `M ${x} ${y1} V ${y2}`, color: r.agentColor,
                 dot: { x, y: y1 }, markIds: [] });
  }

  // Messages: every place each id was sent and received, across the rows.
  type End = { mark: Mark; row: TraceLayout };
  const sends = new Map<string, End>();
  const receipts = new Map<string, End[]>();
  /**
   * Rows by the names a message can address them by (team agent name, or
   * trace id), within their group: agent names repeat across teams.
   */
  const rowByName = new Map<string, TraceLayout>();
  const nameKey = (groupId: string, name: string) => `${groupId}\u0000${name}`;
  for (const row of rows) {
    const data = entries.get(row.id)?.data;
    if (data?.team) rowByName.set(nameKey(row.groupId, data.team.agent), row);
    if (data?.sourceId) rowByName.set(nameKey(row.groupId, data.sourceId), row);
    for (const mark of row.marks) {
      if (mark.hidden || !mark.messages) continue;
      for (const id of mark.messages.sent) sends.set(id, { mark, row });
      for (const id of mark.messages.received) receipts.set(id, [...(receipts.get(id) ?? []), { mark, row }]);
    }
  }

  for (const [id, send] of sends) {
    const from = markCenter(send.mark, send.row);
    const color = send.row.agentColor;
    const received = (receipts.get(id) ?? []).filter(r => r.row !== send.row);
    received.forEach((r, i) => {
      const to = markCenter(r.mark, r.row);
      links.push({ id: `${id}\u0000${i}`, kind: 'message', path: curve(from, to), color, dot: to,
                   backwards: to.x < from.x - 1, markIds: [send.mark.id, r.mark.id] });
    });
    // Recipients shown that never received it: a dashed stub ending on their
    // row, on its messages lane (else its agent line), just right of the send.
    const team = entries.get(send.row.id)?.data?.team;
    const receivedBy = new Set(received.map(r => r.row));
    for (const name of recipientsOf(send.mark.data?.toolCall?.input, team?.agent, team?.members ?? [])) {
      const target = rowByName.get(nameKey(send.row.groupId, name));
      if (!target || target === send.row || receivedBy.has(target)) continue;
      const tip = { x: from.x + 16, y: laneY(target, 'artifacts', 'agent') };
      links.push({ id: `${id}\u0000unread\u0000${target.id}`, kind: 'unread', path: curve(from, tip), color, dot: tip,
                   markIds: [send.mark.id] });
    }
  }
  return links;
}

/**
 * A curve from `a` to `b`. Forward: leaves and arrives horizontally, so lines
 * read left to right across rows. Backward (b left of a): leaves and arrives
 * vertically instead, so it doesn't loop around.
 */
function curve(a: Point, b: Point): string {
  if (b.x < a.x - 1) {
    const midY = (a.y + b.y) / 2;
    return `M ${a.x} ${a.y} C ${a.x} ${midY}, ${b.x} ${midY}, ${b.x} ${b.y}`;
  }
  const dx = Math.max(12, Math.abs(b.x - a.x) / 2);
  return `M ${a.x} ${a.y} C ${a.x + dx} ${a.y}, ${b.x - dx} ${b.y}, ${b.x} ${b.y}`;
}

/**
 * Who a message tool call was addressed to: its `to` / `Recipient` as a name
 * or list. Missing or "all" means every other team member (none outside a team).
 */
function recipientsOf(input: unknown, sender: string | undefined, members: string[]): string[] {
  const obj = asObject(input);
  const to = obj['to'] ?? obj['Recipient'] ?? obj['recipient'];
  const names = (Array.isArray(to) ? to : [to]).map(v => stripQuotes(String(v ?? '')));
  if (names.length === 1 && ['', 'all', '*'].includes(names[0])) return members.filter(m => m !== sender);
  return names.filter(m => m && m !== sender);
}
