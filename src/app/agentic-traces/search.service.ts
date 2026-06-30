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
 * @fileoverview Search service providing fuzzy and semantic search over trace nodes.
 */

import { Injectable, signal } from '@angular/core';
import { SearchService, SearchResult } from '../shared/search/search.service';

@Injectable()
export class AgenticTracesSearchService {
  searchQuery = signal<string>('');
  searchMode = signal<'fuzzy' | 'semantic'>('fuzzy');
  searchScores = signal<Map<string, SearchResult>>(new Map());
  searchLoading = signal<boolean>(false);
  searchFocused = signal<boolean>(false);
  apiKey = signal<string>('');
  private searchDebounceTimer: any = null;
  private searchSubscription: any = null;

  constructor(private searchService: SearchService) {
    const savedKey = localStorage.getItem('reasoning_vis_api_key') || '';
    if (savedKey) this.apiKey.set(savedKey);
  }

  onSearchInput(value: string, nodes: any[]) {
    this.searchQuery.set(value);
    if (this.searchMode() === 'fuzzy') {
      this.triggerSearchDebounced(nodes);
    }
  }

  setSearchMode(mode: 'fuzzy' | 'semantic', nodes: any[]) {
    if (mode === 'semantic' && !this.apiKey()) {
      const key = prompt('Enter your Gemini API key for AI search:');
      if (!key) return;
      this.apiKey.set(key);
      localStorage.setItem('reasoning_vis_api_key', key);
    }
    this.searchMode.set(mode);
    if (this.searchQuery().trim()) this.executeSearch(nodes);
  }

  private triggerSearchDebounced(nodes: any[]) {
    clearTimeout(this.searchDebounceTimer);
    this.searchDebounceTimer = setTimeout(() => this.executeSearch(nodes), 400);
  }

  executeSearch(nodes: any[]) {
    const query = this.searchQuery();
    const searchNodes = nodes.map(n => ({ id: n.id, role: n.type, text: n.text }));
    if (!query.trim()) { this.searchScores.set(new Map()); return; }
    this.searchSubscription?.unsubscribe();
    this.searchLoading.set(true);
    this.searchSubscription = this.searchService
      .search(query, [], searchNodes, this.searchMode(), this.apiKey())
      .subscribe({
        next: results => { this.searchScores.set(results); this.searchLoading.set(false); },
        error: err => { console.error('Search failed:', err); this.searchLoading.set(false); },
      });
  }

  clearSearch() {
    this.searchQuery.set('');
    this.searchScores.set(new Map());
    this.searchSubscription?.unsubscribe();
    this.searchLoading.set(false);
  }

  isSearchMatch(nodeId: string): boolean {
    return this.searchScores().has(nodeId);
  }
}
