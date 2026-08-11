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
  ViewChild,
  ElementRef,
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
import {
  getRoleLabel,
  getNodeBorderColor,
  getSpeakerColorForViewer,
  getSpeakerBgColorForViewer,
  getSpeakerBorderForViewer,
  getHighlightedTextForViewer,
} from "./viewer-helpers";
import {
  calculateDropIndex,
  getColDropIndicatorLeft,
  getRowDropIndicatorTop,
} from "./drag-drop-helper";
import { buildFileGanttData, FILE_ROW_HEIGHT } from "./file-gantt";

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
  manualActiveTraceId = signal<string | null>(null);

  selectedTraceIds = signal<Set<string>>(new Set());
  yAxisMode = signal<"time" | "tokens">("time");
  stretch = signal<boolean>(false);
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
  sidebarWidth = signal<number>(420);
  containerWidth = signal<number>(typeof window !== 'undefined' ? Math.max(500, window.innerWidth - 450 - 50) : 1000);

  private resizeObserver?: ResizeObserver;
  private _visScrollAreaElement?: HTMLElement;
  private isResizingSidebar = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private mouseMoveListener?: (e: MouseEvent) => void;
  private mouseUpListener?: (e: MouseEvent) => void;

  @ViewChild('visScrollArea', { static: false })
  set visScrollAreaRef(ref: ElementRef<HTMLElement> | undefined) {
    const el = ref?.nativeElement;
    if (el && el !== this._visScrollAreaElement) {
      if (this._visScrollAreaElement && this.resizeObserver) {
        this.resizeObserver.unobserve(this._visScrollAreaElement);
      }
      this._visScrollAreaElement = el;
      if (this.resizeObserver) {
        this.resizeObserver.observe(el);
      }
      const measured = Math.floor(el.clientWidth - 32);
      if (measured > 0 && Math.abs(measured - this.containerWidth()) > 2) {
        this.containerWidth.set(Math.max(500, measured));
        if (this.traces().length > 0) {
          this.processTraces();
        }
      }
    }
  }

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
    const axisWidth = 60;
    return Math.max(130, baseWidth + axisWidth);
  });

  // Group nodes into thread messages: tool/system/error nest under agent turns
  activeTraceId = computed(() => {
    const selectedNode = this.selectedNode();
    if (selectedNode) {
      return selectedNode.traceId;
    }
    const manual = this.manualActiveTraceId();
    if (manual) {
      return manual;
    }
    const ids = this.selectedTraceIds();
    return ids.values().next().value;
  });

  activeTraceStepsCount = computed(() => {
    const activeId = this.activeTraceId();
    return this.nodes().filter((n) => n.traceId === activeId).length;
  });

  activeTraceTitle = computed(() => {
    const activeId = this.activeTraceId();
    const trace = this.traces().find((t) => t.id === activeId);
    return trace?.title || '';
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
  /** Exposed for template use in file-gantt rendering. */
  readonly fileRowHeight = FILE_ROW_HEIGHT;

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

  @HostListener('window:resize')
  onWindowResize() {
    if (this._visScrollAreaElement) {
      const width = Math.floor(this._visScrollAreaElement.clientWidth - 32);
      if (width > 0 && Math.abs(width - this.containerWidth()) > 2) {
        this.containerWidth.set(Math.max(500, width));
        if (this.traces().length > 0) {
          this.processTraces();
        }
      }
    }
  }

  ngOnInit() {
    (window as any).clearCache = this.clearCacheFn;
    (window as any).clearcache = this.clearCacheFn;

    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          const width = Math.floor(entry.contentRect.width - 32);
          if (width > 0 && Math.abs(width - this.containerWidth()) > 2) {
            this.containerWidth.set(Math.max(500, width));
            if (this.traces().length > 0) {
              this.processTraces();
            }
          }
        }
      });
      if (this._visScrollAreaElement) {
        this.resizeObserver.observe(this._visScrollAreaElement);
      }
    }

    this.loadDatasets();
  }

  onSidebarResizeStart(event: MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    this.isResizingSidebar = true;
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.sidebarWidth();

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    this.mouseMoveListener = (e: MouseEvent) => {
      if (!this.isResizingSidebar) return;
      const deltaX = e.clientX - this.resizeStartX;
      const minWidth = 260;
      const maxWidth = Math.max(minWidth, Math.min(window.innerWidth - 300, 1200));
      const newWidth = Math.max(minWidth, Math.min(maxWidth, this.resizeStartWidth - deltaX));
      this.sidebarWidth.set(newWidth);
    };

    this.mouseUpListener = () => {
      this.isResizingSidebar = false;
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      if (this.mouseMoveListener) {
        window.removeEventListener('mousemove', this.mouseMoveListener);
        this.mouseMoveListener = undefined;
      }
      if (this.mouseUpListener) {
        window.removeEventListener('mouseup', this.mouseUpListener);
        this.mouseUpListener = undefined;
      }
    };

    window.addEventListener('mousemove', this.mouseMoveListener);
    window.addEventListener('mouseup', this.mouseUpListener);
  }

  ngOnDestroy() {
    if (this.mouseMoveListener) {
      window.removeEventListener('mousemove', this.mouseMoveListener);
      this.mouseMoveListener = undefined;
    }
    if (this.mouseUpListener) {
      window.removeEventListener('mouseup', this.mouseUpListener);
      this.mouseUpListener = undefined;
    }
    document.body.style.userSelect = '';
    document.body.style.cursor = '';

    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = undefined;
    }
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

  // Drag and drop track reordering
  draggedTrackIndex = signal<number | null>(null);
  dropIndex = signal<number | null>(null);

  onTrackDragStart(event: DragEvent, index: number) {
    // Don't start track drag when clicking on interactive nodes
    const target = event.target as HTMLElement;
    if (target.closest('.vis-node') || target.closest('.track-nodes-layer svg') || target.closest('.track-lines-layer')) {
      event.preventDefault();
      return;
    }
    this.draggedTrackIndex.set(index);
    this.dropIndex.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
    }
  }

  onContainerDragOver(event: DragEvent) {
    if (this.draggedTrackIndex() === null) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const dropIdx = calculateDropIndex(event, this.selectedTraceIds().size, this.layoutMode());
    this.dropIndex.set(dropIdx);
  }

  onTrackDrop(event: DragEvent) {
    event.preventDefault();
    const fromIndex = this.draggedTrackIndex();
    const targetDropIndex = this.dropIndex();

    if (fromIndex !== null && targetDropIndex !== null) {
      this.executeDropReorder(fromIndex, targetDropIndex);
    }
    this.onTrackDragEnd(event);
  }

  onTrackDragEnd(event: DragEvent) {
    this.draggedTrackIndex.set(null);
    this.dropIndex.set(null);
  }

  executeDropReorder(fromIndex: number, targetDropIndex: number) {
    const currentIds = Array.from(this.selectedTraceIds());
    if (fromIndex < 0 || fromIndex >= currentIds.length) return;

    let destinationIndex = targetDropIndex;
    if (fromIndex < targetDropIndex) {
      destinationIndex = targetDropIndex - 1;
    }

    if (destinationIndex < 0 || destinationIndex >= currentIds.length) {
      return;
    }

    if (destinationIndex === fromIndex) {
      return;
    }

    const [movedId] = currentIds.splice(fromIndex, 1);
    currentIds.splice(destinationIndex, 0, movedId);

    this.selectedTraceIds.set(new Set(currentIds));
    this.processTraces();
    this.updateUrlParams();
  }

  getColDropIndicatorLeft(): number {
    return getColDropIndicatorLeft(this.dropIndex());
  }

  getRowDropIndicatorTop(): number {
    return getRowDropIndicatorTop(this.dropIndex());
  }

  /** Handles changes in the selected traces. */
  onTraceSelectionChange(newSelection: Set<string>) {
    const currentOrderedIds = Array.from(this.selectedTraceIds());

    // Keep currently selected IDs that are still in newSelection (preserving custom order)
    const updatedIds = currentOrderedIds.filter(id => newSelection.has(id));

    // Add any newly selected IDs in the order they appear in newSelection
    for (const id of newSelection) {
      if (!updatedIds.includes(id)) {
        updatedIds.push(id);
      }
    }

    this.selectedTraceIds.set(new Set(updatedIds));
    this.updateActiveTraces();
    this.updateUrlParams();
  }

  /** Returns the speaker label for the viewer. */
  getSpeakerLabelForViewer = (msg: any) => getRoleLabel(msg.type);
  /** Returns the text color for a message type. */
  getSpeakerColorForViewer = (msg: any) => getSpeakerColorForViewer(msg, this.activeTraceId(), this.traces());
  /** Returns the background color for a message type. */
  getSpeakerBgColorForViewer = (msg: any) => getSpeakerBgColorForViewer(msg, this.activeTraceId(), this.traces());
  /** Returns the border style for a message type. */
  getSpeakerBorderForViewer = (msg: any) => getSpeakerBorderForViewer(msg, this.activeTraceId(), this.traces());
  /** Returns the highlighted text for a message. */
  getHighlightedTextForViewer = (msg: any) => getHighlightedTextForViewer(msg, this.layersService, this.sanitizer, this.highlightedChunkId());

  getNodeBorderColor = getNodeBorderColor;
  /** Selects a node in the visualization by its ID. */
  selectNodeById(id: string) {
    const node = this.nodes().find((n) => n.id === id);
    if (node) {
      this.selectNode(node);
    }
  }

  /** Jumps to the beginning of the trace and selects the first node. */
  onJumpToStart() {
    const msgs = this.threadMessages();
    if (msgs.length > 0) {
      this.selectNodeById(msgs[0].id);
    }
  }

  /** Jumps to the end of the trace and selects the last node. */
  onJumpToEnd() {
    const msgs = this.threadMessages();
    if (msgs.length > 0) {
      const lastMsg = msgs[msgs.length - 1];
      const lastId = (lastMsg.children && lastMsg.children.length > 0)
        ? lastMsg.children[lastMsg.children.length - 1].id
        : lastMsg.id;
      this.selectNodeById(lastId);
    }
  }

  /** Jumps the visualization scroll area to the top and selects the first node. */
  scrollToVisStart() {
    if (this._visScrollAreaElement) {
      this._visScrollAreaElement.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
    this.onJumpToStart();
  }

  /** Jumps the visualization scroll area to the bottom and selects the last node. */
  scrollToVisEnd() {
    if (this._visScrollAreaElement) {
      this._visScrollAreaElement.scrollTo({
        top: this._visScrollAreaElement.scrollHeight,
        behavior: 'smooth'
      });
    }
    this.onJumpToEnd();
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

  /** Returns the visual configuration for a node. */
  getNodeVisualConfig(node: any) {
    return getNodeVisualConfig(node);
  }

  /** Sets the Y-axis mode (time or tokens). */
  setYAxisMode(mode: "time" | "tokens") {
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
    const selectedIds = Array.from(this.selectedTraceIds());

    const indices: number[] = selectedIds
      .map(id => currentTraces.findIndex(t => t.id === id))
      .filter(idx => idx !== -1);

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
      containerWidth: this.containerWidth(),
      stretch: this.stretch(),
    });

    console.log('Nodes about to render:', layout.nodes);
    this.nodes.set(layout.nodes);
    this.layersService.reRunAllEnabledLayers(layout.nodes);
    this.backboneLines.set(layout.backboneLines);
    this.contentWidth.set(layout.contentWidth);
    this.contentHeight.set(layout.contentHeight);
    this.timeTicks.set(layout.timeTicks);
    this.timeUnitLabel.set(layout.timeUnitLabel);

    // Compute file gantt data for each trace (row layout only; harmless in column mode).
    const cw = layout.contentWidth;
    for (const id of idsArray) {
      const trace = this.traces().find(t => t.id === id);
      if (trace && trace.data) {
        // Pass trace.nodes (VisNodes with post-row-layout x positions) so the
        // gantt builder can look up each event's time-axis x coordinate.
        trace.fileGanttData = buildFileGanttData(trace.data, trace.nodes ?? [], cw);
      }
    }

    this.selectedNode.set(null);
  }

  /** Set of trace IDs whose file gantt sub-track is expanded. */
  readonly expandedFileTraceIds = signal<Set<string>>(new Set<string>());

  /** Returns whether files for a specific trace ID are currently collapsed. */
  isFilesCollapsed(traceId: string): boolean {
    return !this.expandedFileTraceIds().has(traceId);
  }

  /** Toggles collapse/expand of the files gantt sub-track for a trace. */
  toggleTraceFiles(traceId: string, event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    const current = new Set(this.expandedFileTraceIds());
    if (current.has(traceId)) {
      current.delete(traceId);
    } else {
      current.add(traceId);
    }
    this.expandedFileTraceIds.set(current);
  }

  /** Selects a track (trace) without selecting a specific node. */
  selectTrack(traceId: string, event?: Event) {
    if (event) {
      const target = event.target as HTMLElement;
      if (target.closest('.vis-node') || target.closest('.track-lines-layer') || target.closest('.track-nodes-layer')) {
        return;
      }
    }
    this.selectedNode.set(null);
    this.manualActiveTraceId.set(traceId);
  }

  /** Selects a node from the file timeline and navigates to it in the conversation viewer. */
  selectFileNode(node: any, event?: Event) {
    if (event) {
      event.stopPropagation();
    }
    if (!node) return;
    this.selectNode(node);
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
