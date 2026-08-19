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
import { getAgentColor, getDarkerAgentColor, darkenColor } from './colors';
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

  parseStep(step: Step, traceId: string, stepIndex: number, defaultAgent?: Agent, inheritedModel?: string): ReasoningTraceStep {
    const stepId = `${traceId}_step_${stepIndex}`;
    const nodes: ReasoningTraceNode[] = [];

    const model = step.model || inheritedModel || defaultAgent?.model || undefined;
    const agentName = step.agent_role || defaultAgent?.name || 'Agent';

    const color = getAgentColor(agentName, model);
    const darkerColor = getDarkerAgentColor(agentName, model);

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
        nodes.push(createNode(`${stepId}_thinking`, TraceNodeType.THINKING, TraceNodeColumn.AGENT, step.reasoning_content, ReasoningStepType.PLANNER_RESPONSE, step));
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
      agentName,
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
      models: agentList
    };
  }
}

function extractFilePathFromInput(input: Record<string, any> | string | undefined): string | null {
  if (!input) return null;
  let obj: Record<string, any> = {};
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return null;
    }
  } else if (typeof input === 'object' && input !== null) {
    obj = input;
  } else {
    return null;
  }

  const val =
    obj['TargetFile'] ??
    obj['AbsolutePath'] ??
    obj['NotebookPath'] ??
    obj['file_path'] ??
    obj['filePath'] ??
    obj['filepath'] ??
    obj['path'] ??
    obj['file'] ??
    obj['filename'] ??
    obj['file_name'] ??
    obj['target_file'] ??
    obj['absolute_path'] ??
    obj['notebook_path'] ??
    obj['uri'] ??
    obj['document'] ??
    obj['src'] ??
    obj['dest'] ??
    obj['SearchPath'] ??
    obj['search_path'] ??
    obj['searchPath'] ??
    null;

  if (typeof val !== 'string') return null;
  let clean = val.trim();
  clean = clean.replace(/^['"`\s]+|['"`\s]+$/g, '');
  return clean || null;
}

function mapToolNameToStepType(toolName: string): ReasoningStepType {
  const name = toolName.toLowerCase();

  // View file
  if (
    name.includes('view_file') || name.includes('viewfile') ||
    name.includes('read_file') || name.includes('readfile') ||
    name.includes('fileread') || name.includes('file_read') ||
    name === 'view' || name === 'read' || name === 'cat' || name === 'open' ||
    name.includes('view_content') || name.includes('read_content')
  ) {
    return ReasoningStepType.VIEW_FILE;
  }

  // Multi-replace file content
  if (name.includes('multi_replace') || name.includes('multireplace')) {
    return ReasoningStepType.MULTI_REPLACE_FILE_CONTENT;
  }

  // Edit / Replace file
  if (
    name.includes('replace_file') || name.includes('replacefile') ||
    name.includes('edit_file') || name.includes('editfile') ||
    name.includes('file_edit') || name.includes('fileedit') ||
    name.includes('str_replace') || name === 'edit' || name === 'replace' ||
    name.includes('apply_diff') || name.includes('patch') || name.includes('modify_file')
  ) {
    return ReasoningStepType.REPLACE_FILE_CONTENT;
  }

  // Write file
  if (
    name.includes('write_to_file') || name.includes('writefile') ||
    name.includes('write_file') || name.includes('file_write') ||
    name.includes('filewrite') || name === 'write' || name === 'create_file' ||
    name.includes('save_file')
  ) {
    return ReasoningStepType.WRITE_TO_FILE;
  }

  // Notebook edit
  if (name.includes('notebook_edit') || name.includes('notebook')) {
    return ReasoningStepType.NOTEBOOK_EDIT;
  }

  // Grep / Search
  if (name.includes('grep_search') || name.includes('grep') || name.includes('ripgrep') || name === 'rg') {
    return ReasoningStepType.GREP_SEARCH;
  }

  // Find / Glob / File search
  if (name.includes('find_by_name') || name.includes('find_files') || name.includes('file_search') || name === 'glob' || name.includes('find')) {
    return ReasoningStepType.FIND_BY_NAME;
  }

  // List directory
  if (name.includes('list_directory') || name.includes('listdir') || name.includes('list_dir') || name === 'ls' || name === 'dir') {
    return ReasoningStepType.LIST_DIRECTORY;
  }

  // Run command / Bash
  if (
    name.includes('run_command') || name.includes('runcommand') ||
    name.includes('execute') || name.includes('terminal') ||
    name === 'bash' || name === 'sh' || name === 'cmd' || name === 'run'
  ) {
    return ReasoningStepType.RUN_COMMAND;
  }

  // URL / Web
  if (name.includes('read_url') || name.includes('fetch')) return ReasoningStepType.READ_URL_CONTENT;
  if (name.includes('search_web') || name.includes('websearch') || name.includes('google')) return ReasoningStepType.SEARCH_WEB;
  if (name.includes('code_search')) return ReasoningStepType.CODE_SEARCH;

  // Chart Artifact tools
  if (name.includes('chart')) {
    if (name.startsWith('get_')) {
      return ReasoningStepType.VIEW_FILE;
    }
    return ReasoningStepType.REPLACE_FILE_CONTENT;
  }

  return ReasoningStepType.GENERIC;
}

function getToolLabel(tc: ToolCall): string {
  const input = tc.input || {};
  const name = tc.tool_name.toLowerCase();
  const filePath = extractFilePathFromInput(input);
  const fileName = filePath ? filePath.split('/').pop() : null;

  if (name.includes('view_file') || name.includes('viewfile') || name.includes('read_file') || name === 'view' || name === 'read' || name.includes('fileread')) {
    return `View: ${fileName || 'file'}`;
  }
  if (name.includes('grep_search') || name.includes('grep') || name.includes('ripgrep') || name === 'rg') {
    let q = '';
    if (typeof input === 'object' && input !== null) {
      q = input['Query'] || input['query'] || input['pattern'] || 'search';
    }
    return `Grep: ${q}`;
  }
  if (name.includes('run_command') || name.includes('runcommand') || name === 'bash' || name === 'sh' || name === 'cmd') {
    let cmd = '';
    if (typeof input === 'object' && input !== null) {
      cmd = input['CommandLine'] || input['command'] || input['cmd'] || 'command';
    }
    return `Run: ${cmd}`;
  }
  if (name.includes('list_directory') || name.includes('listdir') || name.includes('list_dir') || name === 'ls' || name === 'dir') {
    let dir = 'dir';
    if (typeof input === 'object' && input !== null) {
      const rawDir = input['DirectoryPath'] || input['directory'] || input['path'] || 'dir';
      dir = rawDir.split('/').pop() || rawDir;
    }
    return `List: ${dir}`;
  }
  if (name.includes('write_to_file') || name.includes('writefile') || name.includes('write_file') || name === 'write' || name.includes('filewrite')) {
    return `Write: ${fileName || 'file'}`;
  }
  if (name.includes('replace_file') || name.includes('replacefile') || name.includes('editfile') || name.includes('edit_file') || name === 'edit' || name.includes('multi_replace') || name.includes('str_replace')) {
    return `Edit: ${fileName || 'file'}`;
  }
  if (name.includes('notebook_edit') || name.includes('notebook')) {
    return `Notebook: ${fileName || 'notebook'}`;
  }
  if (name.includes('read_url') || name.includes('fetch')) {
    let u = 'fetch';
    if (typeof input === 'object' && input !== null) {
      u = input['Url'] || input['url'] || 'fetch';
    }
    return `URL: ${u}`;
  }
  if (name.includes('search_web') || name.includes('websearch') || name.includes('google')) {
    let q = 'web search';
    if (typeof input === 'object' && input !== null) {
      q = input['Query'] || input['query'] || 'web search';
    }
    return `Web: ${q}`;
  }

  // Dashboard tools
  if (name.includes('chart')) {
    let title = '';
    if (typeof input === 'object' && input !== null) {
      const charts = input['charts'];
      if (Array.isArray(charts) && charts.length > 0 && charts[0]?.title) {
        title = charts[0].title;
      }
    }
    return title ? `Chart: ${title}` : `Chart (${tc.tool_name})`;
  }
  if (name.includes('metric')) {
    let title = '';
    if (typeof input === 'object' && input !== null) {
      const metrics = input['metrics'];
      if (Array.isArray(metrics) && metrics.length > 0 && metrics[0]?.title) {
        title = metrics[0].title;
      }
    }
    return title ? `Metric: ${title}` : `Metric (${tc.tool_name})`;
  }
  if (name.includes('filter')) {
    return `Filter (${tc.tool_name})`;
  }
  if (name === 'set_header') {
    let title = '';
    if (typeof input === 'object' && input !== null && input['title']) {
      title = input['title'];
    }
    return title ? `Header: ${title}` : `Header`;
  }
  if (name === 'set_layout') {
    return `Layout`;
  }
  if (name === 'profile_data') {
    return `SQL Profile`;
  }
  if (name === 'ask_user') {
    return `Ask User`;
  }
  if (name === 'upsert_memories') {
    return `Save Memory`;
  }
  if (name === 'transition_phase') {
    return `Phase Transition`;
  }

  return fileName ? `${tc.tool_name}: ${fileName}` : tc.tool_name;
}

function getObservationLabel(tc: ToolCall, obs: Observation): string {
  if (obs.error) return `Error: ${obs.error}`;
  const duration = tc.duration_ms ? ` (${tc.duration_ms}ms)` : '';
  return `Output of ${tc.tool_name}${duration}`;
}



