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
import { ActivatedRoute } from "@angular/router";
import { UrlParamService } from "../shared/url-param.service";
import { AnalysisLayersService } from "./analysis-layers.service";
import { DatasetItem, DatasetService } from "./dataset.service";
import { COLORS } from "./colors";
import { MultiSelectDropdownComponent, DropdownItem } from "../shared/multi-select-dropdown.component";
import { AnalysisToolbarComponent } from "./analysis-toolbar.component";
import { ConversationViewerComponent } from "../shared/conversation-viewer.component";
import { AxisMode, hasTimestamps, layoutTraces, TraceEntry, TraceLayout, TraceNodeType } from "./layout";
import { Mark } from "./marks";
import { groupThreadMessages } from "./thread-helper";
import { HuggingFaceImportComponent } from "./hugging-face-import.component";
import { PanelMessage, getRoleLabel, speakerStyle, getHighlightedTextForViewer } from "./viewer-helpers";
import { measureDrop } from "./drag-drop-helper";
import { TraceTrackComponent } from "./trace-track";
import { ScrubBarComponent, ScrubEvent } from "./scrub-bar";
import { depthOf, groupOf, groupOrder } from "./agent-groups";
import { buildLinks, rowGeometry } from "./links";

/** Dev helpers exposed on `window` (a convention shared with the other pages). */
type DevWindow = Window & { clearCache?: () => void; clearcache?: () => void };

interface LegendEntry {
  label: string;
  subLabel?: string;
  color: string;
  isAI: boolean;
  border?: string;
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
    TraceTrackComponent,
    ScrubBarComponent,
  ],
  providers: [AnalysisLayersService],
  templateUrl: './agentic-traces.html',
  styleUrls: ['./agentic-traces.css'],
})
export class AgenticTracesComponent implements OnInit, OnDestroy {
  datasets = signal<DatasetItem[]>([]);
  selectedDatasetFile = signal<string>("");
  isLoading = signal<boolean>(false);

  // HF Import Modal State
  showImportModal = signal<boolean>(false);
  traces = signal<TraceEntry[]>([]);
  selectedMark = signal<Mark | null>(null);
  hoveredMarkId = signal<string | null>(null);
  highlightedChunkId = signal<string | null>(null);
  manualActiveTraceId = signal<string | null>(null);

  activeTrace = computed(() => {
    const activeId = this.activeTraceId();
    if (!activeId) return null;
    const trace = this.traces().find((t) => t.id === activeId);
    return trace?.data || null;
  });

  selectedTraceIds = signal<Set<string>>(new Set());
  /** The X-axis the user picked. 'time' is kept even while unavailable (see effectiveAxisMode). */
  yAxisMode = signal<AxisMode>("time");

  /** Time mode needs timestamps; true when at least one selected trace has them. */
  timeAvailable = computed(() => {
    const selected = this.selectedTraces();
    return selected.length === 0 || selected.some(t => hasTimestamps(t!.data));
  });

  /** The axis actually laid out: Time falls back to Steps while no selected trace has timestamps. */
  effectiveAxisMode = computed<AxisMode>(() =>
    this.yAxisMode() === 'time' && !this.timeAvailable() ? 'sequence' : this.yAxisMode());
  stretch = signal<boolean>(false);
  timeTicks = signal<{ label: string; x: number }[]>([]);
  showUserWait = signal<boolean>(false);
  isLegendCollapsed = signal<boolean>(false);
  // Output tokens by default: input tokens grow with context every step, so
  // they would make the tokens axis track history length rather than work done.
  selectedTokenTypes = signal<Set<string>>(new Set(['output_tokens']));
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

  private lastSelectedDataset = '';
  /** Bumped on each dataset load, so a slow load can't overwrite a newer one. */
  private datasetRequest = 0;

  /** One laid-out row per selected trace. */
  traceLayouts = signal<TraceLayout[]>([]);
  /** Every mark across all rows. */
  marks = computed(() => this.traceLayouts().flatMap(t => t.marks));
  /** Re-layouts create new row objects; key by id so rows (and their marks) keep their DOM and animate. */
  trackByTraceId = (_: number, t: TraceLayout) => t.id;

  /** Colors of the enabled search layers that match each mark id. */
  searchColors = computed(() => this.layersService.getLayerColorMap());
  contentHeight = signal<number>(1000);
  contentWidth = signal<number>(500);
  sidebarWidth = signal<number>(420);
  containerWidth = signal<number>(typeof window !== 'undefined' ? Math.max(500, window.innerWidth - 450 - 50) : 1000);

  /** Re-lays out the rows when the timeline area changes width. */
  private resizeObserver = new ResizeObserver(([entry]) => this.onScrollAreaResize(entry.contentRect.width));
  private scrollArea?: HTMLElement;
  private isResizingSidebar = false;
  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private mouseMoveListener?: (e: MouseEvent) => void;
  private mouseUpListener?: (e: MouseEvent) => void;

  /** The scroll area comes and goes with the loading screen; observe whichever is current. */
  @ViewChild('visScrollArea', { static: false })
  set visScrollAreaRef(ref: ElementRef<HTMLElement> | undefined) {
    const el = ref?.nativeElement;
    if (el === this.scrollArea) return;
    if (this.scrollArea) this.resizeObserver.unobserve(this.scrollArea);
    this.scrollArea = el;
    if (el) this.resizeObserver.observe(el);  // also reports the initial size
  }

  private onScrollAreaResize(contentWidth: number) {
    // 32px slack: the last mark extends past its timestamp, so the full width would scroll horizontally.
    const width = Math.floor(contentWidth - 32);
    if (width > 0 && Math.abs(width - this.containerWidth()) > 2) {
      this.containerWidth.set(Math.max(500, width));
      if (this.traces().length > 0) {
        this.processTraces();
      }
    }
  }

  selectedTraces = computed(() => {
    const ids = this.selectedTraceIds();
    return [...ids]
      .map((id) => this.traces().find((t) => t.id === id))
      .filter(Boolean);
  });

  /** Picker items: every trace, with subagents nested (indented) under the trace that launched them. */
  traceItems = computed<DropdownItem[]>(() => {
    const traces = this.traces();
    return groupOrder(traces, traces.map(t => t.id)).map(id => {
      const t = traces.find(e => e.id === id)!;
      return { id: t.id, title: t.title, date: t.date, agents: t.agents, depth: depthOf(traces, id) };
    });
  });

  /** Lines between rows: subagent launches and messages between agents (links.ts). */
  links = computed(() => buildLinks(
    this.traceLayouts(),
    rowGeometry(this.traceLayouts(), this.collapsedTraceIds(), this.expandedFileTraceIds()),
    new Map(this.traces().map(t => [t.id, t]))));

  /** Lines touching the hovered or selected mark; while any is, the other message lines fade. */
  activeLinks = computed(() => {
    const ids = new Set([this.hoveredMarkId(), this.selectedMark()?.id].filter((x): x is string => !!x));
    return new Set(ids.size === 0 ? [] : this.links().filter(l => l.markIds.some(id => ids.has(id))).map(l => l.id));
  });

  legendEntries = computed<LegendEntry[]>(() => {
    const traces = this.selectedTraces();
    const modelEntries: LegendEntry[] = [];
    const seenNames = new Set<string>();

    for (const trace of traces) {
      const agents = trace?.agents;
      if (agents) {
        for (const a of agents) {
          const entryKey = a.model ? `${a.name} (${a.model})` : a.name;
          if (!seenNames.has(entryKey)) {
            seenNames.add(entryKey);
            
            let label = a.name;
            let subLabel = a.model ? `(${a.model})` : undefined;

            modelEntries.push({
              label: label,
              subLabel: subLabel,
              color: a.color,
              isAI: true,
            });
          }
        }
      }
    }

    if (modelEntries.length === 0) {
      modelEntries.push({ label: "Agent", color: COLORS.AGENT, isAI: true });
    }

    const currentAgentColor = modelEntries[0]?.color || COLORS.AGENT;

    return [
      {
        label: "User",
        color: COLORS.USER_BG,
        isAI: false,
        border: `1px solid ${COLORS.USER_BORDER}`,
      },
      ...modelEntries,
      {
        label: "Harness",
        color: COLORS.USER_BG,
        isAI: false,
        border: `1.5px solid ${currentAgentColor}`,
      },
      { label: "Error", color: COLORS.ERROR_LIGHT, isAI: false },
      { label: "Tool", color: COLORS.USER_BG, isAI: false },
    ];
  });

  /** Trace shown in the side panel: the selected mark's, else the clicked row (if still shown), else the first. */
  activeTraceId = computed(() => {
    const selectedMark = this.selectedMark();
    if (selectedMark) {
      return selectedMark.traceId;
    }
    const ids = this.selectedTraceIds();
    // The clicked row may be stale: deselected, or from another dataset.
    const manual = this.manualActiveTraceId();
    if (manual && ids.has(manual)) {
      return manual;
    }
    return ids.values().next().value;
  });

  activeTraceStepsCount = computed(() => {
    const activeId = this.activeTraceId();
    return this.marks().filter((n) => n.traceId === activeId).length;
  });

  activeTraceTitle = computed(() => {
    const activeId = this.activeTraceId();
    const trace = this.traces().find((t) => t.id === activeId);
    return trace?.title || '';
  });

  /** Side-panel messages for the active trace. Search matches are highlighted in the text only. */
  threadMessages = computed(() => groupThreadMessages(this.activeTraceId(), this.marks()));


  constructor(
    public layersService: AnalysisLayersService,
    private datasetService: DatasetService,
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
    const w = window as DevWindow;
    w.clearCache = w.clearcache = this.clearCacheFn;

    void this.loadDatasets();
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

    this.resizeObserver.disconnect();
    const w = window as DevWindow;
    if (w.clearCache === this.clearCacheFn) {
      delete w.clearCache;
      delete w.clearcache;
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

  // Drag and drop track reordering (started from a row's drag handle)
  draggedTrackIndex = signal<number | null>(null);
  dropIndex = signal<number | null>(null);
  dropIndicatorTop = signal(0);

  isInteractiveElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest('.vis-node, .file-marker, .file-label, .files-header, .scrub-bar, .row-drag-handle, .row-trace-title, button, input, select, a');
  }

  onTrackDragStart(event: DragEvent, index: number) {
    this.draggedTrackIndex.set(index);
    this.dropIndex.set(null);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', String(index));
      // Drag the picture of the whole row, not just the handle.
      const row = (event.target as Element).closest('.trace-background-row');
      if (row) {
        const rect = row.getBoundingClientRect();
        event.dataTransfer.setDragImage(row, event.clientX - rect.left, event.clientY - rect.top);
      }
    }
  }

  onContainerDragOver(event: DragEvent) {
    if (this.draggedTrackIndex() === null) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
    const target = measureDrop(event, i => this.isGroupBoundary(i));
    this.dropIndex.set(target?.index ?? null);
    if (target) this.dropIndicatorTop.set(target.indicatorTop);
  }

  /** Rows can only be dropped between groups: before a group's first row, or after the last row. */
  private isGroupBoundary(rowIndex: number): boolean {
    const rows = this.traceLayouts();
    return rowIndex <= 0 || rowIndex >= rows.length || rows[rowIndex].groupId !== rows[rowIndex - 1].groupId;
  }

  onTrackDrop(event: DragEvent) {
    event.preventDefault();
    const fromIndex = this.draggedTrackIndex();
    const targetDropIndex = this.dropIndex();

    if (fromIndex !== null && targetDropIndex !== null) {
      this.executeDropReorder(fromIndex, targetDropIndex);
    }
    this.onTrackDragEnd();
  }

  onTrackDragEnd() {
    this.draggedTrackIndex.set(null);
    this.dropIndex.set(null);
  }

  /** Moves the group (a trace with its subagents, or a team) holding row `fromIndex` so it starts at row `targetDropIndex`. */
  executeDropReorder(fromIndex: number, targetDropIndex: number) {
    const rows = this.traceLayouts();
    const groupId = rows[fromIndex]?.groupId;
    if (!groupId) return;
    const start = rows.findIndex(r => r.groupId === groupId);
    let end = start;
    while (end < rows.length && rows[end].groupId === groupId) end++;
    if (targetDropIndex >= start && targetDropIndex <= end) return;  // dropped onto itself

    const ids = rows.map(r => r.id);
    const block = ids.splice(start, end - start);
    ids.splice(targetDropIndex > start ? targetDropIndex - block.length : targetDropIndex, 0, ...block);

    this.selectedTraceIds.set(new Set(groupOrder(this.traces(), ids)));
    this.processTraces();
    this.updateUrlParams();
  }

  /** Handles changes in the selected traces. Selecting a trace selects its group (subagents, or team) too; deselecting it drops them. */
  onTraceSelectionChange(newSelection: Set<string>) {
    const traces = this.traces();
    const previous = this.selectedTraceIds();
    const next = new Set(newSelection);
    for (const id of newSelection) {
      if (!previous.has(id)) for (const d of groupOf(traces, id)) next.add(d);
    }
    for (const id of previous) {
      if (!newSelection.has(id)) for (const d of groupOf(traces, id)) next.delete(d);
    }

    // Keep currently selected IDs that are still selected (preserving custom order), then append the new ones.
    const updatedIds = [...previous].filter(id => next.has(id));
    for (const id of next) {
      if (!updatedIds.includes(id)) updatedIds.push(id);
    }

    this.selectedTraceIds.set(new Set(groupOrder(traces, updatedIds)));
    this.processTraces();
    this.updateUrlParams();
  }

  // Callbacks for the side panel (the shared viewer asks for each color separately).
  getSpeakerLabelForViewer = (msg: PanelMessage) => getRoleLabel(msg.type);
  getSpeakerColorForViewer = (msg: PanelMessage) => this.speakerStyle(msg).color;
  getSpeakerBgColorForViewer = (msg: PanelMessage) => this.speakerStyle(msg).bg;
  getSpeakerBorderForViewer = (msg: PanelMessage) => this.speakerStyle(msg).border;
  getHighlightedTextForViewer = (msg: PanelMessage) => getHighlightedTextForViewer(msg, this.layersService, this.highlightedChunkId());

  private speakerStyle(msg: PanelMessage) {
    const traceId = msg.traceId || this.activeTraceId();
    return speakerStyle(msg, this.traceLayouts().find(t => t.id === traceId)?.agentColor);
  }

  /** Selects a mark by id (e.g. from a side-panel click). */
  selectMarkById(id: string) {
    const mark = this.marks().find((m) => m.id === id);
    if (mark) {
      this.selectMark(mark);
    }
  }

  /** Jumps to the beginning of the trace and selects the first node. */
  onJumpToStart() {
    const msgs = this.threadMessages();
    if (msgs.length > 0) {
      this.selectMarkById(msgs[0].id);
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
      this.selectMarkById(lastId);
    }
  }

  /** Sets the X-axis mode (time, tokens or steps). */
  setYAxisMode(mode: AxisMode) {
    this.yAxisMode.set(mode);
    this.processTraces();
  }

  onTokenMetricSelectionChange(newSelection: Set<string>) {
    this.selectedTokenTypes.set(newSelection);
    this.processTraces();
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



  private applyTraceSelection(tracesList: TraceEntry[], targetIndices?: number[] | null) {
    if (tracesList.length === 0) {
      this.selectedTraceIds.set(new Set());
      this.updateUrlParams();
      return;
    }

    const selectedIds = this.urlParamService.validateAndSelectTraceIds(tracesList, targetIndices);
    const withGroups = selectedIds.flatMap(id => groupOf(tracesList, id));
    this.selectedTraceIds.set(new Set(groupOrder(tracesList, withGroups)));
    this.processTraces();
    this.updateUrlParams();
  }

  /** Loads the list of datasets, then the dataset named in the URL (or `selectDatasetId`, or the first). */
  async loadDatasets(selectDatasetId?: string) {
    this.isLoading.set(true);
    const datasets = await this.datasetService.listDatasets();
    this.datasets.set(datasets);
    this.isLoading.set(false);

    const { targetId, pendingIndices } = this.urlParamService.resolveInitialDatasetAndIndices(
      datasets,
      selectDatasetId,
      this.route
    );
    if (targetId) {
      void this.onDatasetChange(targetId, pendingIndices);
    }
  }

  /** Handles dataset selection changes. */
  async onDatasetChange(file: string, targetIndices?: number[] | null) {
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

    const request = ++this.datasetRequest;
    this.isLoading.set(true);
    this.traces.set([]);
    try {
      const traces = await this.datasetService.loadTraces(ds);
      if (request !== this.datasetRequest) return;
      this.traces.set(traces);
      this.applyTraceSelection(traces, targetIndices);
    } catch (err) {
      console.error(`Failed to load dataset ${ds.name}`, err);
    } finally {
      if (request === this.datasetRequest) this.isLoading.set(false);
    }
  }

  /** Processes the active traces to generate nodes and lines for visualization. */
  processTraces() {
    const selectedIds = this.selectedTraceIds();
    const idsArray = [...selectedIds];

    if (idsArray.length === 1) {
      this.manualActiveTraceId.set(idsArray[0]);
    }

    const layout = layoutTraces({
      traces: this.traces(),
      selectedTraceIds: selectedIds,
      yAxisMode: this.effectiveAxisMode(),
      showUserWait: this.showUserWait(),
      selectedTokenTypes: this.selectedTokenTypes(),
      containerWidth: this.containerWidth(),
      stretch: this.stretch(),
    });

    this.traceLayouts.set(layout.traces);
    this.layersService.reRunAllEnabledLayers(this.marks());
    this.contentWidth.set(layout.contentWidth);
    this.contentHeight.set(layout.contentHeight);
    this.timeTicks.set(layout.timeTicks);
    this.selectedMark.set(null);
  }

  /** Trace ids whose files lane is expanded. */
  readonly expandedFileTraceIds = signal<Set<string>>(new Set<string>());

  /** Expands or collapses the files lane of a trace. */
  toggleTraceFiles(traceId: string) {
    const expanded = new Set(this.expandedFileTraceIds());
    if (!expanded.delete(traceId)) expanded.add(traceId);
    this.expandedFileTraceIds.set(expanded);
  }

  /**
   * Trace ids collapsed to a single line; the rest are drawn as channel lanes
   * (see trace-track). Rows are open by default, so newly selected traces
   * open without any bookkeeping.
   */
  readonly collapsedTraceIds = signal<Set<string>>(new Set<string>());

  isTraceExpanded(traceId: string): boolean {
    return !this.collapsedTraceIds().has(traceId);
  }

  /** True while any shown row is expanded (the toolbar button then offers "collapse all"). */
  readonly anyExpanded = computed(() => {
    const collapsed = this.collapsedTraceIds();
    return this.traceLayouts().some(r => !collapsed.has(r.id));
  });

  /** Expands or collapses one trace row. */
  toggleTraceExpand(traceId: string) {
    const collapsed = new Set(this.collapsedTraceIds());
    if (!collapsed.delete(traceId)) collapsed.add(traceId);
    this.collapsedTraceIds.set(collapsed);
  }

  /** Collapses every shown row, or expands them all if none is open. */
  toggleExpandAll() {
    this.collapsedTraceIds.set(this.anyExpanded()
      ? new Set(this.traceLayouts().map(r => r.id))
      : new Set<string>());
  }

  /** Toggles collapse/minimize state of the legend overlay. */
  toggleLegend(event?: Event) {
    if (event) {
      event.stopPropagation();
      event.preventDefault();
    }
    this.isLegendCollapsed.update((val) => !val);
  }

  /** Press on a row: scrub from there (the scrub makes the row active). Marks, buttons and the drag handle keep their own behavior. */
  onRowPress(event: PointerEvent, bar: ScrubBarComponent) {
    if (this.isInteractiveElement(event.target)) return;
    bar.start(event);
  }

  /** Hover on a row: preview where a press would put the playhead (not over marks, buttons or the drag handle). */
  onRowHover(event: PointerEvent, bar: ScrubBarComponent) {
    bar.hover(this.isInteractiveElement(event.target) ? null : event);
  }

  /** Selects a mark; the side panel scrolls to its message. */
  selectMark(mark: Mark) {
    this.selectedMark.set(mark);

    if (mark.type === TraceNodeType.THINKING) {
      // Briefly highlight that thinking chunk in the panel.
      this.highlightedChunkId.set(mark.id);
      setTimeout(() => {
        if (this.highlightedChunkId() === mark.id) {
          this.highlightedChunkId.set(null);
        }
      }, 2000);
    }
  }

  /** Side panel scrolls this message to the top without selecting it. */
  panelScrollTarget = signal<{ id: string } | null>(null);

  /** Scrub bar moved: select the mark under it, or in a gap select nothing and show the next mark. */
  onScrub(traceId: string, { mark, next }: ScrubEvent) {
    this.manualActiveTraceId.set(traceId);  // keep this row active when nothing is selected
    this.selectedMark.set(mark);
    if (!mark && next) this.panelScrollTarget.set({ id: next.id });
  }

  openImportModal() {
    this.showImportModal.set(true);
  }

  closeImportModal() {
    this.showImportModal.set(false);
  }

  onImportDataset(newDataset: DatasetItem) {
    this.datasetService.saveImported(newDataset);

    // Reload all datasets and switch to the new one asynchronously
    void this.loadDatasets(newDataset.file);

    this.closeImportModal();
  }
}
