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
 * @fileoverview "Sort by": orders the selected traces by a metadata field or a
 * per-trace total (time, tokens, turns, user messages). Subagents stay with
 * the trace that launched them, which is what gets compared.
 */

import { getStepTokens } from './layout-utils';
import { ReasoningTraceStep, TraceEntry, TraceNodeType } from './layout-types';
import { MetaValue, compareMetaValues, scalarMetadata } from './metadata-fields';

/** Sort keys computed from the traces themselves (metadata keys are used as is). */
export const TOTAL_SORTS: ReadonlyArray<{ key: string; label: string }> = [
  { key: '__total_time', label: 'Total time' },
  { key: '__total_tokens', label: 'Total tokens' },
  { key: '__total_turns', label: 'Total turns' },
  { key: '__total_user', label: 'Total user interactions' },
];

const ms = (ts?: string) => (ts ? new Date(ts).getTime() : NaN);

function isUserStep(step: ReasoningTraceStep): boolean {
  return step.nodes.some(n => n.type === TraceNodeType.USER_INPUT);
}

/** A trace's value for `key`: a total over it and its subagents (`family`), or its own metadata value. */
function sortValue(root: TraceEntry, family: TraceEntry[], key: string,
                   tokenTypes?: Set<string>): MetaValue | undefined {
  const steps = family.flatMap(t => t.data?.steps ?? []);
  switch (key) {
    case '__total_time': {
      const times = steps.flatMap(s => [ms(s.timestamp), ms(s.completedAt)]).filter(t => !isNaN(t));
      return times.length > 0 ? Math.max(...times) - Math.min(...times) : undefined;
    }
    case '__total_tokens':
      return steps.reduce((sum, s) => sum + getStepTokens(s.token_usage, tokenTypes), 0);
    case '__total_turns':
      return steps.filter(s => !isUserStep(s) && s.nodes.length > 0).length;
    case '__total_user':
      // Only the trace's own user: a subagent's "user" is the agent that launched it.
      return (root.data?.steps ?? []).filter(isUserStep).length;
    default:
      return scalarMetadata(root.data?.metadata)?.[key];
  }
}

/**
 * The selected trace ids, reordered so traces sort by `key` (missing values
 * last) with each trace's subagents right after it, in their original order.
 */
export function sortTraceIds(traces: TraceEntry[], ids: string[], key: string, descending: boolean,
                             tokenTypes?: Set<string>): string[] {
  const byId = new Map(traces.map(t => [t.id, t]));
  const selected = new Set(ids);
  const rootOf = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 20; i++) {
      const parent = byId.get(cur)?.parentId;
      if (!parent || !selected.has(parent)) break;
      cur = parent;
    }
    return cur;
  };
  const families = new Map<string, string[]>();
  for (const id of ids) {
    const root = rootOf(id);
    families.set(root, [...(families.get(root) ?? []), id]);
  }
  const roots = [...families.keys()].map((id, i) => {
    const root = byId.get(id);
    const family = (families.get(id) ?? []).map(f => byId.get(f)).filter((t): t is TraceEntry => !!t);
    return { id, i, value: root ? sortValue(root, family, key, tokenTypes) : undefined };
  });
  roots.sort((a, b) => {
    if (a.value === undefined || b.value === undefined) {
      return a.value === b.value ? a.i - b.i : a.value === undefined ? 1 : -1;
    }
    const c = compareMetaValues(a.value, b.value);
    return (descending ? -c : c) || a.i - b.i;
  });
  // A family's own order puts the root first (it was selected before or with its subagents).
  return roots.flatMap(r => {
    const fam = families.get(r.id) ?? [];
    return [r.id, ...fam.filter(f => f !== r.id)];
  });
}
