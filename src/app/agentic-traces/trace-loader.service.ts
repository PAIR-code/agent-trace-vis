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
 * @fileoverview Parses OpenTraces JSON into internal trace structures.
 */

import { Injectable } from '@angular/core';
import { ReasoningTrace, ReasoningTraceStep, ReasoningTraceNode, TraceNodeType, ReasoningStepType } from './layout';
import { TraceRecord, Step, Agent } from './trace';
import { traceExtensions } from './trace-extensions';
import { classifyTool, inferToolKind } from './tools';
import { getAgentColor } from './colors';
import { hashString } from './layout-utils';

/**
 * Some harnesses prefix every tool result with
 * `Created At: <iso>\nCompleted At: <iso>\n`. Those lines are noise in the
 * sidebar preview (the raw observation still has them), so drop them.
 */
function stripTimestampHeader(content: string): string {
  return content.replace(/^(?:(?:Created|Completed) At:[^\n]*\n?){1,2}/, '').trim();
}

/**
 * Parses OpenTraces records into `ReasoningTrace`s. All sources share this
 * path; tool kinds come from metadata first, then best-effort name inference.
 */
@Injectable({
  providedIn: 'root'
})
export class TraceLoaderService {
  parseStep(step: Step, traceId: string, stepIndex: number, defaultAgent?: Agent, inheritedModel?: string,
            ext: ReturnType<typeof traceExtensions> = traceExtensions({})): ReasoningTraceStep {
    const stepId = `${traceId}_step_${stepIndex}`;
    const nodes: ReasoningTraceNode[] = [];
    // Beyond-schema data for this step, from the record's metadata (see trace-extensions.ts).
    const timing = ext.stepTiming(step.step_index ?? stepIndex);
    const reasoningTokens = ext.reasoningTokens(step.step_index ?? stepIndex);

    const model = step.model || inheritedModel || defaultAgent?.model || undefined;
    const agentName = step.agent_role || defaultAgent?.name || 'Agent';

    const color = getAgentColor(agentName, model);

    const addMs = (ts: string | undefined, ms: number | undefined) =>
      ts && ms !== undefined ? new Date(new Date(ts).getTime() + ms).toISOString() : undefined;
    const createNode = (
      nid: string,
      type: TraceNodeType,
      text: string,
      stepType: ReasoningStepType,
      nodeData: any,
      timing?: { timestamp?: string; completedAt?: string }
    ): ReasoningTraceNode => ({
      id: nid,
      type,
      text,
      stepType,
      data: nodeData,
      // A node's own timing when the trace has it; else it inherits the step's.
      timestamp: timing?.timestamp ?? step.timestamp,
      completedAt: timing?.completedAt,
    });

    if (step.role === 'user') {
      nodes.push(createNode(stepId, TraceNodeType.USER_INPUT, step.content || 'User Input', ReasoningStepType.USER_INPUT, step));
    } else if (step.role === 'system') {
      nodes.push(createNode(stepId, TraceNodeType.SYSTEM, step.content || 'System Message', ReasoningStepType.SYSTEM_MESSAGE, step));
    } else if (step.role === 'agent') {
      // 1. Thinking Content
      // Thinking lasts from the step's start until the model finished generating.
      const thinkingTiming = { timestamp: step.timestamp, completedAt: timing.generated_at };
      if (step.reasoning_content) {
        nodes.push(createNode(`${stepId}_thinking`, TraceNodeType.THINKING, step.reasoning_content, ReasoningStepType.PLANNER_RESPONSE, { reasoning_content: step.reasoning_content, timestamp: step.timestamp, model }, thinkingTiming));
      } else if (reasoningTokens) {
        // The provider withheld the reasoning text but reported its size;
        // still draw the thinking mark so the effort is visible.
        const text = `(reasoning not shared by provider: ${reasoningTokens.toLocaleString()} tokens)`;
        nodes.push(createNode(`${stepId}_thinking`, TraceNodeType.THINKING, text, ReasoningStepType.PLANNER_RESPONSE, { reasoning_content: text, timestamp: step.timestamp, model }, thinkingTiming));
      }

      // 2. Tool Calls & Observations
      if (step.tool_calls && step.tool_calls.length > 0) {
        step.tool_calls.forEach((tc, tcIdx) => {
          const tcId = `${stepId}_tc_${tcIdx}`;

          const kind = ext.toolKind(tc.tool_name) ?? inferToolKind(tc.tool_name);
          const { stepType, label: toolLabel } = classifyTool(tc, kind);

          // Find observation corresponding to this tool call
          const obs = step.observations?.find(o => o.source_call_id === tc.tool_call_id);
          const subagentRefs = ext.subagentRefs(tc.tool_call_id);
          const combinedData = { toolCall: tc, observation: obs || null, subagentRefs: subagentRefs.length ? subagentRefs : undefined };
          const startedAt = ext.toolTiming(tc.tool_call_id).started_at;
          const toolTiming = { timestamp: startedAt, completedAt: addMs(startedAt, tc.duration_ms) };

          let toolText = toolLabel;
          if (obs) {
            if (obs.error) {
              toolText += `\n\n❌ Error: ${obs.error}`;
            } else if (obs.output_summary) {
              toolText += `\n\n${obs.output_summary}`;
            } else if (obs.content) {
              const content = stripTimestampHeader(obs.content);
              const preview = content.length > 300 ? content.slice(0, 300) + '...' : content;
              if (preview) toolText += `\n\n${preview}`;
            }
            const obsId = `${stepId}_obs_${tcIdx}`;
            nodes.push(createNode(obsId, TraceNodeType.TOOL_DATA, toolText, stepType, combinedData, toolTiming));
          } else {
            // Tool call with no observation yet
            nodes.push(createNode(tcId, TraceNodeType.TOOL_CALL, toolLabel, stepType, combinedData, toolTiming));
          }
        });
      }

      // 3. Response Content
      if (step.content) {
        nodes.push(createNode(`${stepId}_response`, TraceNodeType.RESPONSE, step.content, ReasoningStepType.PLANNER_RESPONSE, { content: step.content, timestamp: step.timestamp, model }, { timestamp: timing.generated_at }));
      }
    }

    return {
      id: stepId,
      timestamp: step.timestamp,
      completedAt: timing.completed_at,
      model,
      reasoningTokens,
      turnTokenUsage: step.role === 'user' ? ext.turnTokenUsage(step.step_index ?? stepIndex) : undefined,
      agentName,
      stepType: step.role === 'user' ? ReasoningStepType.USER_INPUT : (step.role === 'system' ? ReasoningStepType.SYSTEM_MESSAGE : ReasoningStepType.PLANNER_RESPONSE),
      nodes: nodes,
      token_usage: step.token_usage,
      color
    };
  }

  parseTrace(traceData: TraceRecord, fallbackTraceId?: string): ReasoningTrace {
    let traceId = fallbackTraceId || traceData.trace_id || traceData.session_id || 'default';
    // Hash long trace IDs (or those with spaces) to keep prompt turn keys short and clean
    if (traceId.length > 30 || traceId.includes(' ') || traceId.includes('/') || traceId.includes('\\')) {
      traceId = hashString(traceId);
    }
    const title = traceData.task?.description || traceId;
    const steps = traceData.steps || [];
    let lastSeenModel: string | undefined = traceData.agent?.model || undefined;
    if (!lastSeenModel) {
      for (const s of steps) {
        if (s.model) {
          lastSeenModel = s.model;
          break;
        }
      }
    }

    const ext = traceExtensions(traceData);
    const parsedSteps = steps.map((step: Step, index: number) => {
      const parsed = this.parseStep(step, traceId, index, traceData.agent, lastSeenModel, ext);
      if (step.model) {
        lastSeenModel = step.model;
      }
      return parsed;
    });

    const agentMap = new Map<string, { name: string; model?: string; color: string }>();
    const defaultAgentName = traceData.agent?.name || 'Agent';
    const defaultAgentModel = traceData.agent?.model || lastSeenModel;
    const defaultKey = defaultAgentModel ? `${defaultAgentName} (${defaultAgentModel})` : defaultAgentName;
    agentMap.set(defaultKey, {
      name: defaultAgentName,
      model: defaultAgentModel,
      color: getAgentColor(defaultAgentName, defaultAgentModel)
    });

    parsedSteps.forEach((step) => {
      if (step.stepType === ReasoningStepType.PLANNER_RESPONSE && step.agentName) {
        const stepKey = step.model ? `${step.agentName} (${step.model})` : step.agentName;
        if (!agentMap.has(stepKey)) {
          agentMap.set(stepKey, {
            name: step.agentName,
            model: step.model,
            color: step.color || getAgentColor(step.agentName, step.model)
          });
        }
      }
    });

    const agentList = Array.from(agentMap.values());

    /** `file://` URIs (or local paths) from metadata, as local paths; undefined if none. */
    const localPaths = (v: string[] | undefined): string[] | undefined => {
      const paths = (v ?? []).filter(s => s.length > 0)
        .map(uri => decodeURIComponent(uri.replace(/^file:\/\//, '')).replace(/\/+$/, ''));
      return paths.length ? paths : undefined;
    };
    return {
      id: traceId,
      title: title,
      steps: parsedSteps,
      metadata: traceData.metadata,
      agents: agentList,
      sourceId: traceData.trace_id || traceData.session_id || undefined,
      parentSourceId: ext.parentTraceId,
      parentToolCallId: ext.parentToolCallId,
      artifactDirs: localPaths(ext.artifactDirs),
    };
  }
}
