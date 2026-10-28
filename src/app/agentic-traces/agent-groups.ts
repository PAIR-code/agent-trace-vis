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
 * @fileoverview Groups of traces that belong together: a trace and the
 * subagents it launched, or a team of peer agents.
 *
 * A group shares one axis and moves as one when rows are reordered. It comes
 * in two shapes:
 *  - a tree: a subagent's trace records its parent's trace id (and the tool
 *    call that launched it) in its metadata; and
 *  - flat: every member of a team (`metadata.team`) is a root, in the team's
 *    member order.
 * Messages between members (`metadata.agent_messages`) are drawn the same way
 * for both (see links.ts).
 *
 * Selections are kept in "group order": each trace is followed by its
 * subagents, depth-first, and a team's members stay together, so a group's
 * rows are always adjacent.
 */

import { TraceEntry } from './layout-types';

/**
 * Resolves each entry's parent reference to the parent's entry id, and records
 * each team member's team id. Entries whose parent isn't in the dataset (or
 * that would form a cycle) stay roots.
 */
export function linkGroups(entries: TraceEntry[]): void {
  const bySource = new Map<string, TraceEntry>();
  for (const e of entries) {
    if (e.data?.sourceId) bySource.set(e.data.sourceId, e);
  }
  for (const e of entries) {
    const parent = e.data?.parentSourceId ? bySource.get(e.data.parentSourceId) : undefined;
    e.parentId = parent && parent !== e ? parent.id : undefined;
    e.parentToolCallId = e.data?.parentToolCallId;
    // A team member is a peer, never a subagent.
    e.teamId = e.data?.team?.id;
    if (e.teamId) e.parentId = undefined;
  }
  // Break cycles (bad data): an ancestor chain that returns to itself is cut.
  const byId = new Map(entries.map(e => [e.id, e]));
  for (const e of entries) {
    const seen = new Set<string>([e.id]);
    let cur = e;
    while (cur.parentId) {
      if (seen.has(cur.parentId)) { cur.parentId = undefined; break; }
      seen.add(cur.parentId);
      const next = byId.get(cur.parentId);
      if (!next) { cur.parentId = undefined; break; }
      cur = next;
    }
  }
}

/** Direct subagents of `id`, in dataset order. */
export function childrenOf(entries: TraceEntry[], id: string): TraceEntry[] {
  return entries.filter(e => e.parentId === id);
}

/** Every member of `id`'s team (itself included) in member order, or just `id` if it isn't in a team. */
export function teamOf(entries: TraceEntry[], id: string): string[] {
  const teamId = entries.find(e => e.id === id)?.teamId;
  if (!teamId) return [id];
  const members = entries.filter(e => e.teamId === teamId);
  const order = (e: TraceEntry) => {
    const team = e.data?.team;
    const i = team ? team.members.indexOf(team.agent) : -1;
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  // Stable: members not in the member list keep dataset order, at the end.
  return members.map((e, i) => ({ e, i }))
    .sort((a, b) => order(a.e) - order(b.e) || a.i - b.i)
    .map(({ e }) => e.id);
}

/** `id` and all its descendants, depth-first; for a team member, the whole team. */
export function groupOf(entries: TraceEntry[], id: string): string[] {
  const out: string[] = [];
  for (const member of teamOf(entries, id)) {
    out.push(member);
    for (const c of childrenOf(entries, member)) out.push(...groupOf(entries, c.id));
  }
  return out;
}

/** Nesting depth of an entry: 0 for a root, 1 for its subagents, and so on. */
export function depthOf(entries: TraceEntry[], id: string): number {
  const byId = new Map(entries.map(e => [e.id, e]));
  let depth = 0;
  for (let cur = byId.get(id); cur?.parentId; cur = byId.get(cur.parentId)) depth++;
  return depth;
}

/**
 * Puts an ordered selection into group order: each selected trace is
 * followed by its selected descendants (depth-first, in dataset order), and a
 * selected subagent whose parent is also selected moves under that parent.
 * Selected team members are kept together, in member order, where the first
 * of them was. The relative order of roots is kept.
 */
export function groupOrder(entries: TraceEntry[], ordered: Iterable<string>): string[] {
  const selected = new Set(ordered);
  const byId = new Map(entries.map(e => [e.id, e]));
  // A selected trace is a root of the selection if no selected ancestor exists.
  const hasSelectedAncestor = (id: string): boolean => {
    for (let cur = byId.get(id)?.parentId; cur; cur = byId.get(cur)?.parentId) {
      if (selected.has(cur)) return true;
    }
    return false;
  };
  const out: string[] = [];
  const placed = new Set<string>();
  // Unselected traces in the middle of a chain are skipped over, not shown.
  const visitChildren = (id: string) => {
    for (const c of childrenOf(entries, id)) {
      if (selected.has(c.id)) visit(c.id);
      else visitChildren(c.id);
    }
  };
  const visit = (id: string) => {
    if (placed.has(id)) return;
    placed.add(id);
    out.push(id);
    visitChildren(id);
  };
  for (const id of selected) {
    if (!byId.has(id) || hasSelectedAncestor(id) || placed.has(id)) continue;
    // A team member brings its selected teammates along.
    for (const member of teamOf(entries, id)) {
      if (selected.has(member) && !hasSelectedAncestor(member)) visit(member);
    }
  }
  // Anything not reached (unknown ids) keeps its place at the end.
  for (const id of selected) if (!placed.has(id)) out.push(id);
  return out;
}
