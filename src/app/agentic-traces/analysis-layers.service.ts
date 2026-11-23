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
 * @fileoverview Service managing multiple analysis layers — each layer is a
 * search query (text or AI) with its own results, color, and toggle state.
 */

import { Inject, Injectable, Optional, computed, signal } from '@angular/core';
import { Subscription } from 'rxjs';
import { objectUrlFromSafeSource, setAnchorHref } from 'safevalues/dom';
import {
  SEMANTIC_GENERATION_CONFIG,
  SEMANTIC_PROMPT_TEMPLATE,
  SEMANTIC_SEARCH_INSTRUCTION,
  SEMANTIC_TURN_FORMAT,
  SearchResult,
  SearchService,
  fillTemplate,
} from '../shared/search/search.service';
import { TELEMETRY_TRACKER, type TelemetryTracker } from '../shared/telemetry.service';
import {
  ANALYSIS_PRESETS,
  AnalysisConfigSearch,
  AnalysisConfigV1,
  AnalysisLayer,
  AnalysisPreset,
  AnalysisResultsExample,
  AnalysisSearchExampleReport,
  AnalysisSearchResults,
  PRESET_COLORS,
  USER_AI_COLORS,
  USER_TEXT_COLORS,
} from './analysis-layers.types';
import { Mark } from './marks';
import { CustomSearchSpec } from './url-config';

/** What {@link AnalysisLayersService.buildExportConfig} includes. */
export interface ExportOptions {
  /** Layers to export; all when unset. */
  layerIds?: ReadonlySet<string>;
  /** Also export each search's current matches on these examples. */
  results?: {
    examples: readonly AnalysisResultsExample[];
    /** Example id of each trace (by trace entry id), for the traces in `examples`. */
    exampleIdByTrace: ReadonlyMap<string, string>;
    /** The searched marks, to map each matched node to its trace. */
    marks: readonly Mark[];
  };
}

/** localStorage key for the model picked for semantic search. */
const MODEL_STORAGE_KEY = 'agent_trace_vis_search_model';

@Injectable()
export class AnalysisLayersService {

  // ─── Layer state ──────────────────────────────────────────────────
  layers = signal<AnalysisLayer[]>([]);

  // ─── Search input state (for the toolbar search bar) ──────────────
  currentQuery = signal<string>('');
  currentMode = signal<'fuzzy' | 'semantic'>('semantic');
  searchFocused = signal<boolean>(false);
  /** The export dialog (opened from the toolbar's download button). */
  exportDialogOpen = signal(false);

  // ─── API key ──────────────────────────────────────────────────────
  apiKey = signal<string>('');

  // ─── Model for semantic search ────────────────────────────────────
  /** Models offered in the toolbar's model picker. */
  readonly models: readonly string[];
  model = signal<string>('');

  // ─── Derived state ────────────────────────────────────────────────
  anyLayerEnabled = computed(() => this.layers().some(l => l.enabled));
  noResultsLayers = computed(() => this.layers().filter(l => l.enabled && !l.loading && l.results.size === 0));

  private subscriptions = new Map<string, Subscription>();

  constructor(
    private searchService: SearchService,
    @Optional() @Inject(TELEMETRY_TRACKER) private telemetry?: TelemetryTracker | null,
  ) {
    const savedKey = window.localStorage.getItem('reasoning_vis_api_key') || '';
    if (savedKey) this.apiKey.set(savedKey);
    this.models = searchService.models;
    const savedModel = window.localStorage.getItem(MODEL_STORAGE_KEY) || '';
    this.model.set(this.models.includes(savedModel) ? savedModel : searchService.defaultModel);
    this.initializePresets();
  }

  private initializePresets(): void {
    const initialLayers = ANALYSIS_PRESETS.map((preset, index) => {
      const id = crypto.randomUUID();
      const color = PRESET_COLORS[index % PRESET_COLORS.length];
      return {
        id,
        name: preset.name,
        query: preset.query,
        mode: preset.mode,
        color,
        enabled: false,
        results: new Map<string, SearchResult>(),
        reports: [],
        loading: false,
        isPreset: true,
        category: preset.category,
        createdAt: Date.now() + index,
      };
    });
    this.layers.set(initialLayers);
  }

  // ─── Public API ───────────────────────────────────────────────────

  /** Ensure Gemini API key is available for AI semantic operations. Prompt user if missing. */
  ensureApiKey(): boolean {
    if (this.apiKey()) return true;
    const key = prompt('Enter your Gemini API key for AI search:');
    if (!key) return false;
    this.apiKey.set(key);
    window.localStorage.setItem('reasoning_vis_api_key', key);
    return true;
  }

  /** Submit the current toolbar query as a new layer. */
  submitSearch(marks: Mark[]): void {
    const query = this.currentQuery().trim();
    if (!query) return;
    if (this.currentMode() === 'semantic' && !this.ensureApiKey()) {
      return;
    }
    this.addLayer(query, this.currentMode(), marks);
    this.currentQuery.set('');
  }

  /** Add a new layer and immediately run its search. */
  addLayer(
    query: string,
    mode: 'fuzzy' | 'semantic',
    marks: Mark[],
    name?: string,
    isPreset = false,
    category?: AnalysisLayer['category'],
  ): void {
    const id = crypto.randomUUID();
    const color = this.getNextColor(mode);
    const layer: AnalysisLayer = {
      id,
      name: name || this.generateName(query),
      query,
      mode,
      color,
      enabled: true,
      results: new Map(),
      reports: [],
      loading: false,
      isPreset,
      ...(category ? { category } : {}),
      createdAt: Date.now(),
    };
    this.layers.update(layers => [layer, ...layers]);
    this.telemetry?.trackEvent('search_layer_added', {
      mode,
      is_preset: isPreset,
      ...(isPreset && name ? { preset_name: name } : {}),
    });
    this.runSearch(id, marks);
  }

  /** Add a preset as a new layer. */
  addPreset(preset: AnalysisPreset, marks: Mark[]): void {
    this.addLayer(preset.query, preset.mode, marks, preset.name, true, preset.category);
  }

  /** Remove a layer and cancel its pending search. */
  removeLayer(id: string): void {
    this.subscriptions.get(id)?.unsubscribe();
    this.subscriptions.delete(id);
    this.layers.update(layers => layers.filter(l => l.id !== id));
  }

  /** Toggle a layer's visibility on/off. */
  toggleLayer(id: string, marks: Mark[]): void {
    let shouldRunSearch = false;
    let toggledLayer: AnalysisLayer | undefined;
    this.layers.update(layers =>
      layers.map(l => {
        if (l.id === id) {
          const nextEnabled = !l.enabled;
          if (nextEnabled) {
            shouldRunSearch = true;
          }
          toggledLayer = { ...l, enabled: nextEnabled };
          return toggledLayer;
        }
        return l;
      })
    );

    if (toggledLayer) {
      this.telemetry?.trackEvent('search_layer_toggled', {
        mode: toggledLayer.mode,
        is_preset: toggledLayer.isPreset,
        enabled: toggledLayer.enabled,
        ...(toggledLayer.isPreset ? { preset_name: toggledLayer.name } : {}),
      });
    }

    if (shouldRunSearch) {
      this.runSearch(id, marks);
    }
  }

  /** Re-run searches for all currently enabled layers (e.g. after a new layout). */
  reRunAllEnabledLayers(marks: Mark[], promptForKey = true): void {
    if (marks.length === 0) return;
    for (const layer of this.layers()) {
      if (layer.enabled) {
        this.runSearch(layer.id, marks, promptForKey);
      }
    }
  }

  /** Restores enabled preset and custom search layers from URL config without prompting for an API key. */
  applyUrlLayers(
    presets: readonly string[],
    searches: readonly CustomSearchSpec[],
    searchMode: 'fuzzy' | 'semantic',
  ): void {
    this.currentMode.set(searchMode);
    if (presets.length > 0) {
      const presetSet = new Set(presets.map(p => p.toLowerCase()));
      this.layers.update(layers =>
        layers.map(l =>
          l.isPreset && presetSet.has(l.name.toLowerCase())
            ? { ...l, enabled: true }
            : l,
        ),
      );
    }
    if (searches.length > 0) {
      const added: AnalysisLayer[] = [];
      const existing = this.layers();
      for (const [idx, s] of searches.entries()) {
        const palette = s.mode === 'semantic' ? USER_AI_COLORS : USER_TEXT_COLORS;
        const usedColors = new Set([...existing, ...added].map(l => l.color));
        const color = palette.find(c => !usedColors.has(c)) || palette[0];
        added.push({
          id: crypto.randomUUID(),
          name: this.generateName(s.query),
          query: s.query,
          mode: s.mode,
          color,
          enabled: true,
          results: new Map<string, SearchResult>(),
          reports: [],
          loading: false,
          isPreset: false,
          createdAt: Date.now() + idx,
        });
      }
      this.layers.update(layers => [...added, ...layers]);
    }
  }

  /** Disable all search layers. */
  disableAllLayers(): void {
    this.layers.update(layers =>
      layers.map(l => l.enabled ? { ...l, enabled: false } : l)
    );
  }

  /** Update a layer's properties (name, color, query, etc.). */
  updateLayer(id: string, changes: Partial<AnalysisLayer>): void {
    this.layers.update(layers =>
      layers.map(l => l.id === id ? { ...l, ...changes } : l)
    );
  }

  /** Re-run the search for a specific layer. */
  rerunLayer(id: string, marks: Mark[]): void {
    this.runSearch(id, marks);
  }

  /** Set the search mode, prompting for API key if selecting semantic mode. */
  setSearchMode(mode: 'fuzzy' | 'semantic'): void {
    if (mode === 'semantic') {
      if (!this.ensureApiKey()) return;
    }
    this.currentMode.set(mode);
  }

  /** Set the model used for semantic search (remembered across reloads). */
  setModel(model: string): void {
    this.model.set(model);
    window.localStorage.setItem(MODEL_STORAGE_KEY, model);
  }

  /** Clear all cached search results from memory and window.localStorage. */
  clearSearchCache(): number {
    return this.searchService.clearCache();
  }

  // ─── Query helpers (used by template bindings) ────────────────────

  /**
   * Build a map of nodeId → matching layer colors.
   * Used by the conversation panel for stacked left borders.
   */
  getLayerColorMap(): Map<string, string[]> {
    const map = new Map<string, string[]>();
    for (const layer of this.layers()) {
      if (!layer.enabled) continue;
      for (const [nodeId] of layer.results) {
        const existing = map.get(nodeId) || [];
        existing.push(layer.color);
        map.set(nodeId, existing);
      }
    }
    return map;
  }

  // ─── Config export ────────────────────────────────────────────────

  /**
   * Builds a JSON-serializable config of all layers plus the method details
   * (prompt, model, ...) needed to reproduce them in an external pipeline.
   */
  buildExportConfig(options: ExportOptions = {}): AnalysisConfigV1 {
    // Oldest first, so presets come first in their original order.
    const layers = [...this.layers()]
      .filter(l => !options.layerIds || options.layerIds.has(l.id))
      .sort((a, b) => a.createdAt - b.createdAt);
    const searches: AnalysisConfigSearch[] = layers.map(l => ({
      name: l.name,
      query: l.query,
      method: l.mode,
      source: l.isPreset ? 'preset' : 'user',
      ...(options.results ? { results: layerResults(l, options.results) } : {}),
    }));

    const methods: AnalysisConfigV1['methods'] = {};
    if (searches.some(s => s.method === 'semantic')) {
      methods.semantic = {
        model: this.model(),
        generationConfig: { ...SEMANTIC_GENERATION_CONFIG },
        scope: 'perTrace',
        turnFormat: SEMANTIC_TURN_FORMAT,
        // Inline the plain-query instruction so the only search-specific
        // placeholder left is {query}.
        promptTemplate: fillTemplate(SEMANTIC_PROMPT_TEMPLATE, {
          searchInstruction: SEMANTIC_SEARCH_INSTRUCTION,
        }),
      };
    }
    if (searches.some(s => s.method === 'fuzzy')) {
      methods.fuzzy = { type: 'caseInsensitiveSubstring' };
    }

    return {
      schema: 'agent-trace-vis/autoraters',
      version: 1,
      exportedAt: new Date().toISOString(),
      methods,
      searches,
      ...(options.results ? {
        results: {
          note: 'Matches the app had already found on these examples; searches were not re-run.',
          examples: [...options.results.examples],
        },
      } : {}),
    };
  }

  /** Downloads {@link buildExportConfig} as `autoraters-YYYYMMDD-HHMM.json`. */
  downloadConfig(options: ExportOptions = {}): void {
    this.telemetry?.trackEvent('autoraters_exported', {
      search_count: this.layers().length,
    });
    const json = JSON.stringify(this.buildExportConfig(options), null, 2);
    // application/octet-stream is the safevalues-approved MIME type for
    // blobs that are meant to be downloaded.
    const blob = new Blob([json], { type: 'application/octet-stream' });
    const url = objectUrlFromSafeSource(blob);
    const pad = (n: number) => String(n).padStart(2, '0');
    const d = new Date();
    const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
    const a = document.createElement('a');
    setAnchorHref(a, url);
    a.download = `autoraters-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  // ─── Private ──────────────────────────────────────────────────────

  private runSearch(layerId: string, marks: Mark[], promptForKey = true): void {
    const layer = this.layers().find(l => l.id === layerId);
    if (!layer) return;

    if (layer.mode === 'semantic' && !this.apiKey()) {
      if (!promptForKey || !this.ensureApiKey()) {
        this.updateLayer(layerId, { enabled: false, loading: false });
        return;
      }
    }

    this.subscriptions.get(layerId)?.unsubscribe();
    this.updateLayer(layerId, { loading: true });

    const searchNodes = marks.map(m => ({
      id: m.id,
      role: m.type,
      text: m.text || '',
      traceId: m.traceId,
    }));

    const model = this.model();
    const start = performance.now();
    const sub = this.searchService
      .search(layer.query, [], searchNodes, layer.mode, this.apiKey(), model)
      .subscribe({
        next: ({ results, reports }) => {
          const durationMs = performance.now() - start;
          this.updateLayer(layerId, {
            results,
            reports,
            model: layer.mode === 'semantic' ? model : undefined,
            durationMs,
            loading: false,
          });
          if (layer.mode === 'semantic') {
            this.logReport(layer.name, layer.query, model, durationMs, reports, results);
          }
        },
        error: err => {
          console.error(`[AnalysisLayers] Search failed for layer "${layer.name}":`, err);
          this.updateLayer(layerId, { durationMs: performance.now() - start, loading: false });
        },
      });

    this.subscriptions.set(layerId, sub);
  }

  /** Prints a semantic search's reports and evidence to the console for debugging. */
  private logReport(
    name: string,
    query: string,
    model: string,
    durationMs: number,
    reports: AnalysisLayer['reports'],
    results: Map<string, SearchResult>,
  ): void {
    const lines = [
      `[AnalysisLayers] Report for "${name}" (${model}, ${(durationMs / 1000).toFixed(1)}s)`,
      `Query: ${query}`,
    ];
    for (const r of reports) {
      lines.push('', `── Trace ${r.traceId}: ${r.found ? 'FOUND' : 'NOT FOUND'} ──`, r.report || '(no report)');
    }
    console.log(lines.join('\n'));
    if (results.size > 0) {
      console.table([...results].map(([nodeId, r]) => ({
        step: r.step,
        nodeId,
        spans: r.spans.map(s => s.text).join(' | '),
        explanation: r.explanation ?? '',
      })));
    }
  }

  private getNextColor(mode: 'fuzzy' | 'semantic'): string {
    const palette = mode === 'semantic' ? USER_AI_COLORS : USER_TEXT_COLORS;
    const usedColors = new Set(this.layers().map(l => l.color));
    return palette.find(c => !usedColors.has(c)) || palette[0];
  }

  private generateName(query: string): string {
    const words = query.trim().split(/\s+/).slice(0, 4).join(' ');
    return words.length > 30 ? words.substring(0, 27) + '...' : words;
  }
}

/**
 * A layer's current matches on the exported examples. Only an enabled layer's
 * results are current: a disabled one isn't re-run when the traces change.
 */
export function layerResults(
  layer: AnalysisLayer,
  input: NonNullable<ExportOptions['results']>,
): AnalysisSearchResults {
  const status = layer.loading ? 'running' : layer.enabled ? 'complete' : 'notRun';
  if (status === 'notRun') return { status, matchedExampleIds: [], matches: [] };
  const traceOfNode = new Map(input.marks.map(m => [m.id, m.traceId]));
  const order = new Map(input.examples.map((e, i) => [e.id, i]));
  const matches = [...layer.results]
    .map(([nodeId, r]) => {
      const traceId = traceOfNode.get(nodeId);
      const exampleId = traceId === undefined ? undefined : input.exampleIdByTrace.get(traceId);
      if (exampleId === undefined) return null;
      return {
        exampleId,
        nodeId,
        ...(r.step !== undefined ? { step: r.step } : {}),
        ...(r.explanation ? { explanation: r.explanation } : {}),
      };
    })
    .filter((m): m is NonNullable<typeof m> => m !== null)
    .sort((a, b) => (order.get(a.exampleId) ?? 0) - (order.get(b.exampleId) ?? 0));
  const matchedExampleIds = [...new Set(matches.map(m => m.exampleId))];
  // Reports are keyed by trace (entry) id, like the searched marks.
  const reports = layer.reports
    .map(r => ({ exampleId: input.exampleIdByTrace.get(r.traceId), found: r.found, report: r.report }))
    .filter((r): r is AnalysisSearchExampleReport => r.exampleId !== undefined)
    .sort((a, b) => (order.get(a.exampleId) ?? 0) - (order.get(b.exampleId) ?? 0));
  return { status, matchedExampleIds, matches, ...(reports.length > 0 ? { reports } : {}) };
}
