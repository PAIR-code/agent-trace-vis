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
import { HttpClient, HttpHeaders } from '@angular/common/http';
import { ReasoningTrace, ReasoningTraceStep, ReasoningTraceNode, TraceNodeColumn, TraceNodeType, ReasoningStepType } from './layout-helper';
import { TraceRecord, Step, ToolCall, Observation, Agent } from './trace';
import { getModelColor, getDarkerModelColor, darkenColor } from './colors';
import { hashString } from './layout-utils';

export interface DatasetItem {
  name: string;
  file: string; // Unique identifier or folder name
  isRemote?: boolean;
  isImported?: boolean;
  repoId?: string;
  urls?: string[];
  maxTraces?: number;
}

export const HF_PRESETS: DatasetItem[] = [
  {
    name: 'OpenTraces/opentraces-runtime 🤗',
    file: 'opentraces-runtime-hf',
    isRemote: true,
    repoId: 'OpenTraces/opentraces-runtime',
    maxTraces: 10
  },
  {
    name: 'OpenTraces/opentraces-devtime 🤗',
    file: 'opentraces-devtime-hf',
    isRemote: true,
    repoId: 'OpenTraces/opentraces-devtime',
    maxTraces: 10
  },
  {
    name: 'OpenTraces/lambda-hermes-agent-reasoning-opentraces 🤗',
    file: 'opentraces-lambda-hermes-hf',
    isRemote: true,
    repoId: 'OpenTraces/lambda-hermes-agent-reasoning-opentraces',
    maxTraces: 10
  }
];


@Injectable({
  providedIn: 'root'
})
export class TraceLoaderService {
  constructor(private http: HttpClient) { }

  async loadRemoteDataset(urls: string[], maxTraces: number): Promise<TraceRecord[]> {
    // Try Hugging Face Dataset Viewer API first
    if (urls.length > 0) {
      const firstUrl = urls[0];
      const match = firstUrl.match(/datasets\/([^\/]+\/[^\/]+)\/resolve\//);
      if (match) {
        const repoId = match[1];
        const rowsApiUrl = `https://datasets-server.huggingface.co/rows?dataset=${repoId}&config=default&split=train&offset=0&length=${maxTraces}`;
        try {
          const response = await this.http.get<any>(rowsApiUrl).toPromise();
          if (response && response.rows && Array.isArray(response.rows)) {
            const records = response.rows.map((r: any) => r.row as TraceRecord);
            return records;
          }
        } catch (e) {
          console.warn(`Hugging Face rows API failed for ${repoId}, falling back to streaming file download:`, e);
        }
      }
    }

    // Fallback: Streaming Fetch
    let records: TraceRecord[] = [];
    for (const url of urls) {
      if (records.length >= maxTraces) {
        break;
      }
      try {
        if (url.endsWith('.jsonl')) {
          const response = await fetch(url);
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }
          if (!response.body) {
            throw new Error('Response body is null');
          }
          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) {
                break;
              }
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) continue;
                if (trimmed.includes('[redacted: model produced reasoning but content was withheld by provider]')) {
                  continue;
                }
                try {
                  const record = JSON.parse(trimmed) as TraceRecord;
                  if (record && (record.steps || record.trace_id)) {
                    records.push(record);
                    if (records.length >= maxTraces) {
                      await reader.cancel();
                      break;
                    }
                  }
                } catch (e) {
                  // Ignore partial line parse errors
                }
              }
              if (records.length >= maxTraces) {
                break;
              }
            }
          } finally {
            reader.releaseLock();
          }
        } else {
          const text = await this.http.get(url, { responseType: 'text' }).toPromise();
          if (text) {
            const parsed = this.parseJsonl(text);
            records = records.concat(parsed);
          }
        }
      } catch (e) {
        console.error(`Error loading JSONL from ${url}:`, e);
      }
    }
    return records.slice(0, maxTraces);
  }

  async resolveRepositoryUrls(repoId: string): Promise<string[]> {
    const apiUrl = `https://huggingface.co/api/datasets/${repoId}`;
    const metadata = await this.http.get<any>(apiUrl).toPromise();
    if (!metadata || !metadata.siblings || !Array.isArray(metadata.siblings)) {
      throw new Error("Failed to fetch dataset files list from Hugging Face API.");
    }

    const files = metadata.siblings
      .map((s: any) => s.rfilename)
      .filter((f: string) => f.endsWith('.jsonl') || f.endsWith('.json'))
      .sort((a: string, b: string) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));

    if (files.length === 0) {
      throw new Error("No JSON or JSONL files found in this Hugging Face dataset repository.");
    }

    return files.map((f: string) =>
      `https://huggingface.co/datasets/${repoId}/resolve/main/${f}`
    );
  }

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

  parseJsonl(content: string): TraceRecord[] {
    const lines = content.split('\n');
    const records: TraceRecord[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      if (line.includes('[redacted: model produced reasoning but content was withheld by provider]')) {
        continue;
      }
      try {
        const record = JSON.parse(line) as TraceRecord;
        if (record && (record.steps || record.trace_id)) {
          records.push(record);
        }
      } catch (e) {
        console.error(`Failed to parse JSONL line ${i + 1}:`, e);
      }
    }
    return records;
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



