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
 * @fileoverview Marks: the one visual element drawn for each trace node.
 *
 * Every trace node becomes exactly one `Mark`, and the mark's geometry is what
 * gets drawn. `MARK_SPECS` declares, per node type, which channel the mark sits
 * in, how it hangs off that channel's center line, and how big it is.
 * `buildMarks` walks one trace and places every mark in a single pass.
 */

import { getAgentColor } from './colors';
import { ChannelId, channelCenter } from './channels';
import { SLOT_EDIT_HEIGHT, linesToBarHeight } from './file-lane';
import { AxisMode, BASE_OFFSET, NodeMessages, ReasoningStepType, ReasoningTraceNode, ReasoningTraceStep, TraceNodeType } from './layout-types';
import { getStepTokens, stepAxisLength, stepTokenSegments, truncate, wordCount } from './layout-utils';
import { fileAccess, isMessageTool, toolIcon } from './tools';
import { XAxis } from './x-scale';

/** Styling hints for a mark; shape and base colors come from CSS keyed on `type`. */
export interface MarkLook {
  /**
   * Glyph drawn inside the mark (replaces the type's shape). `artifact`: a
   * write to one of the agent's own plan / scratch files, drawn on the tools
   * line as a plain box. `message-send` / `message-receive`: a message to
   * other agents sent, or read / waited for, in the messages lane.
   */
  icon?: 'command' | 'search' | 'artifact' | 'message-send' | 'message-receive';
  /** Only set where the border follows the step's agent color (system marks). */
  borderColor?: string;
  /** A tool call whose observation reported an error. */
  failed?: boolean;
}

/** One drawn element, plus the trace data that the side panel and search need. */
export interface Mark {
  id: string;
  traceId: string;
  type: TraceNodeType;
  channel: ChannelId;
  /** Geometry in px, relative to the trace track. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Fill color (the step's agent color), or null to use the type's CSS color. */
  color: string | null;
  look: MarkLook;
  /** Not drawn in the main track (file events live in the files lane). */
  hidden?: boolean;
  /**
   * How far a tool call extends along the axis, in px from the icon's left
   * edge: until it returned in time mode (when its duration is known), the
   * tokens it consumed in tokens mode. Drawn as a thin bar behind the icon.
   */
  span?: number;
  // Trace data, passed through for the conversation panel, search and files lane.
  label: string;
  text: string;
  data: any;
  stepRef: ReasoningTraceStep;
  timestamp?: string;
  stepType?: ReasoningStepType;
  /** Messages to or from other agents sent or received here; lines join them across rows (links.ts). */
  messages?: NodeMessages;
}

/** Vertical placement relative to the channel's center line. */
type Anchor =
  | 'above'   // sits just above the line
  | 'below'   // sits just below the line
  | 'center'  // centered on the line
  | 'hang';   // top edge on the line, grows downward

interface MarkSpec {
  channel: ChannelId;
  anchor: Anchor;
  /**
   * px for icons (fixed size; a thin `span` bar shows any extent beyond it).
   * 'extent' = a rectangle as long as the node itself on the axis: its time
   * range, its share of the step's tokens, or its slot (see `extentRange`).
   */
  width: number | 'extent';
  /**
   * px; 'speech' = scaled by step tokens; 'effort' = scaled by thinking tokens;
   * 'lines' = scaled by lines written, like a file edit bar.
   */
  height: number | 'speech' | 'effort' | 'lines';
  /** Filled with the step's agent color. */
  agentFill?: boolean;
}

const ICON = 12;
/** Narrowest a rectangle gets, so a short node is still visible. */
const MIN_SPAN = 4;
/** Sequence mode: space left between a bar and the next slot. */
const SLOT_GUTTER = 2;

/** Placement rules for each node type. */
const MARK_SPECS: Record<string, MarkSpec> = {
  // The conversation (user and agent) sits above the line; thinking hangs below it.
  // Rectangles: as long as the node itself on the axis.
  [TraceNodeType.USER_INPUT]: { channel: 'user',  anchor: 'above',  width: 'extent', height: 'speech' },
  [TraceNodeType.RESPONSE]:   { channel: 'user',  anchor: 'above',  width: 'extent', height: 'speech', agentFill: true },
  [TraceNodeType.THINKING]:   { channel: 'agent', anchor: 'hang',   width: 'extent', height: 'effort', agentFill: true },
  // Icons. A tool call with no logged result is still a tool call: same lane as one with a result.
  [TraceNodeType.TOOL_CALL]:  { channel: 'tools', anchor: 'center', width: ICON,     height: ICON },
  [TraceNodeType.SYSTEM]:     { channel: 'agent', anchor: 'center', width: ICON,     height: ICON },
  [TraceNodeType.ERROR]:      { channel: 'agent', anchor: 'center', width: ICON,     height: ICON },
  [TraceNodeType.TOOL_DATA]:  { channel: 'tools', anchor: 'center', width: ICON,     height: ICON },
};

/** Directory listings sit below the tools line, clear of other tool results. */
const LIST_DIR_SPEC: MarkSpec = { ...MARK_SPECS[TraceNodeType.TOOL_DATA], anchor: 'below' };

/**
 * A file edit: a rectangle hanging down, sized by lines written. Hidden in the
 * main track; the files lane draws it with this mark's x and width.
 */
const EDIT_SPEC: MarkSpec = { channel: 'tools', anchor: 'hang', width: 'extent', height: 'lines' };

/**
 * A write to one of the agent's own plan / scratch files: a file edit drawn in
 * its own channel instead of the files lane.
 */
const ARTIFACT_SPEC: MarkSpec = { ...EDIT_SPEC, channel: 'artifacts' };

/**
 * A message sent to or read from other agents: an icon in the agent's color,
 * in the artifacts channel, which the row then labels as its messages lane.
 * Lines between rows join these marks (see links.ts).
 */
const MESSAGE_SPEC: MarkSpec = { channel: 'artifacts', anchor: 'center', width: ICON, height: ICON, agentFill: true };

function anchorY(anchor: Anchor, center: number, height: number): number {
  switch (anchor) {
    case 'above': return center - height - 1;
    case 'below': return center + 1;
    case 'center': return center - height / 2;
    case 'hang': return center;
  }
}

/** Speech (user/response) height: 10–22px by step tokens; constant off the time axis. */
const SPEECH_FIXED_HEIGHT = 18;
function speechHeight(tokens: number, maxTokens: number, mode: AxisMode): number {
  if (mode !== 'time') return SPEECH_FIXED_HEIGHT;
  return Math.round(Math.min(22, 10 + 12 * tokens / maxTokens));
}

/**
 * Thinking-block depth: 8–40px by thinking tokens. Constant off the time axis:
 * 30px in tokens mode (the block still spans its step), speech-bar height in
 * sequence mode (it is one slot, the mirror of the response bar above the line).
 */
function effortHeight(tokens: number, maxTokens: number, mode: AxisMode): number {
  if (mode === 'sequence') return SPEECH_FIXED_HEIGHT;
  if (mode === 'tokens') return 30;
  return 8 + 32 * tokens / maxTokens;
}

// ---------------------------------------------------------------------------
// Node classification
// ---------------------------------------------------------------------------

/** Rate-limit retries are kept in the conversation but not drawn. */
function isRateLimitNode(node: ReasoningTraceNode): boolean {
  return !!node.text?.includes('servers are experiencing high traffic') ||
         !!node.text?.includes('retryable error from model provider');
}

function markLook(node: ReasoningTraceNode, stepColor: string): MarkLook {
  switch (node.type) {
    case TraceNodeType.USER_INPUT:
    case TraceNodeType.RESPONSE:
    case TraceNodeType.THINKING:
      return {};
    case TraceNodeType.SYSTEM:
      return { borderColor: stepColor };
  }
  return {
    icon: node.stepType === ReasoningStepType.SEND_MESSAGE ? 'message-send'
      : node.stepType === ReasoningStepType.RECEIVE_MESSAGE ? 'message-receive'
      : toolIcon(node.stepType),
    failed: (node.type === TraceNodeType.TOOL_DATA && !!node.data?.observation?.error) || undefined,
  };
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** What `buildMarks` needs to know about a trace. */
export interface MarkTraceInput {
  id: string;
  steps: ReasoningTraceStep[];
  /** Fallback agent identity (for colors) when a step doesn't name its own. */
  agentName: string;
  model?: string;
  /** Largest step token count; speech marks are scaled against it. */
  maxStepTokens: number;
  /**
   * File-tool nodes that only touched the agent's own artifacts, with the lines
   * they wrote (see `artifactNodes` in file-events.ts). Drawn on the tools line
   * as edit bars rather than hidden in favor of the files lane.
   */
  artifactNodes?: Map<string, number>;
}

/** Epoch ms of an ISO timestamp; NaN if missing. */
const ms = (ts?: string) => ts ? new Date(ts).getTime() : NaN;

/**
 * Tokens used to size a node's mark. A thinking block is sized by what the
 * model produced (reasoning tokens, else output tokens, else its word count),
 * never by prompt size: input tokens grow with context every step and would
 * make depth track history length rather than effort. Other marks use the
 * step's selected token usage, else their word count.
 */
function sizeTokens(step: ReasoningTraceStep, node: ReasoningTraceNode, tokenTypes?: Set<string>): number {
  if (node.type === TraceNodeType.THINKING) {
    return step.reasoningTokens || step.token_usage?.output_tokens || wordCount(node.text);
  }
  return step.token_usage ? getStepTokens(step.token_usage, tokenTypes) : wordCount(node.text);
}

/** Axis position (ms, tokens or nodes) where a step starts and ends; NaN if unknown. */
function stepRange(steps: ReasoningTraceStep[], i: number, mode: AxisMode,
                   before: number, tokenTypes?: Set<string>): [number, number] {
  const step = steps[i];
  if (mode !== 'time') return [before, before + stepAxisLength(step, mode, tokenTypes)];

  let end = ms(step.completedAt);
  // No completion time: an agent step lasts until the next agent step starts.
  // User and system messages end the span: they're outside events the agent
  // was waiting on (a system notification can arrive days later), not work.
  const next = steps[i + 1];
  const isExternal = (s: ReasoningTraceStep) =>
    s.stepType === ReasoningStepType.USER_INPUT || s.stepType === ReasoningStepType.SYSTEM_MESSAGE;
  if (isNaN(end) && next && !isExternal(next) && !isExternal(step)) {
    end = ms(next.timestamp);
  }
  return [ms(step.timestamp), end];
}

/**
 * Places a mark for every node in the trace on the given axis.
 * Returns the marks and the right edge of the drawn content.
 */
export function buildMarks(trace: MarkTraceInput, axis: XAxis, mode: AxisMode,
                           tokenTypes?: Set<string>): { marks: Mark[]; maxX: number } {
  const marks: Mark[] = [];
  let maxEffortTokens = 1;
  for (const step of trace.steps) {
    for (const node of step.nodes) {
      if (node.type === TraceNodeType.THINKING && !isRateLimitNode(node)) {
        maxEffortTokens = Math.max(maxEffortTokens, sizeTokens(step, node, tokenTypes));
      }
    }
  }

  let maxX = 20;
  // Cumulative axis position (tokens or nodes) of the steps so far; unused in time mode.
  let before = 0;
  // Fallback x for nodes without a usable timestamp: march along after the previous mark.
  let cursorX = BASE_OFFSET;

  trace.steps.forEach((step, i) => {
    const [start, end] = stepRange(trace.steps, i, mode, before, tokenTypes);
    before = mode !== 'time' ? end : 0;
    const stepColor = step.color || getAgentColor(step.agentName || trace.agentName, step.model || trace.model);
    const stepX0 = axis.toX(start);
    const stepX1 = axis.toX(end);

    // Within a step we know the order of events, not their times. Reasoning
    // spans the step; the actions (tool calls, response) follow in order, one
    // icon apart, ending at the step's right edge: thought, then acted. With
    // no reasoning, they start at the step's start.
    const drawn = step.nodes.filter(n => !isRateLimitNode(n));
    const actions = drawn.filter(n => n.type !== TraceNodeType.THINKING);
    const actionsX0 = actions.length === drawn.length ? stepX0
      : isNaN(stepX1) ? stepX0 + ICON
      : Math.max(stepX0, stepX1 - actions.length * ICON);
    // Never run past the next step's start: when zoomed out, squeeze the
    // actions together (they overlap) so marks stay in time order.
    const next = trace.steps[i + 1];
    const limitX = mode === 'time' && next?.timestamp ? axis.toX(new Date(next.timestamp).getTime()) : stepX1;
    const actionGap = actions.length > 1 && !isNaN(limitX)
      ? Math.max(0, Math.min(ICON, (limitX - actionsX0 - ICON) / (actions.length - 1)))
      : ICON;
    // Tokens mode: the step's length is shared out among its nodes by the
    // tokens each consumed, so reasoning and tool calls each get their own span.
    const segments = mode === 'tokens' ? stepTokenSegments(step, end - start) : null;

    step.nodes.forEach((node, k) => {
      const base = {
        id: node.id, traceId: trace.id, label: truncate(node.text || '', 80), text: node.text,
        data: node.data, stepRef: step, timestamp: node.timestamp, stepType: node.stepType, messages: node.messages,
      };
      if (isRateLimitNode(node)) {
        marks.push({ ...base, type: TraceNodeType.ERROR, channel: 'agent', x: 0, y: 0, width: 0, height: 0,
                     color: null, look: {}, hidden: true });
        return;
      }

      const isTool = node.type === TraceNodeType.TOOL_DATA || node.type === TraceNodeType.TOOL_CALL;
      // A file tool that only wrote the agent's own artifacts has nothing for
      // the files lane: it's drawn in the artifacts channel instead.
      const artifactLines = trace.artifactNodes?.get(node.id);
      const isArtifact = artifactLines !== undefined;
      const spec = isArtifact ? ARTIFACT_SPEC
        : isTool && isMessageTool(node.stepType) ? MESSAGE_SPEC
        : fileAccess(node.stepType) === 'edit' ? EDIT_SPEC
        : isTool && node.stepType === ReasoningStepType.LIST_DIRECTORY ? LIST_DIR_SPEC
        : MARK_SPECS[node.type] ?? MARK_SPECS[TraceNodeType.TOOL_DATA];

      // The node's extent on the axis, in px. `measured` = it reflects the
      // node's own time / tokens, not just the step-order heuristic.
      let x0: number, x1: number, measured = false;
      if (mode === 'sequence') {
        // One slot per node, less a gutter.
        const slot = drawn.indexOf(node);
        x0 = axis.toX(start + slot);
        x1 = axis.toX(start + slot + 1) - SLOT_GUTTER;
      } else if (segments?.has(node.id)) {
        // Tokens: the node's share of the step's tokens.
        const [s0, s1] = segments.get(node.id)!;
        x0 = axis.toX(start + s0);
        x1 = axis.toX(start + s1);
        measured = true;
      } else {
        // Time: reasoning spans the step; actions follow in order (see above),
        // each lasting until the next one, the last until the step's end.
        const a = actions.indexOf(node);
        x0 = a < 0 ? stepX0 : actionsX0 + a * actionGap;
        x1 = a < 0 || a === actions.length - 1 ? stepX1 : actionsX0 + (a + 1) * actionGap;
        if (isNaN(x0)) x0 = cursorX;
        if (isNaN(x1)) x1 = x0 + ICON;
        // Per-node timing (tool start / duration, when the model finished
        // generating) overrides the heuristic.
        if (mode === 'time') {
          const ownStart = node.timestamp !== step.timestamp ? axis.toX(ms(node.timestamp)) : NaN;
          const ownEnd = axis.toX(ms(node.completedAt));
          if (!isNaN(ownStart)) x0 = ownStart;
          if (!isNaN(ownEnd)) { x1 = ownEnd; measured = true; }
        }
      }

      // Rectangles fill their extent. Icons keep their size (centered in a
      // sequence slot) and show a measured extent as a thin `span` bar.
      let x: number, width: number, span: number | undefined;
      if (spec.width === 'extent') {
        x = x0;
        width = Math.max(mode === 'sequence' ? 1 : MIN_SPAN, x1 - x0);
      } else {
        width = spec.width;
        x = mode === 'sequence' ? x0 + (x1 - x0 - width) / 2 : x0;
        if (measured && x1 - x0 > width) span = x1 - x0;
      }

      const tokens = sizeTokens(step, node, tokenTypes);
      const height = spec.height === 'speech' ? speechHeight(tokens, trace.maxStepTokens, mode)
        : spec.height === 'effort' ? effortHeight(tokens, maxEffortTokens, mode)
        : spec.height === 'lines' ? (mode === 'sequence' ? SLOT_EDIT_HEIGHT : linesToBarHeight(artifactLines ?? 0))
        : spec.height;

      const look = markLook(node, stepColor);
      if (isArtifact) look.icon = 'artifact';
      marks.push({
        ...base,
        type: node.type,
        channel: spec.channel,
        x, y: anchorY(spec.anchor, channelCenter(spec.channel), height), width, height,
        color: spec.agentFill ? stepColor : null,
        look,
        hidden: (fileAccess(node.stepType) !== null && !isArtifact) || undefined,
        span,
      });

      cursorX = x + width + (k === 0 ? ICON : 0);
      maxX = Math.max(maxX, x + width);
    });
  });

  return { marks, maxX };
}
