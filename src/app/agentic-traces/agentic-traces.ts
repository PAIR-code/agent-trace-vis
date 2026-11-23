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
  effect,
  inject,
  untracked,
  HostListener,
} from "@angular/core";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { ActivatedRoute } from "@angular/router";
import { EXTRA_MANAGED_URL_PARAMS, UrlParamService } from "../shared/url-param.service";
import { getParamFromMap, getParamValuesFromMap } from "../shared/url-params";
import { TELEMETRY_TRACKER } from "../shared/telemetry.service";
import { AnalysisLayersService } from "./analysis-layers.service";
import { ANALYSIS_PRESETS } from "./analysis-layers.types";
import { ExamplesSidebarComponent } from "../data/examples-sidebar.component";
import { INITIAL_DATASET_REFS } from "../data/initial-refs";
import { DatasetRef, parseDatasetRef, parseIndices } from "../data/dataset-refs";
import {
  CustomSearchSpec,
  LEGACY_CONFIG_PARAM_ALIASES,
  MANAGED_URL_PARAM_KEYS,
  parseUrlUiConfig,
  resolvePendingUrlSelection,
  serializeUrlUiConfig,
} from "./url-config";
import { WorkspaceService } from "../data/workspace.service";
import { COLORS, lightenColor } from "./colors";
import { MetaField, analyzeFields, fieldColorScale, formatMetaValue, scalarMetadata } from "./metadata-fields";
import { TraceSearchReport, traceSearchReports } from "./search-reports";
import type { RowSearchReport } from "./trace-track";
import { MultiSelectDropdownComponent, DropdownItem } from "../shared/multi-select-dropdown.component";
import { AnalysisToolbarComponent } from "./analysis-toolbar.component";
import { ConversationViewerComponent } from "../shared/conversation-viewer.component";
import { PanelSplitterComponent } from "../shared/panel-splitter.component";
import { ExportDialogComponent } from "./export-dialog.component";
import { AxisMode, hasTimestamps, layoutTraces, TraceEntry, TraceLayout, TraceNodeType } from "./layout";
import { Mark } from "./marks";
import { groupThreadMessages } from "./thread-helper";
import { PanelMessage, getRoleLabel, speakerStyle, getHighlightedTextForViewer } from "./viewer-helpers";
import { FileContentPreview, fileContentPreview } from './file-content';
import type { ReasoningStepType } from './layout-types';
import { measureDrop } from "./drag-drop-helper";
import { TraceTrackComponent } from "./trace-track";
import { ScrubBarComponent, ScrubEvent } from "./scrub-bar";
import { groupOrder } from "./agent-groups";
import { buildLinks, rowGeometry } from "./links";
import { ANNOTATION_BAR_HEIGHT, ChaptersService } from "./chapters.service";

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
    PanelSplitterComponent,
    ExportDialogComponent,
    TraceTrackComponent,
    ScrubBarComponent,
    ExamplesSidebarComponent,
  ],
  providers: [AnalysisLayersService],
  templateUrl: './agentic-traces.html',
  styleUrls: ['./agentic-traces.css'],
})
export class AgenticTracesComponent implements OnInit, OnDestroy {
  readonly workspace = inject(WorkspaceService);
  private readonly initialRefs = inject(INITIAL_DATASET_REFS, { optional: true });
  private readonly extraManagedParams = inject(EXTRA_MANAGED_URL_PARAMS, { optional: true }) ?? [];
  private readonly telemetry = inject(TELEMETRY_TRACKER, { optional: true });
  /** True until the workspace has restored the URL and loaded the defaults. */
  private readonly initializing = signal(true);
  private readonly initialExpandAll = signal(true);
  private pendingActiveIndex: number | null = null;
  private pendingMarkId: string | null = null;
  private migratedLegacyKeys: string[] = [];
  isLoading = computed(() => this.initializing() || (this.workspace.isFetching() && this.traces().length === 0));

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
  /** Tool marks show a glyph per kind of tool; off, every tool is a plain dot. */
  toolIcons = signal(true);
  /** Subagents as bars in their parent's packed subagents lane, instead of rows. */
  subagentsInline = signal(false);
  /** The top bar's "More settings" panel is open. */
  settingsOpen = signal(false);
  /** "Color by": a metadata field to color whole traces by, or '' for agent colors. */
  colorBy = signal('');

  private definedSelectedTraces = computed(() =>
    this.selectedTraces().filter((t): t is TraceEntry => t !== undefined));

  /**
   * Marks as searches see them. With subagents inline, a row's subagents are
   * part of its run, so each row is searched as one trace (its marks and its
   * subagents', in time order) and gets one report covering all of them.
   */
  searchMarks = computed<Mark[]>(() => {
    if (!this.subagentsInline()) return this.marks();
    const time = (m: Mark) => (m.timestamp ? new Date(m.timestamp).getTime() : NaN);
    return this.traceLayouts().flatMap(t => {
      if (!t.subagents) return t.marks;
      const all = [...t.marks, ...t.subagents.marks].map((m, i) => ({ m, i, t: time(m) }));
      // Stable: by time where both have one, else in row order.
      all.sort((a, b) => (isNaN(a.t) || isNaN(b.t) ? a.i - b.i : a.t - b.t || a.i - b.i));
      return all.map(({ m }) => (m.traceId === t.id ? m : { ...m, traceId: t.id }));
    });
  });

  /** Enabled semantic searches' reports, by trace id (see search-reports.ts). */
  searchReportsByTrace = computed(() => {
    const marks = this.searchMarks();
    return traceSearchReports(this.layersService.layers(), marks, [...new Set(marks.map(m => m.traceId))]);
  });

  /** A row's search dots: its own report per search, counting inline subagents it was found in. */
  rowSearchReports(t: TraceLayout): RowSearchReport[] {
    const byTrace = this.searchReportsByTrace();
    const own = byTrace.get(t.id) ?? [];
    const subs = t.subagents?.bars.map(b => byTrace.get(b.id) ?? []) ?? [];
    return own.map(r => {
      const subagentsFound = subs.filter(list => list.some(x => x.layerId === r.layerId && x.state === 'found')).length;
      return subagentsFound > 0 ? { ...r, subagentsFound, state: r.state === 'notFound' ? 'found' : r.state } : r;
    });
  }

  /** The hovered search dot's report, shown in a floating card. */
  searchPopover = signal<{ report: RowSearchReport; x: number; y: number } | null>(null);

  /** Search the side panel's report section points at (highlighted), after a dot click. */
  focusedReportLayer = signal<string | null>(null);

  /** The active trace's reports, for the side panel. */
  activeSearchReports = computed<TraceSearchReport[]>(() =>
    this.searchReportsByTrace().get(this.activeTraceId() ?? '') ?? []);

  /** A search dot was clicked: show that row's trace in the side panel, at its reports. */
  openSearchReport(traceId: string, layerId: string): void {
    this.selectedMark.set(null);
    this.manualActiveTraceId.set(traceId);
    this.focusedReportLayer.set(layerId);
    this.panelCollapsed.set(false);
    this.searchPopover.set(null);
    setTimeout(() => document.getElementById(`search-report-${layerId}`)?.scrollIntoView?.({ block: 'nearest' }));
  }

  /** Selected traces that no other selected trace launched. */
  private rootTraces = computed(() => {
    const traces = this.definedSelectedTraces();
    const ids = new Set(traces.map(t => t.id));
    return traces.filter(t => !t.parentId || !ids.has(t.parentId));
  });

  /** Metadata fields of the selected traces worth coloring by. */
  colorFields = computed<MetaField[]>(() =>
    analyzeFields(this.rootTraces().map(t => scalarMetadata(t.data?.metadata))));

  /** The active color-by field, if it's still offered. */
  colorField = computed(() => this.colorFields().find(f => f.key === this.colorBy()));

  /**
   * Each selected trace's color under "Color by": its root trace's value, on
   * the field's scale; subagents get a lighter shade of their run's color.
   */
  traceColors = computed<Map<string, string> | undefined>(() => {
    const field = this.colorField();
    if (!field) return undefined;
    const scale = fieldColorScale(field);
    const traces = this.definedSelectedTraces();
    const byId = new Map(traces.map(t => [t.id, t]));
    const colors = new Map<string, string>();
    for (const t of traces) {
      let root = t;
      for (let i = 0; i < 20 && root.parentId && byId.has(root.parentId); i++) root = byId.get(root.parentId)!;
      const color = scale(scalarMetadata(root.data?.metadata)?.[field.key]);
      colors.set(t.id, root === t ? color : lightenColor(color, 0.35));
    }
    return colors;
  });
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

  /** One laid-out row per selected trace. */
  traceLayouts = signal<TraceLayout[]>([]);
  /** Every mark across all rows. */
  /** Every mark, including inline subagents' (drawn as bars, but shown in the side panel and searched). */
  marks = computed(() => this.traceLayouts().flatMap(t => t.subagents ? [...t.marks, ...t.subagents.marks] : t.marks));
  /** Re-layouts create new row objects; key by id so rows (and their marks) keep their DOM and animate. */
  trackByTraceId = (_: number, t: TraceLayout) => t.id;

  /** Colors of the enabled search layers that match each mark id. */
  searchColors = computed(() => this.layersService.getLayerColorMap());
  contentHeight = signal<number>(1000);
  contentWidth = signal<number>(500);
  sidebarWidth = signal<number>(420);
  /** The trace conversation panel on the right is minimized (only its splitter shows). */
  panelCollapsed = signal(false);
  containerWidth = signal<number>(typeof window !== 'undefined' ? Math.max(500, window.innerWidth - 450 - 50) : 1000);

  /** Re-lays out the rows when the timeline area changes width. */
  private resizeObserver = new ResizeObserver(([entry]) => this.onScrollAreaResize(entry.contentRect.width));
  private scrollArea?: HTMLElement;

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
    // 12px slack: with the scroll area's 8px right padding, room for the row drag
    // handles (18px past each row) without scrolling horizontally.
    const width = Math.floor(contentWidth - 12);
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

  /** Lines between rows: subagent launches and messages between agents (links.ts). */
  links = computed(() => buildLinks(
    this.traceLayouts(),
    rowGeometry(
      this.traceLayouts(),
      this.collapsedTraceIds(),
      this.expandedFileTraceIds(),
      ANNOTATION_BAR_HEIGHT,
    ),
    new Map(this.traces().map(t => [t.id, t]))));

  /** Lines touching the hovered or selected mark; while any is, the other message lines fade. */
  activeLinks = computed(() => {
    const ids = new Set([this.hoveredMarkId(), this.selectedMark()?.id].filter((x): x is string => !!x));
    return new Set(ids.size === 0 ? [] : this.links().filter(l => l.markIds.some(id => ids.has(id))).map(l => l.id));
  });

  legendEntries = computed<LegendEntry[]>(() => {
    const traces = this.selectedTraces();
    const field = this.colorField();
    const modelEntries: LegendEntry[] = field ? this.colorLegend(field) : [];
    // One entry per agent name (agents of the same name share a color); its
    // models, in first-seen order, go in the sub-label.
    const modelsByName = new Map<string, string[]>();

    for (const trace of field ? [] : traces) {
      for (const a of trace?.agents ?? []) {
        let models = modelsByName.get(a.name);
        if (!models) {
          models = [];
          modelsByName.set(a.name, models);
          modelEntries.push({ label: a.name, color: a.color, isAI: true });
        }
        if (a.model && !models.includes(a.model)) models.push(a.model);
      }
    }
    for (const entry of modelEntries) {
      const models = modelsByName.get(entry.label) ?? [];
      if (models.length === 0) continue;
      const shown = models.slice(0, 3).join(', ');
      entry.subLabel = `(${shown}${models.length > 3 ? `, +${models.length - 3} more` : ''})`;
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

  /** Legend entries for "Color by": each value present, or a numeric field's range. */
  private colorLegend(field: MetaField): LegendEntry[] {
    const scale = fieldColorScale(field);
    if (field.kind === 'numeric') {
      return [
        { label: `${field.key}: ${formatMetaValue(field.min)}`, color: scale(field.min), isAI: true },
        { label: `${field.key}: ${formatMetaValue(field.max)}`, color: scale(field.max), isAI: true },
      ];
    }
    const present = new Set(this.rootTraces().map(t => scalarMetadata(t.data?.metadata)?.[field.key]));
    const entries: LegendEntry[] = field.values.filter(v => present.has(v))
      .map(v => ({ label: `${field.key}: ${formatMetaValue(v)}`, color: scale(v), isAI: true }));
    if (present.has(undefined)) entries.push({ label: `${field.key}: (none)`, color: scale(undefined), isAI: true });
    return entries;
  }

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

  /** The row showing the active trace: its own, or the row an inline subagent is drawn in. */
  activeRowId = computed(() => {
    const id = this.activeTraceId();
    return this.traceLayouts().find(t => t.subagents?.bars.some(b => b.id === id))?.id ?? id;
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

  private readonly currentUrlConfigParams: () => Record<string, string | string[] | null>;

  constructor(
    public layersService: AnalysisLayersService,
    public chaptersService: ChaptersService,
    private route: ActivatedRoute,
    private urlParamService: UrlParamService,
  ) {
    this.currentUrlConfigParams = computed(() => {
      const presetByName = new Map(ANALYSIS_PRESETS.map(p => [p.name, p]));
      const presets: string[] = [];
      const searches: CustomSearchSpec[] = [];
      for (const layer of this.layersService.layers()) {
        if (!layer.enabled) continue;
        const preset = layer.isPreset ? presetByName.get(layer.name) : undefined;
        if (preset && preset.query === layer.query && preset.mode === layer.mode) {
          presets.push(layer.name);
        } else {
          searches.push({ mode: layer.mode, query: layer.query });
        }
      }

      const traces = this.traces();
      const activeId = this.activeTraceId();
      const activeIdx = activeId ? traces.findIndex(t => t.id === activeId) : -1;

      return serializeUrlUiConfig({
        axis: this.yAxisMode(),
        wait: this.showUserWait(),
        fill: this.stretch(),
        toolIcons: this.toolIcons(),
        subagentsInline: this.subagentsInline(),
        colorBy: this.colorBy() || null,
        tokens: [...this.selectedTokenTypes()],
        expandAll: this.traceLayouts().length === 0 ? this.initialExpandAll() : this.anyExpanded(),
        presets,
        searches,
        searchMode: this.layersService.currentMode(),
        activeIndex: activeIdx > 0 ? activeIdx : null,
        markId: this.selectedMark()?.id ?? null,
        legendCollapsed: this.isLegendCollapsed(),
        sidebarCollapsed: this.workspace.sidebarCollapsed(),
        panelCollapsed: this.panelCollapsed(),
        sidebarFilter: this.workspace.sidebarFilter(),
      });
    });
    // Show the workspace's selected traces, keeping any row order the user dragged.
    effect(() => {
      const entries = this.workspace.selectedEntries();
      const initializing = this.initializing();
      untracked(() => this.syncWorkspaceEntries(entries, !initializing));
    });
    // The example just picked in the sidebar becomes the active row.
    effect(() => {
      const focus = this.workspace.focusEntryId();
      if (focus && !untracked(() => this.initializing())) {
        untracked(() => this.manualActiveTraceId.set(focus));
      }
    });
    // Keep the URL in sync with the workspace and UI configs, for sharing.
    effect(() => {
      const refs = this.workspace.urlRefs();
      const configParams = this.currentUrlConfigParams();
      if (untracked(() => this.initializing())) return;
      untracked(() => this.urlParamService.updateQueryParams(
        { ds: refs, dataset: null, indices: null, ...configParams }, this.route));
    });
  }

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
    const searchCount = this.layersService.clearSearchCache();
    const chapterCount = this.chaptersService.clearCache();
    console.log(`[Agent Trace] Cleared ${searchCount} search caches and ${chapterCount} chapter caches.`);
    this.chaptersService.annotateTraces(this.traceLayouts(), this.layersService.apiKey());
  };

  ngOnInit() {
    const w = window as DevWindow;
    w.clearCache = w.clearcache = this.clearCacheFn;
    this.telemetry?.trackPageView?.('/');

    void this.initWorkspace();
  }

  /** Restores the workspace and UI configuration from the URL, then loads defaults if empty. */
  private async initWorkspace() {
    const allParams = this.urlParamService.readAllQueryParams(this.route);
    const uiConfig = parseUrlUiConfig(allParams);

    this.yAxisMode.set(uiConfig.axis);
    this.showUserWait.set(uiConfig.wait);
    this.stretch.set(uiConfig.fill);
    this.toolIcons.set(uiConfig.toolIcons);
    this.subagentsInline.set(uiConfig.subagentsInline);
    this.colorBy.set(uiConfig.colorBy ?? '');
    this.selectedTokenTypes.set(new Set(uiConfig.tokens));
    this.initialExpandAll.set(uiConfig.expandAll);
    this.isLegendCollapsed.set(uiConfig.legendCollapsed);
    this.workspace.sidebarCollapsed.set(uiConfig.sidebarCollapsed);
    this.panelCollapsed.set(uiConfig.panelCollapsed);
    this.workspace.sidebarFilter.set(uiConfig.sidebarFilter);
    this.layersService.applyUrlLayers(
      uiConfig.presets,
      uiConfig.searches,
      uiConfig.searchMode,
    );
    this.pendingActiveIndex = uiConfig.activeIndex;
    this.pendingMarkId = uiConfig.markId;

    const refs: DatasetRef[] = getParamValuesFromMap(allParams, ['ds'])
      .map(parseDatasetRef)
      .filter((r): r is DatasetRef => r !== null);
    const extraRefs = this.initialRefs?.() ?? [];
    // Older links: ?dataset=<sample id>&indices=0,2 (unless a deployment translated them).
    const legacyDataset = getParamFromMap(allParams, ['dataset', 'datasetId']);
    if (legacyDataset && extraRefs.length === 0) {
      const legacyIndices = getParamFromMap(allParams, ['indices', 'index']) ?? '';
      refs.push({ sourceId: 'bundled', datasetId: legacyDataset, indices: parseIndices(legacyIndices) ?? [] });
    }
    refs.push(...extraRefs);

    const legacyKeys = [
      'dataset',
      'datasetId',
      'indices',
      'index',
      ...LEGACY_CONFIG_PARAM_ALIASES,
      ...this.extraManagedParams,
    ];
    this.migratedLegacyKeys = legacyKeys.filter(k => allParams.has(k));

    try {
      await this.workspace.init(refs);
    } finally {
      this.urlParamService.clearSearchParams([
        'ds',
        ...MANAGED_URL_PARAM_KEYS,
        ...legacyKeys,
      ]);
      // Clear init-time focus so Promise.all dataset completion order doesn't overwrite URL `active=`.
      this.workspace.focusEntryId.set(null);
      this.initializing.set(false);
      this.syncWorkspaceEntries(this.workspace.selectedEntries(), true);
      const legacyClears: Record<string, null> = {};
      for (const k of this.migratedLegacyKeys) {
        legacyClears[k] = null;
      }
      this.urlParamService.updateQueryParams(
        {
          ds: this.workspace.urlRefs(),
          dataset: null,
          indices: null,
          ...legacyClears,
          ...this.currentUrlConfigParams(),
        },
        this.route,
      );
    }
  }

  /** Syncs timeline traces and resolves URL-restored active/mark targets after init. */
  private syncWorkspaceEntries(entries: TraceEntry[], applyPending: boolean): void {
    if (this.traces() !== entries) {
      const ids = new Set(entries.map(e => e.id));
      const kept = [...this.selectedTraceIds()].filter(id => ids.has(id));
      const added = entries.map(e => e.id).filter(id => !kept.includes(id));
      this.traces.set(entries);
      this.selectedTraceIds.set(new Set(groupOrder(entries, [...kept, ...added])));
      this.processTraces();

      if (!this.initialExpandAll() && entries.length > 0) {
        this.collapsedTraceIds.set(new Set(entries.map(e => e.id)));
      }
    }
    if (!applyPending) return;
    if (this.pendingActiveIndex === null && this.pendingMarkId === null) return;

    const resolved = resolvePendingUrlSelection({
      pendingActiveIndex: this.pendingActiveIndex,
      pendingMarkId: this.pendingMarkId,
      entryIds: entries.map(e => e.id),
      marks: this.marks(),
      fallbackActiveTraceId: this.activeTraceId(),
      initializing: false,
    });
    if (resolved.activeTraceId) this.manualActiveTraceId.set(resolved.activeTraceId);
    if (resolved.mark) this.selectMark(resolved.mark);
    this.pendingActiveIndex = resolved.nextPendingActiveIndex;
    this.pendingMarkId = resolved.nextPendingMarkId;
  }

  ngOnDestroy() {
    this.resizeObserver.disconnect();
    const w = window as DevWindow;
    if (w.clearCache === this.clearCacheFn) {
      delete w.clearCache;
      delete w.clearcache;
    }
  }

  /** Renames a trace by its ID (kept in the browser for that dataset and example). */
  finishRenameTrace(id: string, newTitle: string) {
    this.workspace.rename(id, newTitle);
  }

  // Drag and drop track reordering (started from a row's drag handle)
  draggedTrackIndex = signal<number | null>(null);
  dropIndex = signal<number | null>(null);
  dropIndicatorTop = signal(0);

  isInteractiveElement(target: EventTarget | null): boolean {
    if (!target || !(target instanceof Element)) return false;
    return !!target.closest('.vis-node, .file-marker, .file-label, .files-header, .scrub-bar, .row-drag-handle, .row-trace-title, .chapter-segment, .event-marker, .chapter-key-btn, button, input, select, a');
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
  }

  // Callbacks for the side panel (the shared viewer asks for each color separately).
  getSpeakerLabelForViewer = (msg: PanelMessage) => getRoleLabel(msg.type);
  getSpeakerColorForViewer = (msg: PanelMessage) => this.speakerStyle(msg).color;
  getSpeakerBgColorForViewer = (msg: PanelMessage) => this.speakerStyle(msg).bg;
  getSpeakerBorderForViewer = (msg: PanelMessage) => this.speakerStyle(msg).border;
  getHighlightedTextForViewer = (msg: PanelMessage) => getHighlightedTextForViewer(msg, this.layersService, this.highlightedChunkId());
  /** Parsed once per tool call: the panel asks on every change detection. */
  private readonly fileContentCache = new WeakMap<object, FileContentPreview | null>();
  getFileContentForViewer = (msg: { data?: any; stepType?: ReasoningStepType }): FileContentPreview | null => {
    const toolCall = msg.data?.toolCall;
    if (!toolCall || typeof toolCall !== 'object') return null;
    if (!this.fileContentCache.has(toolCall)) {
      this.fileContentCache.set(toolCall, fileContentPreview(toolCall.input, msg.stepType));
    }
    return this.fileContentCache.get(toolCall) ?? null;
  };

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
    this.telemetry?.trackEvent('axis_mode_changed', { mode });
    this.processTraces();
  }

  /** Prompts for the Gemini API key when the user clicks the inline prompt button in the chapter bar. */
  promptForChaptersApiKey() {
    if (this.layersService.ensureApiKey()) {
      this.chaptersService.annotateTraces(this.traceLayouts(), this.layersService.apiKey());
    }
  }

  onTokenMetricSelectionChange(newSelection: Set<string>) {
    this.selectedTokenTypes.set(newSelection);
    this.processTraces();
  }


  /** Processes the active traces to generate nodes and lines for visualization. */
  processTraces() {
    const selectedIds = this.selectedTraceIds();
    const idsArray = [...selectedIds];

    // The clicked row may have been deselected or removed with its dataset.
    const manual = this.manualActiveTraceId();
    if (manual && !selectedIds.has(manual)) {
      this.manualActiveTraceId.set(idsArray[0] ?? null);
    }
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
      subagentsInline: this.subagentsInline(),
      traceColors: this.traceColors(),
    });

    this.traceLayouts.set(layout.traces);
    this.layersService.reRunAllEnabledLayers(this.searchMarks(), false);
    this.chaptersService.annotateTraces(layout.traces, this.layersService.apiKey());
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
    this.initialExpandAll.set(this.anyExpanded());
  }

  /** Collapses every shown row, or expands them all if none is open. */
  toggleExpandAll() {
    const nextCollapsed = this.anyExpanded()
      ? new Set(this.traceLayouts().map(r => r.id))
      : new Set<string>();
    this.collapsedTraceIds.set(nextCollapsed);
    this.initialExpandAll.set(nextCollapsed.size === 0);
    this.telemetry?.trackEvent('expand_all_toggled', {
      expanded: nextCollapsed.size === 0,
    });
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
    this.telemetry?.trackEvent('mark_selected', {
      step_type: String(mark.type),
    });

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
}
