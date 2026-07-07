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
 * @fileoverview Service managing multiple analysis layers — each layer is a
 * search query (text or AI) with its own results, color, and toggle state.
 * Replaces the former single-search AgenticTracesSearchService.
 */

import { Injectable, signal, computed, effect } from '@angular/core';
import { Subscription } from 'rxjs';
import { SearchService, SearchResult } from '../shared/search/search.service';
import { AnalysisLayer, AnalysisPreset, PRESET_COLORS, USER_AI_COLORS, USER_TEXT_COLORS, ANALYSIS_PRESETS } from './analysis-layers.types';

@Injectable()
export class AnalysisLayersService {

  // ─── Layer state ──────────────────────────────────────────────────
  layers = signal<AnalysisLayer[]>([]);

  // ─── Search input state (for the toolbar search bar) ──────────────
  currentQuery = signal<string>('');
  currentMode = signal<'fuzzy' | 'semantic'>('fuzzy');
  searchFocused = signal<boolean>(false);

  // ─── API key ──────────────────────────────────────────────────────
  apiKey = signal<string>('');

  // ─── Derived state ────────────────────────────────────────────────
  anyLayerEnabled = computed(() => this.layers().some(l => l.enabled));
  noResultsLayers = computed(() => this.layers().filter(l => l.enabled && !l.loading && l.results.size === 0));

  private subscriptions = new Map<string, Subscription>();

  constructor(private searchService: SearchService) {
    const savedKey = localStorage.getItem('reasoning_vis_api_key') || '';
    if (savedKey) this.apiKey.set(savedKey);
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
        loading: false,
        isPreset: true,
        createdAt: Date.now() + index,
      };
    });
    this.layers.set(initialLayers);
  }

  // ─── Public API ───────────────────────────────────────────────────

  /** Submit the current toolbar query as a new layer. */
  submitSearch(nodes: any[]): void {
    const query = this.currentQuery().trim();
    if (!query) return;
    this.addLayer(query, this.currentMode(), nodes);
    this.currentQuery.set('');
  }

  /** Add a new layer and immediately run its search. */
  addLayer(
    query: string,
    mode: 'fuzzy' | 'semantic',
    nodes: any[],
    name?: string,
    isPreset = false,
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
      loading: false,
      isPreset,
      createdAt: Date.now(),
    };
    this.layers.update(layers => [layer, ...layers]);
    this.runSearch(id, nodes);
  }

  /** Add a preset as a new layer. */
  addPreset(preset: AnalysisPreset, nodes: any[]): void {
    this.addLayer(preset.query, preset.mode, nodes, preset.name, true);
  }

  /** Remove a layer and cancel its pending search. */
  removeLayer(id: string): void {
    this.subscriptions.get(id)?.unsubscribe();
    this.subscriptions.delete(id);
    this.layers.update(layers => layers.filter(l => l.id !== id));
  }

  /** Toggle a layer's visibility on/off. */
  toggleLayer(id: string, nodes: any[]): void {
    let shouldRunSearch = false;
    this.layers.update(layers =>
      layers.map(l => {
        if (l.id === id) {
          const nextEnabled = !l.enabled;
          if (nextEnabled) {
            shouldRunSearch = true;
          }
          return { ...l, enabled: nextEnabled };
        }
        return l;
      })
    );

    if (shouldRunSearch) {
      this.runSearch(id, nodes);
    }
  }

  /** Re-run searches for all currently enabled layers (e.g. when trace nodes change). */
  reRunAllEnabledLayers(nodes: any[]): void {
    if (nodes.length === 0) return;
    for (const layer of this.layers()) {
      if (layer.enabled) {
        this.runSearch(layer.id, nodes);
      }
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
  rerunLayer(id: string, nodes: any[]): void {
    this.runSearch(id, nodes);
  }

  /** Set the search mode, prompting for API key if switching to semantic. */
  setSearchMode(mode: 'fuzzy' | 'semantic'): void {
    if (mode === 'semantic' && !this.apiKey()) {
      const key = prompt('Enter your Gemini API key for AI search:');
      if (!key) return;
      this.apiKey.set(key);
      localStorage.setItem('reasoning_vis_api_key', key);
    }
    this.currentMode.set(mode);
  }

  // ─── Query helpers (used by template bindings) ────────────────────

  /** Check if a node matches any enabled layer. */
  isNodeMatch(nodeId: string): boolean {
    return this.layers().some(l => l.enabled && l.results.has(nodeId));
  }

  /** Get the enabled layers that match a specific node. */
  getNodeLayers(nodeId: string): AnalysisLayer[] {
    return this.layers().filter(l => l.enabled && l.results.has(nodeId));
  }

  /**
   * Get a combined CSS box-shadow string for a node's matching layers.
   * Multiple shadows stack and naturally blend.
   */
  getNodeShadow(nodeId: string): string {
    const matchingLayers = this.getNodeLayers(nodeId);
    if (matchingLayers.length === 0) return 'none';
    return matchingLayers
      .map(l => {
        let color = l.color;
        if (color.startsWith('rgb(')) {
          color = color.replace('rgb(', 'rgba(').replace(')', ', 0.5)');
        } else if (color.startsWith('#')) {
          color = color + '80'; // 50% opacity
        }
        return `0 0 12px 4px ${color}`;
      })
      .join(', ');
  }

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

  // ─── Private ──────────────────────────────────────────────────────

  private runSearch(layerId: string, nodes: any[]): void {
    const layer = this.layers().find(l => l.id === layerId);
    if (!layer) return;

    this.subscriptions.get(layerId)?.unsubscribe();
    this.updateLayer(layerId, { loading: true });

    const searchNodes = nodes.map((n: any) => ({
      id: n.id,
      role: n.type || n.role || '',
      text: n.text || '',
    }));

    const sub = this.searchService
      .search(layer.query, [], searchNodes, layer.mode, this.apiKey())
      .subscribe({
        next: results => {
          this.updateLayer(layerId, { results, loading: false });
        },
        error: err => {
          console.error(`[AnalysisLayers] Search failed for layer "${layer.name}":`, err);
          this.updateLayer(layerId, { loading: false });
        },
      });

    this.subscriptions.set(layerId, sub);
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
