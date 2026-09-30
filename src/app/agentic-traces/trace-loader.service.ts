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
 * @fileoverview Parses OpenTraces JSON into internal trace structures.
 */

import { Injectable } from '@angular/core';
import { ReasoningTrace, ReasoningTraceStep, ReasoningTraceNode, TraceNodeType, ReasoningStepType } from './layout';
import { TraceRecord, Step, Agent } from './trace';
import { classifyTool } from './tools';
import { getAgentColor } from './colors';
import { hashString } from './layout-utils';

/** Parses OpenTraces records into `ReasoningTrace`s. Fetching is `DatasetService`'s job. */
@Injectable({
  providedIn: 'root'
})
export class TraceLoaderService {
  parseStep(step: Step, traceId: string, stepIndex: number, defaultAgent?: Agent, inheritedModel?: string): ReasoningTraceStep {
    const stepId = `${traceId}_step_${stepIndex}`;
    const nodes: ReasoningTraceNode[] = [];

    const model = step.model || inheritedModel || defaultAgent?.model || undefined;
    const agentName = step.agent_role || defaultAgent?.name || 'Agent';

    const color = getAgentColor(agentName, model);

    const createNode = (
      nid: string,
      type: TraceNodeType,
      text: string,
      stepType: ReasoningStepType,
      nodeData: any
    ): ReasoningTraceNode => ({
      id: nid,
      type,
      text,
      stepType,
      data: nodeData,
      timestamp: step.timestamp,
    });

    if (step.role === 'user') {
      nodes.push(createNode(stepId, TraceNodeType.USER_INPUT, step.content || 'User Input', ReasoningStepType.USER_INPUT, step));
    } else if (step.role === 'system') {
      nodes.push(createNode(stepId, TraceNodeType.SYSTEM, step.content || 'System Message', ReasoningStepType.SYSTEM_MESSAGE, step));
    } else if (step.role === 'agent') {
      // 1. Thinking Content
      if (step.reasoning_content) {
        nodes.push(createNode(`${stepId}_thinking`, TraceNodeType.THINKING, step.reasoning_content, ReasoningStepType.PLANNER_RESPONSE, { reasoning_content: step.reasoning_content, timestamp: step.timestamp, model }));
      }

      // 2. Tool Calls & Observations
      if (step.tool_calls && step.tool_calls.length > 0) {
        step.tool_calls.forEach((tc, tcIdx) => {
          const tcId = `${stepId}_tc_${tcIdx}`;

          const { stepType, label: toolLabel } = classifyTool(tc);

          // Find observation corresponding to this tool call
          const obs = step.observations?.find(o => o.source_call_id === tc.tool_call_id);
          const combinedData = { toolCall: tc, observation: obs || null };
          
          let toolText = toolLabel;
          if (obs) {
            if (obs.error) {
              toolText += `\n\n❌ Error: ${obs.error}`;
            } else if (obs.output_summary) {
              toolText += `\n\n${obs.output_summary}`;
            } else if (obs.content) {
              const preview = obs.content.length > 300 ? obs.content.slice(0, 300) + '...' : obs.content;
              toolText += `\n\n${preview}`;
            }
            const obsId = `${stepId}_obs_${tcIdx}`;
            nodes.push(createNode(obsId, TraceNodeType.TOOL_DATA, toolText, stepType, combinedData));
          } else {
            // Tool call with no observation yet
            nodes.push(createNode(tcId, TraceNodeType.TOOL_CALL, toolLabel, stepType, combinedData));
          }
        });
      }

      // 3. Response Content
      if (step.content) {
        nodes.push(createNode(`${stepId}_response`, TraceNodeType.RESPONSE, step.content, ReasoningStepType.PLANNER_RESPONSE, { content: step.content, timestamp: step.timestamp, model }));
      }
    }

    return {
      id: stepId,
      timestamp: step.timestamp,
      model,
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

    const parsedSteps = steps.map((step: Step, index: number) => {
      const parsed = this.parseStep(step, traceId, index, traceData.agent, lastSeenModel);
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

    return {
      id: traceId,
      title: title,
      steps: parsedSteps,
      metadata: traceData.metadata,
      agents: agentList,
    };
  }
}
