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
 * @fileoverview Main Angular component for the agentic traces visualization.
 */

import {
  Component,
  OnInit,
  signal,
  computed,
  HostListener,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { DomSanitizer } from "@angular/platform-browser";
import { HttpClient } from "@angular/common/http";
import { AgenticTracesSearchService } from "./search.service";
import { TraceLoaderService } from "./trace-loader.service";
import {
  TraceNodeColumn,
  TraceNodeType,
  ReasoningStepType,
  ModelType,
  ModelFamily,
  ReasoningTrace,
} from "./layout-helper";
import {
  SPEAKER_STYLES,
  getModelColor,
  createStyle,
  COLORS,
  lightenColor,
} from "./colors";
import { getNodeVisualConfig } from "./node-rendering-helper";
import { AGENTIC_TRACES_TEMPLATE } from "./template";
import { AGENTIC_TRACES_STYLES } from "./styles";
import { MultiSelectDropdownComponent, DropdownItem } from "../shared/multi-select-dropdown.component";
import { SearchBarComponent } from "../shared/search/search-bar.component";
import { ConversationViewerComponent } from "../shared/conversation-viewer.component";
import {
  calculateTraceLayout,
  VisNode,
  ThinkingAreaNode,
  BackboneLine,
  sanitizeId,
} from "./layout-helper";
import { groupThreadMessages } from "./thread-helper";

@Component({
  selector: "app-agentic-traces",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MultiSelectDropdownComponent,
    SearchBarComponent,
    ConversationViewerComponent,
  ],
  providers: [AgenticTracesSearchService],
  template: AGENTIC_TRACES_TEMPLATE,
  styles: AGENTIC_TRACES_STYLES,
})
export class AgenticTracesComponent implements OnInit {
  datasets = signal<any[]>([]);
  selectedDatasetFile = signal<string>("");
  traces = signal<any[]>([]);
  selectedTraceId = signal<string>("");
  activeTrace = signal<any>(null);
  selectedNode = signal<any>(null);
  hoveredNodeId = signal<string | null>(null);
  highlightedChunkId = signal<string | null>(null);

  selectedTraceIds = signal<Set<string>>(new Set());
  yAxisMode = signal<"default" | "time" | "tokens">("time");
  layoutMode = signal<"column" | "row">("row");
  timeTicks = signal<{ label: string; y: number; x?: number }[]>([]);
  hideGaps = signal<boolean>(false);
  timeUnitLabel = signal<string>("");
  selectedTokenTypes = signal<Set<string>>(new Set(['input_tokens', 'output_tokens', 'cache_read_tokens', 'cache_write_tokens']));
  tokenMetricOptions = signal<Array<{ id: string; label: string }>>([
    { id: 'input_tokens', label: 'Input Tokens' },
    { id: 'output_tokens', label: 'Output Tokens' },
    { id: 'cache_read_tokens', label: 'Cache Read (Hit)' },
    { id: 'cache_write_tokens', label: 'Cache Write (Miss)' }
  ]);
  tokenMetricItems = computed<DropdownItem[]>(() =>
    this.tokenMetricOptions().map(opt => ({
      id: opt.id,
      title: opt.label
    }))
  );

  private speakerColorMap = new Map<string, string>();
  private warmColorIndex = { value: 0 };

  nodes = signal<VisNode[]>([]);
  thinkingAreaNodes = computed(() => this.nodes().filter((n): n is ThinkingAreaNode => n.type === 'thinking_area' as any));
  backboneLines = signal<BackboneLine[]>([]);
  contentHeight = signal<number>(1000);
  contentWidth = signal<number>(500);

  selectedTraces = computed(() => {
    const ids = this.selectedTraceIds();
    return [...ids]
      .map((id) => this.traces().find((t) => t.id === id))
      .filter(Boolean);
  });

  legendEntries = computed(() => {
    const traces = this.selectedTraces();
    // Use the first selected trace's model color as the legend's agent color, or fallback to COLORS.AGENT
    const activeAgentColor =
      traces.length > 0 && (traces[0] as any).agentColor
        ? (traces[0] as any).agentColor
        : COLORS.AGENT;

    // Thinking color: if we have an active trace, use a lighter version of the model color or fallback to COLORS.THINKING
    const activeThinkingColor =
      traces.length > 0 && (traces[0] as any).agentColor
        ? lightenColor((traces[0] as any).agentColor, 0.4)
        : COLORS.THINKING;

    return [
      {
        label: "User",
        color: COLORS.USER_BG,
        isAI: false,
        border: `1px solid ${COLORS.USER_BORDER}`,
      },
      { label: "Agent", color: activeAgentColor, isAI: true },
      { label: "Thinking", color: activeThinkingColor, isAI: true },
      { label: "Harness", color: COLORS.USER_BG, isAI: false, isDiamond: true },
      { label: "Error", color: COLORS.ERROR_LIGHT, isAI: false },
      { label: "Tool", color: COLORS.USER_BG, isAI: false },
    ];
  });

  /** Column-mode width of the vis (trace count dimension). */
  svgWidth = computed(() => {
    const count = this.selectedTraceIds().size;
    const baseWidth = count * 140 + (count > 1 ? (count - 1) * 20 : 0);
    const axisWidth = this.yAxisMode() === "time" || this.yAxisMode() === "tokens" ? 60 : 0;
    return Math.max(130, baseWidth + axisWidth);
  });

  // Group nodes into thread messages: tool/system/error nest under agent turns
  activeTraceId = computed(() => {
    const selectedNode = this.selectedNode();
    if (selectedNode) {
      return selectedNode.traceId;
    }
    const ids = this.selectedTraceIds();
    return ids.values().next().value;
  });

  activeTraceStepsCount = computed(() => {
    const activeId = this.activeTraceId();
    return this.nodes().filter((n) => n.traceId === activeId).length;
  });

  // Group nodes into thread messages: tool/system/error nest under agent turns
  threadMessages = computed(() => {
    const messages = groupThreadMessages(this.activeTraceId(), this.nodes());
    console.log('Thread messages about to render:', messages);
    return messages;
  });

  sanitizeId = sanitizeId;

  constructor(
    private http: HttpClient,
    public searchService: AgenticTracesSearchService,
    private traceLoaderService: TraceLoaderService,
    private sanitizer: DomSanitizer,
  ) { }

  ngOnInit() {
    this.loadDatasets();
  }

  /** Renames a trace by its ID. */
  finishRenameTrace(id: string, newTitle: string) {
    if (newTitle && newTitle.trim()) {
      const trace = this.traces().find((t) => t.id === id);
      if (trace) {
        trace.title = newTitle.trim();
        this.traces.set([...this.traces()]);
      }
    }
  }

  /** Handles changes in the selected traces. */
  onTraceSelectionChange(newSelection: Set<string>) {
    this.selectedTraceIds.set(newSelection);
    this.updateActiveTraces();
  }

  /** Returns the speaker label for the viewer. */
  getSpeakerLabelForViewer = (msg: any) => this.getRoleLabel(msg.type);
  /** Returns the text color for a message type. */
  getSpeakerColorForViewer = (msg: any) => {
    if (msg.type === "response" || msg.type === "thinking") {
      const traceId = msg.traceId || this.activeTraceId();
      const trace = this.traces().find((t) => t.id === traceId);
      const color = (trace as any)?.agentColor;
      if (color) return color;
    }
    return SPEAKER_STYLES[msg.type]?.color || "#000";
  };
  /** Returns the background color for a message type. */
  getSpeakerBgColorForViewer = (msg: any) => {
    if (msg.type === "response" || msg.type === "thinking") {
      const traceId = msg.traceId || this.activeTraceId();
      const trace = this.traces().find((t) => t.id === traceId);
      const color = (trace as any)?.agentColor;
      if (color) {
        return createStyle(color).bg;
      }
    }
    return SPEAKER_STYLES[msg.type]?.bg || "#ffffff";
  };
  /** Returns the border style for a message type. */
  getSpeakerBorderForViewer = (msg: any) => {
    if (msg.type === "tool_call" || msg.type === "tool_data") {
      const borderColor = this.getNodeBorderColor(msg);
      if (borderColor) {
        return `1.5px solid ${borderColor}`;
      }
    }
    if (msg.type === "response" || msg.type === "thinking") {
      const traceId = msg.traceId || this.activeTraceId();
      const trace = this.traces().find((t) => t.id === traceId);
      const color = (trace as any)?.agentColor;
      if (color) {
        return createStyle(color).border;
      }
    }
    return SPEAKER_STYLES[msg.type]?.border || "1px solid #e5e7eb";
  };

  /** Returns the highlighted text for a message. */
  getHighlightedTextForViewer = (msg: any) => {
    if (msg.type === "thinking") {
      const paragraphs = msg.text.split("\n\n");
      const html = paragraphs
        .map((p: string, idx: number) => {
          const baseId = msg.id.replace("_thinking_0", "");
          const fullChunkId = `${baseId}_thinking_${idx}`;
          const isHighlighted = this.highlightedChunkId() === fullChunkId;

          return `<span id="chunk-${fullChunkId}" class="text-chunk ${isHighlighted ? "is-highlighted" : ""}">${p}</span>`;
        })
        .join("\n\n");
      return this.sanitizer.bypassSecurityTrustHtml(html);
    }
    return msg.text || "";
  };

  /** Selects a node in the visualization by its ID. */
  selectNodeById(id: string) {
    const node = this.nodes().find((n) => n.id === id);
    if (node) {
      this.selectNode(node);
    }
  }

  /** Loads trace data for selected traces if not already loaded. */
  private updateActiveTraces() {
    const ids = this.selectedTraceIds();
    const promises: Promise<any>[] = [];

    for (const id of ids) {
      const trace = this.traces().find((t) => t.id === id);
      if (trace && !trace.data && trace.file) {
        promises.push(
          this.http
            .get(trace.file)
            .toPromise()
            .then((data: any) => {
              console.log('Thread data loaded (raw JSON):', data);
              const parsedTrace = this.traceLoaderService.parseTrace(data);
              console.log('Thread data parsed:', parsedTrace);
              trace.data = parsedTrace;

              if (parsedTrace.title) {
                trace.title = parsedTrace.title;
              }

              // Extract models
              const modelMap = new Map<
                string,
                { name: string; color: string }
              >();
              parsedTrace.steps.forEach((step) => {
                if (step.model && step.modelFamily) {
                  const name = `${step.modelFamily} ${step.model}`;
                  if (!modelMap.has(name)) {
                    modelMap.set(name, {
                      name,
                      color: getModelColor(step.model),
                    });
                  }
                } else if (step.modelFamily) {
                  const name = step.modelFamily;
                  if (!modelMap.has(name)) {
                    modelMap.set(name, {
                      name,
                      color: getModelColor(step.modelFamily),
                    });
                  }
                }
              });
              trace.models = Array.from(modelMap.values());

              return parsedTrace;
            }),
        );
      }
    }

    if (promises.length > 0) {
      Promise.all(promises).then(() => {
        // Trigger reactivity for trace titles
        this.traces.set([...this.traces()]);
        this.processTraces();
      });
    } else {
      this.processTraces();
    }
  }

  // Group nodes into thread messages: tool/system/error nest under agent turns

  // ─── Data Loading ──────────────────────────────────────────────

  /** Returns a human-readable label for a node type. */
  getRoleLabel(type: string): string {
    switch (type) {
      case TraceNodeType.USER_INPUT:
        return "User";
      case TraceNodeType.RESPONSE:
        return "Assistant";
      case TraceNodeType.THINKING:
        return "Thinking";
      case TraceNodeType.TOOL_CALL:
        return "Tool Call";
      case TraceNodeType.TOOL_DATA:
        return "Tool Data";
      case TraceNodeType.SYSTEM:
        return "Harness";
      case TraceNodeType.ERROR:
        return "Error";
      default:
        return type;
    }
  }

  /** Returns the border color for a tool node based on its name. */
  getNodeBorderColor(node: any): string {
    if (
      node.type !== TraceNodeType.TOOL_CALL &&
      node.type !== TraceNodeType.TOOL_DATA
    ) {
      return "";
    }
    return COLORS.TOOL_LINE;
  }

  /** Returns the visual configuration for a node. */
  getNodeVisualConfig(node: any) {
    return getNodeVisualConfig(node);
  }

  /** Sets the Y-axis mode (default, time, or tokens). */
  setYAxisMode(mode: "default" | "time" | "tokens") {
    this.yAxisMode.set(mode);
    this.processTraces();
  }

  onTokenMetricSelectionChange(newSelection: Set<string>) {
    this.selectedTokenTypes.set(newSelection);
    this.processTraces();
  }

  /** Sets the layout mode (column or row). */
  setLayoutMode(mode: "column" | "row") {
    this.layoutMode.set(mode);
    this.processTraces();
  }

  /** TrackBy function for nodes in the template. */
  trackByNodeId(index: number, node: any): string {
    return node.id;
  }

  /** TrackBy function for lines in the template. */
  trackByLineId(index: number, line: any): string {
    return line.id;
  }

  /** Loads the initial list of datasets. */
  loadDatasets() {
    this.datasets.set([
      { name: "Developer Agent Traces", file: "__generic_traces__" },
    ]);
    this.onDatasetChange("__generic_traces__");
  }

  /** Handles dataset selection changes. */
  onDatasetChange(file: string) {
    this.selectedDatasetFile.set(file);

    // Multi-file generic trace dataset: load filenames from manifest, populate and load on demand
    this.http.get<string[]>('assets/data/traces/manifest.json').subscribe({
      next: (files) => {
        const traces = this.traceLoaderService.getTraces(files);
        this.traces.set(traces);

        // Preload titles in background programmatically from JSON
        traces.forEach((trace) => {
          this.http.get(trace.file).subscribe((data: any) => {
            const parsedTrace = this.traceLoaderService.parseTrace(data);

            if (parsedTrace.title) {
              trace.title = parsedTrace.title;
            }

            const firstStep = parsedTrace.steps[0];
            if (firstStep?.timestamp) {
              const date = new Date(firstStep.timestamp);
              trace.date = date.toLocaleDateString([], {
                month: "short",
                day: "numeric",
              });
              trace.timestamp = date.getTime();
            }

            // Extract models
            const modelMap = new Map<string, { name: string; color: string }>();
            parsedTrace.steps.forEach((step) => {
              if (step.model && step.modelFamily) {
                const name = `${step.modelFamily} ${step.model}`;
                if (!modelMap.has(name)) {
                  modelMap.set(name, { name, color: getModelColor(step.model) });
                }
              } else if (step.modelFamily) {
                const name = step.modelFamily;
                if (!modelMap.has(name)) {
                  modelMap.set(name, {
                    name,
                    color: getModelColor(step.modelFamily),
                  });
                }
              }
            });
            trace.models = Array.from(modelMap.values());

            // Sort by timestamp descending
            const updatedTraces = [...this.traces()];
            updatedTraces.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
            this.traces.set(updatedTraces);
          });
        });

        if (traces.length > 0) {
          const firstId = traces[0].id;
          this.selectedTraceIds.set(new Set([firstId]));
          this.onTraceChange(firstId);
        }
      },
      error: (err) => {
        console.error('Failed to load trace manifest.json', err);
      }
    });
  }

  /** Handles trace selection changes (single selection). */
  onTraceChange(id: string) {
    this.selectedTraceIds.set(new Set([id]));
    this.updateActiveTraces();
  }

  /** Processes the active traces to generate nodes and lines for visualization. */
  processTraces() {
    const selectedIds = this.selectedTraceIds();
    const idsArray = [...selectedIds];

    if (idsArray.length > 0) {
      const firstTrace = this.traces().find((t) => t.id === idsArray[0]);
      if (firstTrace && firstTrace.data) {
        this.activeTrace.set(firstTrace.data);
      }
    }

    const layout = calculateTraceLayout({
      traces: this.traces(),
      selectedTraceIds: selectedIds,
      yAxisMode: this.yAxisMode(),
      layoutMode: this.layoutMode(),
      hideGaps: this.hideGaps(),
      selectedTokenTypes: this.selectedTokenTypes(),
    });

    console.log('Nodes about to render:', layout.nodes);
    this.nodes.set(layout.nodes);
    this.backboneLines.set(layout.backboneLines);
    this.contentWidth.set(layout.contentWidth);
    this.contentHeight.set(layout.contentHeight);
    this.timeTicks.set(layout.timeTicks);
    this.timeUnitLabel.set(layout.timeUnitLabel);

    this.selectedNode.set(null);
  }

  /** Selects a node. */
  selectNode(node: any) {
    this.selectedNode.set(node);

    if (node.type === "thinking") {
      // Highlight the specific chunk
      this.highlightedChunkId.set(node.id);
      setTimeout(() => {
        if (this.highlightedChunkId() === node.id) {
          this.highlightedChunkId.set(null);
        }
      }, 2000);
    }
  }
}
