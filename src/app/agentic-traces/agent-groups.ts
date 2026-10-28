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
 * @fileoverview Subagent relationships between traces in a dataset.
 *
 * A trace launched by another trace's tool call (an `invoke_subagent`) records
 * its parent's trace id in its metadata. Here those references are resolved to
 * dataset entry ids, and selections are kept in "family order": every trace is
 * followed by its subagents, depth-first, so a parent and its subagents are
 * always adjacent rows.
 */

import { TraceEntry } from './layout-types';

/**
 * Resolves each entry's parent reference to the parent's entry id. Entries
 * whose parent isn't in the dataset (or that would form a cycle) stay roots.
 */
export function linkSubagents(entries: TraceEntry[]): void {
  const bySource = new Map<string, TraceEntry>();
  for (const e of entries) {
    if (e.data?.sourceId) bySource.set(e.data.sourceId, e);
  }
  for (const e of entries) {
    const parent = e.data?.parentSourceId ? bySource.get(e.data.parentSourceId) : undefined;
    e.parentId = parent && parent !== e ? parent.id : undefined;
    e.parentToolCallId = e.data?.parentToolCallId;
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

/** `id` and all its descendants, depth-first. */
export function familyOf(entries: TraceEntry[], id: string): string[] {
  const out: string[] = [id];
  for (const c of childrenOf(entries, id)) out.push(...familyOf(entries, c.id));
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
 * Puts an ordered selection into family order: each selected trace is
 * followed by its selected descendants (depth-first, in dataset order), and a
 * selected subagent whose parent is also selected moves under that parent.
 * The relative order of roots is kept.
 */
export function familyOrder(entries: TraceEntry[], ordered: Iterable<string>): string[] {
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
  // Unselected traces in the middle of a chain are skipped over, not shown.
  const visitChildren = (id: string) => {
    for (const c of childrenOf(entries, id)) {
      if (selected.has(c.id)) visit(c.id);
      else visitChildren(c.id);
    }
  };
  const visit = (id: string) => {
    out.push(id);
    visitChildren(id);
  };
  for (const id of selected) {
    if (byId.has(id) && !hasSelectedAncestor(id)) visit(id);
  }
  // Anything not reached (unknown ids) keeps its place at the end.
  for (const id of selected) if (!out.includes(id)) out.push(id);
  return out;
}
