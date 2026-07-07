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
 * @fileoverview Loads and parses OpenTraces JSON into internal trace structures.
 */

import { Injectable } from '@angular/core';
import { ReasoningTrace, ReasoningTraceStep, ReasoningTraceNode, TraceNodeColumn, TraceNodeType, ReasoningStepType } from './layout-helper';
import { TraceRecord, Step, ToolCall, Observation, Agent } from './trace';
import { getModelColor, getDarkerModelColor, darkenColor } from './colors';
import { hashString } from './layout-utils';


@Injectable({
  providedIn: 'root'
})
export class TraceLoaderService {
  getTraces(files: string[]): { id: string, title: string, data: any, file: string, models: any[], date?: string, timestamp?: number }[] {
    const base = 'assets/data/traces/';
    return files.map(f => {
      const filename = f.replace('.json', '');
      return {
        id: hashString(filename),
        title: filename,
        data: null,
        file: base + f,
        models: [],
      };
    });
  }

  parseStep(step: Step, traceId: string, stepIndex: number, defaultAgent?: Agent): ReasoningTraceStep {
    const stepId = `${traceId}_step_${stepIndex}`;
    const nodes: ReasoningTraceNode[] = [];

    const model = step.model || defaultAgent?.model || undefined;
    const modelFamily = defaultAgent?.name || 'Agent';

    const colorTarget = model || modelFamily;
    const color = getModelColor(colorTarget);
    const darkerColor = getDarkerModelColor(colorTarget);

    const createNode = (
      nid: string,
      type: TraceNodeType,
      column: TraceNodeColumn,
      text: string,
      stepType: ReasoningStepType,
      nodeData: any
    ): ReasoningTraceNode => ({
      id: nid,
      type,
      column,
      text,
      stepType,
      data: nodeData,
      timestamp: step.timestamp,
    });

    if (step.role === 'user') {
      nodes.push(createNode(stepId, TraceNodeType.USER_INPUT, TraceNodeColumn.USER, step.content || 'User Input', ReasoningStepType.USER_INPUT, step));
    } else if (step.role === 'system') {
      nodes.push(createNode(stepId, TraceNodeType.SYSTEM, TraceNodeColumn.AGENT, step.content || 'System Message', ReasoningStepType.SYSTEM_MESSAGE, step));
    } else if (step.role === 'agent') {
      // 1. Thinking Content
      if (step.reasoning_content) {
        const paragraphs = step.reasoning_content.split('\n').map(p => p.trim()).filter(p => p.length > 0);
        paragraphs.forEach((para, idx) => {
          nodes.push(createNode(`${stepId}_thinking_${idx}`, TraceNodeType.THINKING, TraceNodeColumn.AGENT, para, ReasoningStepType.PLANNER_RESPONSE, step));
        });
      }

      // 2. Tool Calls & Observations
      if (step.tool_calls && step.tool_calls.length > 0) {
        step.tool_calls.forEach((tc, tcIdx) => {
          const tcId = `${stepId}_tc_${tcIdx}`;
          
          const stepType = mapToolNameToStepType(tc.tool_name);
          const toolLabel = getToolLabel(tc);

          // Find observation corresponding to this tool call
          const obs = step.observations?.find(o => o.source_call_id === tc.tool_call_id);
          if (obs) {
            const obsId = `${stepId}_obs_${tcIdx}`;
            const combinedData = { toolCall: tc, observation: obs };
            nodes.push(createNode(obsId, TraceNodeType.TOOL_DATA, TraceNodeColumn.TOOLS, obs.output_summary || getObservationLabel(tc, obs), stepType, combinedData));
          } else {
            // Create Tool Call node in the AGENT column only if there is no observation
            nodes.push(createNode(tcId, TraceNodeType.TOOL_CALL, TraceNodeColumn.AGENT, toolLabel, stepType, tc));
          }
        });
      }

      // 3. Response Content
      if (step.content) {
        nodes.push(createNode(`${stepId}_response`, TraceNodeType.RESPONSE, TraceNodeColumn.USER, step.content, ReasoningStepType.PLANNER_RESPONSE, step));
      }
    }

    return {
      id: stepId,
      timestamp: step.timestamp,
      model,
      modelFamily,
      stepType: step.role === 'user' ? ReasoningStepType.USER_INPUT : (step.role === 'system' ? ReasoningStepType.SYSTEM_MESSAGE : ReasoningStepType.PLANNER_RESPONSE),
      nodes: nodes,
      token_usage: step.token_usage,
      color,
      darkerColor
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
    const parsedSteps = steps.map((step: Step, index: number) => 
      this.parseStep(step, traceId, index, traceData.agent)
    );

    const modelMap = new Map<string, { name: string; color: string }>();
    parsedSteps.forEach((step) => {
      if (step.stepType === ReasoningStepType.PLANNER_RESPONSE && step.color) {
        const familyName = step.modelFamily || 'Agent';
        let displayName = familyName;
        if (step.model && step.model !== familyName) {
          displayName = `${familyName} (${step.model})`;
        }
        if (!modelMap.has(displayName)) {
          modelMap.set(displayName, { name: displayName, color: step.color });
        }
      }
    });

    return {
      id: traceId,
      title: title,
      steps: parsedSteps,
      metadata: traceData.metadata,
      models: Array.from(modelMap.values())
    };
  }
}

function mapToolNameToStepType(toolName: string): ReasoningStepType {
  const name = toolName.toLowerCase();
  if (name.includes('view_file') || name.includes('viewfile')) return ReasoningStepType.VIEW_FILE;
  if (name.includes('grep_search') || name.includes('grep') || name.includes('ripgrep')) return ReasoningStepType.GREP_SEARCH;
  if (name.includes('run_command') || name.includes('runcommand') || name.includes('execute') || name.includes('terminal')) return ReasoningStepType.RUN_COMMAND;
  if (name.includes('list_directory') || name.includes('listdir') || name.includes('ls')) return ReasoningStepType.LIST_DIRECTORY;
  if (name.includes('write_to_file') || name.includes('writefile')) return ReasoningStepType.WRITE_TO_FILE;
  if (name.includes('multi_replace') || name.includes('multireplace')) return ReasoningStepType.MULTI_REPLACE_FILE_CONTENT;
  if (name.includes('replace_file') || name.includes('replacefile') || name.includes('editfile')) return ReasoningStepType.REPLACE_FILE_CONTENT;
  if (name.includes('notebook_edit') || name.includes('notebook')) return ReasoningStepType.NOTEBOOK_EDIT;
  if (name.includes('read_url') || name.includes('fetch')) return ReasoningStepType.READ_URL_CONTENT;
  if (name.includes('search_web') || name.includes('websearch') || name.includes('google')) return ReasoningStepType.SEARCH_WEB;
  if (name.includes('code_search')) return ReasoningStepType.CODE_SEARCH;
  if (name.includes('find')) return ReasoningStepType.FIND;
  return ReasoningStepType.GENERIC;
}

function getToolLabel(tc: ToolCall): string {
  const input = tc.input || {};
  const name = tc.tool_name.toLowerCase();
  
  if (name.includes('view_file') || name.includes('viewfile')) {
    const file = input['AbsolutePath'] || input['TargetFile'] || input['file_path'] || 'file';
    return `View: ${file.split('/').pop()}`;
  }
  if (name.includes('grep_search') || name.includes('grep') || name.includes('ripgrep')) {
    return `Grep: ${input['Query'] || input['query'] || 'search'}`;
  }
  if (name.includes('run_command') || name.includes('runcommand')) {
    return `Run: ${input['CommandLine'] || input['command'] || 'command'}`;
  }
  if (name.includes('list_directory') || name.includes('listdir') || name.includes('ls')) {
    const dir = input['DirectoryPath'] || input['directory'] || 'dir';
    return `List: ${dir.split('/').pop()}`;
  }
  if (name.includes('write_to_file') || name.includes('writefile')) {
    const file = input['TargetFile'] || input['file_path'] || 'file';
    return `Write: ${file.split('/').pop()}`;
  }
  if (name.includes('replace_file') || name.includes('replacefile') || name.includes('editfile') || name.includes('multi_replace')) {
    const file = input['TargetFile'] || input['file_path'] || 'file';
    return `Edit: ${file.split('/').pop()}`;
  }
  if (name.includes('notebook_edit') || name.includes('notebook')) {
    const file = input['NotebookPath'] || input['file_path'] || 'notebook';
    return `Notebook: ${file.split('/').pop()}`;
  }
  if (name.includes('read_url') || name.includes('fetch')) {
    return `URL: ${input['Url'] || input['url'] || 'fetch'}`;
  }
  if (name.includes('search_web') || name.includes('websearch') || name.includes('google')) {
    return `Web: ${input['Query'] || input['query'] || 'web search'}`;
  }
  
  return tc.tool_name;
}

function getObservationLabel(tc: ToolCall, obs: Observation): string {
  if (obs.error) return `Error: ${obs.error}`;
  const duration = tc.duration_ms ? ` (${tc.duration_ms}ms)` : '';
  return `Output of ${tc.tool_name}${duration}`;
}



