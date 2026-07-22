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
  OnDestroy,
  signal,
  computed,
  HostListener,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { DomSanitizer } from "@angular/platform-browser";
import { HttpClient } from "@angular/common/http";
import { ActivatedRoute } from "@angular/router";
import { UrlParamService } from "../shared/url-param.service";
import { forkJoin, of } from "rxjs";
import { catchError, map } from "rxjs/operators";
import { AnalysisLayersService } from "./analysis-layers.service";
import { TraceLoaderService, DatasetItem, HF_PRESETS } from "./trace-loader.service";
import {
  TraceNodeColumn,
  TraceNodeType,
  ReasoningStepType,
  ReasoningTrace,
} from "./layout-helper";
import {
  SPEAKER_STYLES,
  getModelColor,
  createStyle,
  COLORS,
} from "./colors";
import { getNodeVisualConfig } from "./node-rendering-helper";
import { AGENTIC_TRACES_TEMPLATE } from "./template";
import { AGENTIC_TRACES_STYLES } from "./styles";
import { MultiSelectDropdownComponent, DropdownItem } from "../shared/multi-select-dropdown.component";
import { AnalysisToolbarComponent } from "./analysis-toolbar.component";
import { ConversationViewerComponent } from "../shared/conversation-viewer.component";
import {
  calculateTraceLayout,
  VisNode,
  ThinkingAreaNode,
  BackboneLine,
  sanitizeId,
} from "./layout-helper";
import { groupThreadMessages } from "./thread-helper";
import { HuggingFaceImportComponent } from "./hugging-face-import.component";

interface LegendEntry {
  label: string;
  subLabel?: string;
  color: string;
  isAI: boolean;
  border?: string;
  isDiamond?: boolean;
}



@Component({
  selector: "app-agentic-traces",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MultiSelectDropdownComponent,
    AnalysisToolbarComponent,
    ConversationViewerComponent,
    HuggingFaceImportComponent,
  ],
  providers: [AnalysisLayersService],
  template: AGENTIC_TRACES_TEMPLATE,
  styles: AGENTIC_TRACES_STYLES,
})
export class AgenticTracesComponent implements OnInit, OnDestroy {
  datasets = signal<DatasetItem[]>([]);
  selectedDatasetFile = signal<string>("");
  isLoading = signal<boolean>(false);

  // HF Import Modal State
  showImportModal = signal<boolean>(false);
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
  private lastSelectedDataset = '';

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

  legendEntries = computed<LegendEntry[]>(() => {
    const traces = this.selectedTraces();
    const modelEntries: LegendEntry[] = [];
    const seenNames = new Set<string>();

    for (const trace of traces) {
      if (trace?.models) {
        for (const m of trace.models) {
          if (!seenNames.has(m.name)) {
            seenNames.add(m.name);
            
            let label = m.name;
            let subLabel: string | undefined = undefined;
            const parenIdx = m.name.indexOf('(');
            if (parenIdx !== -1) {
              label = m.name.substring(0, parenIdx).trim();
              subLabel = m.name.substring(parenIdx).trim();
            }

            modelEntries.push({
              label: label,
              subLabel: subLabel,
              color: m.color,
              isAI: true,
            });
          }
        }
      }
    }

    if (modelEntries.length === 0) {
      modelEntries.push({ label: "Agent", color: COLORS.AGENT, isAI: true });
    }

    return [
      {
        label: "User",
        color: COLORS.USER_BG,
        isAI: false,
        border: `1px solid ${COLORS.USER_BORDER}`,
      },
      ...modelEntries,
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
    
    // Recursively annotate layer search matches and card glowStyle outlines
    const annotateMatches = (msgs: any[]) => {
      for (const m of msgs) {
        const matches = this.layersService.isNodeMatch(m.id);
        m.isSearchMatch = matches;
        
        if (matches) {
          const colors = this.layersService.getLayerColorMap().get(m.id);
          if (colors && colors.length > 0) {
            // Apply outline/glow using the matching search layer's color
            m.glowStyle = `0 0 0 2px ${colors[0]}, 0 0 8px ${colors[0]}50`;
          } else {
            m.glowStyle = undefined;
          }
        } else {
          m.glowStyle = undefined;
        }

        if (m.children) {
          annotateMatches(m.children);
        }
      }
    };
    annotateMatches(messages);
    
    console.log('Thread messages about to render:', messages);
    return messages;
  });

  sanitizeId = sanitizeId;

  constructor(
    private http: HttpClient,
    public layersService: AnalysisLayersService,
    private traceLoaderService: TraceLoaderService,
    private sanitizer: DomSanitizer,
    private route: ActivatedRoute,
    private urlParamService: UrlParamService,
  ) { }

  @HostListener('window:keydown.escape')
  handleEscape() {
    this.layersService.disableAllLayers();
  }

  onBackgroundClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    const isBackground = 
      target.classList.contains('vis-container') ||
      target.classList.contains('vis-scroll-area') ||
      target.classList.contains('vis-content') ||
      target.classList.contains('col-lane') ||
      target.classList.contains('row-lane') ||
      target.classList.contains('vis-page-container');

    if (isBackground) {
      this.layersService.disableAllLayers();
    }
  }

  private clearCacheFn = () => {
    const count = this.layersService.clearSearchCache();
    console.log(`[Agent Trace] Cleared ${count} cached search results.`);
  };

  ngOnInit() {
    (window as any).clearCache = this.clearCacheFn;
    (window as any).clearcache = this.clearCacheFn;
    this.loadDatasets();
  }

  ngOnDestroy() {
    if ((window as any).clearCache === this.clearCacheFn) {
      delete (window as any).clearCache;
      delete (window as any).clearcache;
    }
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
    this.updateUrlParams();
  }

  /** Returns the speaker label for the viewer. */
  getSpeakerLabelForViewer = (msg: any) => this.getRoleLabel(msg.type);
  /** Returns the text color for a message type. */
  getSpeakerColorForViewer = (msg: any) => {
    if (msg.type === "response" || msg.type === "thinking") {
      if (msg.color) return msg.color;
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
      const color = msg.color || (this.traces().find((t) => t.id === (msg.traceId || this.activeTraceId())) as any)?.agentColor;
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
      const color = msg.color || (this.traces().find((t) => t.id === (msg.traceId || this.activeTraceId())) as any)?.agentColor;
      if (color) {
        return createStyle(color).border;
      }
    }
    return SPEAKER_STYLES[msg.type]?.border || "1px solid #e5e7eb";
  };

  /** Returns the highlighted text for a message. */
  getHighlightedTextForViewer = (msg: any) => {
    const text = msg.text || "";

    // Collect all matching search spans for this node ID
    const matchingSpans: Array<{ text: string; color: string }> = [];
    for (const layer of this.layersService.layers()) {
      if (layer.enabled && !layer.loading) {
        const result = layer.results.get(msg.id);
        if (result && result.spans) {
          for (const span of result.spans) {
            if (span.text.trim()) {
              matchingSpans.push({ text: span.text, color: layer.color });
            }
          }
        }
      }
    }

    // Helper to highlight spans in a text block
    const highlightSpans = (rawText: string): string => {
      // Escape HTML
      let html = rawText
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

      if (matchingSpans.length === 0) return html;

      // Sort longer spans first
      const sortedSpans = [...matchingSpans].sort((a, b) => b.text.length - a.text.length);

      for (const span of sortedSpans) {
        const escapedSpan = span.text.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        try {
          const regex = new RegExp(`(${escapedSpan})`, 'gi');
          html = html.replace(regex, (match) => {
            return `___MARK_START_${span.color}___${match}___MARK_END___`;
          });
        } catch (e) {
          console.warn('Regex failed:', span.text, e);
        }
      }

      // Convert tokens back to styling
      const startRegex = /___MARK_START_(.+?)___/g;
      const endRegex = /___MARK_END___/g;
      html = html
        .replace(startRegex, (_, color) => {
          let highlightBg = color;
          if (highlightBg.startsWith('rgb')) {
            highlightBg = highlightBg.replace('rgb(', 'rgba(').replace(')', ', 0.35)');
          } else if (highlightBg.startsWith('#')) {
            highlightBg = highlightBg + '55';
          }
          return `<mark class="search-span-highlight" style="background-color: ${highlightBg}; color: inherit; padding: 1px 3px; border-radius: 3px; border-bottom: 1.5px solid ${color}; font-weight: 500;">`;
        })
        .replace(endRegex, '</mark>');

      return html;
    };

    if (msg.type === "thinking") {
      const paragraphs = text.split("\n\n");
      const html = paragraphs
        .map((p: string, idx: number) => {
          const baseId = msg.id.replace("_thinking_0", "");
          const fullChunkId = `${baseId}_thinking_${idx}`;
          const isHighlighted = this.highlightedChunkId() === fullChunkId;
          const highlightedContent = highlightSpans(p);

          return `<span id="chunk-${fullChunkId}" class="text-chunk ${isHighlighted ? "is-highlighted" : ""}">${highlightedContent}</span>`;
        })
        .join("\n\n");
      return this.sanitizer.bypassSecurityTrustHtml(html);
    }

    const finalHtml = highlightSpans(text);
    return this.sanitizer.bypassSecurityTrustHtml(finalHtml);
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
              const parsedTrace = this.traceLoaderService.parseTrace(data, trace.id);
              console.log('Thread data parsed:', parsedTrace);
              trace.data = parsedTrace;

              if (parsedTrace.title) {
                trace.title = parsedTrace.title;
              }

              trace.models = parsedTrace.models || [];

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

  private loadImportedDatasets(): DatasetItem[] {
    try {
      const data = localStorage.getItem('imported_datasets');
      return data ? JSON.parse(data) : [];
    } catch (e) {
      console.error('Failed to load imported datasets from localStorage', e);
      return [];
    }
  }

  private saveImportedDatasets(datasets: DatasetItem[]) {
    try {
      localStorage.setItem('imported_datasets', JSON.stringify(datasets));
    } catch (e) {
      console.error('Failed to save imported datasets to localStorage', e);
    }
  }

  private updateUrlParams() {
    const currentDataset = this.selectedDatasetFile();
    const currentTraces = this.traces();
    const selectedIds = this.selectedTraceIds();

    const indices: number[] = [];
    currentTraces.forEach((t, idx) => {
      if (selectedIds.has(t.id)) {
        indices.push(idx);
      }
    });

    this.urlParamService.updateQueryParams(
      {
        dataset: currentDataset || null,
        indices: indices.length > 0 ? indices.join(',') : null,
      },
      this.route
    );
  }



  private applyTraceSelection(tracesList: any[], targetIndices?: number[] | null) {
    if (tracesList.length === 0) {
      this.selectedTraceIds.set(new Set());
      this.activeTrace.set(null);
      this.updateUrlParams();
      return;
    }

    const selectedIds = this.urlParamService.validateAndSelectTraceIds(tracesList, targetIndices);
    this.selectedTraceIds.set(new Set(selectedIds));
    this.updateActiveTraces();
    this.updateUrlParams();
  }

  /** Loads the initial list of datasets. */
  loadDatasets(selectDatasetId?: string) {
    this.isLoading.set(true);
    this.http.get<any>('assets/data/traces/manifest.json').subscribe({
      next: (manifest) => {
        let loadedDatasets: DatasetItem[] = [];
        if (Array.isArray(manifest) && manifest.length > 0 && typeof manifest[0] === 'object' && 'files' in manifest[0]) {
          loadedDatasets = manifest.map(ds => ({ name: ds.name, file: ds.id }));
        } else {
          loadedDatasets = [
            { name: "Developer Agent Traces", file: "developer_agent_traces" },
          ];
        }

        // Add presets
        loadedDatasets = [...loadedDatasets, ...HF_PRESETS];

        // Add user-imported datasets
        const imported = this.loadImportedDatasets();
        loadedDatasets = [...loadedDatasets, ...imported];

        this.datasets.set(loadedDatasets);
        this.isLoading.set(false);

        const { targetId, pendingIndices } = this.urlParamService.resolveInitialDatasetAndIndices(
          loadedDatasets,
          selectDatasetId,
          this.route
        );
        if (targetId) {
          this.onDatasetChange(targetId, pendingIndices);
        }
      },
      error: (err) => {
        console.error('Failed to load trace manifest.json', err);
        let loadedDatasets = [...HF_PRESETS];
        const imported = this.loadImportedDatasets();
        loadedDatasets = [...loadedDatasets, ...imported];

        this.datasets.set(loadedDatasets);
        this.isLoading.set(false);

        const { targetId, pendingIndices } = this.urlParamService.resolveInitialDatasetAndIndices(
          loadedDatasets,
          selectDatasetId,
          this.route
        );
        if (targetId) {
          this.onDatasetChange(targetId, pendingIndices);
        }
      }
    });
  }

  /** Handles dataset selection changes. */
  onDatasetChange(file: string, targetIndices?: number[] | null) {
    if (file === '__import_hf_dataset__') {
      this.openImportModal();
      setTimeout(() => {
        this.selectedDatasetFile.set(this.lastSelectedDataset);
      });
      return;
    }
    this.lastSelectedDataset = file;
    this.selectedDatasetFile.set(file);

    const ds = this.datasets().find((d) => d.file === file);
    if (!ds) return;

    if (ds.isRemote || ds.isImported) {
      // Remote Hugging Face Dataset Ingestion
      this.isLoading.set(true);
      this.traces.set([]);
      this.activeTrace.set(null);

      const maxTraces = ds.maxTraces || (ds.isRemote ? 5 : 50);

      const startLoading = (urls: string[]) => {
        this.traceLoaderService.loadRemoteDataset(urls, maxTraces)
          .then((records) => {
            this.processLoadedRecords(records, maxTraces, targetIndices);
          })
          .catch((err) => {
            console.error('Failed to load remote dataset traces', err);
            this.isLoading.set(false);
          });
      };

      if (ds.urls && ds.urls.length > 0) {
        startLoading(ds.urls);
      } else if (ds.repoId) {
        this.traceLoaderService.resolveRepositoryUrls(ds.repoId)
          .then((urls) => {
            ds.urls = urls; // cache the resolved URLs
            startLoading(urls);
          })
          .catch((err) => {
            console.error('Failed to resolve repository files', err);
            this.isLoading.set(false);
          });
      } else {
        this.isLoading.set(false);
      }
    } else {
      // Local Dataset Loading
      this.isLoading.set(true);
      this.traces.set([]);
      this.activeTrace.set(null);

      this.http.get<any>('assets/data/traces/manifest.json').subscribe({
        next: (manifest) => {
          let files: string[] = [];
          if (Array.isArray(manifest) && manifest.length > 0 && typeof manifest[0] === 'object' && 'files' in manifest[0]) {
            const matchingDs = manifest.find((d: any) => d.id === file);
            if (matchingDs) {
              files = matchingDs.files;
            }
          } else {
            files = manifest;
          }

          const traces = this.traceLoaderService.getTraces(files);
          this.traces.set(traces);

          let remainingToPreload = traces.length;
          if (remainingToPreload === 0) {
            this.isLoading.set(false);
            return;
          }

          // Preload titles in background programmatically from JSON
          traces.forEach((trace) => {
            this.http.get(trace.file).subscribe({
              next: (data: any) => {
                const parsedTrace = this.traceLoaderService.parseTrace(data, trace.id);

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

                trace.models = parsedTrace.models || [];
                trace.data = parsedTrace;

                const updatedTraces = [...this.traces()];
                updatedTraces.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
                this.traces.set(updatedTraces);

                remainingToPreload--;
                if (remainingToPreload === 0) {
                  this.isLoading.set(false);
                  if (updatedTraces.length > 0) {
                    this.applyTraceSelection(updatedTraces, targetIndices);
                  }
                }
              },
              error: (err) => {
                console.error(`Failed to preload trace ${trace.file}`, err);
                remainingToPreload--;
                if (remainingToPreload === 0) {
                  this.isLoading.set(false);
                  const currentTraces = this.traces();
                  if (currentTraces.length > 0) {
                    this.applyTraceSelection(currentTraces, targetIndices);
                  }
                }
              }
            });
          });
        },
        error: (err) => {
          console.error('Failed to load trace manifest.json', err);
          this.isLoading.set(false);
        }
      });
    }
  }

  private processLoadedRecords(records: any[], maxTraces: number, targetIndices?: number[] | null) {
    if (maxTraces && maxTraces > 0) {
      records = records.slice(0, maxTraces);
    }

    const traces = records.map((record: any) => {
      const traceId = record.trace_id || record.session_id || 'default';
      const parsedTrace = this.traceLoaderService.parseTrace(record, traceId);

      let dateStr = '';
      let timestampVal = 0;
      const firstStep = parsedTrace.steps[0];
      if (firstStep?.timestamp) {
        const date = new Date(firstStep.timestamp);
        dateStr = date.toLocaleDateString([], {
          month: "short",
          day: "numeric",
        });
        timestampVal = date.getTime();
      }

      return {
        id: parsedTrace.id,
        title: parsedTrace.title || traceId,
        data: parsedTrace,
        file: '',
        models: parsedTrace.models || [],
        date: dateStr,
        timestamp: timestampVal
      };
    });

    // Sort by timestamp descending
    traces.sort((a: any, b: any) => (b.timestamp || 0) - (a.timestamp || 0));

    this.traces.set(traces);
    this.isLoading.set(false);

    this.applyTraceSelection(traces, targetIndices);
  }

  /** Handles trace selection changes (single selection). */
  onTraceChange(id: string) {
    this.selectedTraceIds.set(new Set([id]));
    this.updateActiveTraces();
    this.updateUrlParams();
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
    this.layersService.reRunAllEnabledLayers(layout.nodes);
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

  openImportModal() {
    this.showImportModal.set(true);
  }

  closeImportModal() {
    this.showImportModal.set(false);
  }

  onImportDataset(newDataset: DatasetItem) {
    const currentImported = this.loadImportedDatasets();
    this.saveImportedDatasets([newDataset, ...currentImported]);

    // Reload all datasets and switch to the new one asynchronously
    this.loadDatasets(newDataset.file);

    this.closeImportModal();
  }
}
