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
 * @fileoverview Top-level page component for the graph-based reasoning trace
 * comparison view (dataset selection, rollout comparison, shared controls).
 */

import { Component, OnInit, ChangeDetectorRef, signal, computed, ViewChildren, QueryList } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { marked } from 'marked';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AgenticTracesSearchService } from '../../agentic-traces/search.service';
import { SearchService } from '../../shared/search/search.service';
import { truncate, renderChunkedHtml, renderMarkdownWithLatex } from '../helpers';
import { SingleGraphVisComponent } from './single-graph-vis/single-graph-vis';
import { DEFAULT_CONFIG, ForceConfig } from './single-graph-vis/force-graph';
import { forkJoin, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MultiSelectDropdownComponent, DropdownItem } from '../../shared/multi-select-dropdown.component';

interface ReasoningChunk {
  text: string;
  category: 'reflection' | 'exploration' | 'deduction' | 'continuation';
  html: SafeHtml;
}

@Component({
  selector: 'app-unstructured-reasoning-graph',
  standalone: true,
  imports: [CommonModule, FormsModule, SingleGraphVisComponent, MultiSelectDropdownComponent],
  providers: [AgenticTracesSearchService, SearchService],
  templateUrl: './unstructured-reasoning-graph.html',
  styleUrls: ['./unstructured-reasoning-graph.css']
})
export class UnstructuredReasoningGraphComponent implements OnInit {
  @ViewChildren(SingleGraphVisComponent) traceVisChildren!: QueryList<SingleGraphVisComponent>;

  private readonly DATA_PATH = 'assets/data/rlvr_vs_base/';

  datasets = [
    { file: 'mistral-base_aime24_samples.json', name: 'Mistral Base' },
    { file: 'dapo-qwen-32b_aime24_samples.json', name: 'DAPO Qwen 32B' },
    { file: 'magistral-rl_aime24_samples.json', name: 'Magistral RL' },
    { file: 'qwen2.5-32b_aime24_samples.json', name: 'Qwen 2.5 32B' },
  ];
  selectedDatasets: string[] = ['mistral-base_aime24_samples.json'];
  selectedDatasetIds: Set<string> = new Set(['mistral-base_aime24_samples.json']);
  dropdownItems: DropdownItem[] = [];

  datasetData: Record<string, any[]> = {};
  uniqueQuestions: string[] = [];
  selectedQuestion: string = '';
  selectedData: any = null;
  metaFields: Array<{ key: string; value: any; display: string }> = [];
  renderedHtml: Record<string, SafeHtml> = {};

  /** Compare rollouts mode */
  compareRollouts = true;
  numRollouts = 2;
  maxRollouts = 4;
  colorByField: 'answer' | 'gt' | 'score' = 'score';

  datasetsData: Array<{
    file: string;
    name: string;
    matchingItems: any[];
    traceColors: string[];
  }> = [];

  selectedSidebarItem: any = null;
  compareMetaFields: Array<{ key: string; value: any; display: string }> = [];
  compareRenderedHtml: Record<string, SafeHtml> = {};
  colorLegendItems: Array<{ label: string; color: string }> = [];

  /** Shared force config for compare mode (controls all graphs at once) */
  sharedConfig: ForceConfig = { ...DEFAULT_CONFIG };

  showInternalStructure = false;
  chunkBy: 'steps' | 'paragraphs' | 'word' | 'sentence' | 'word_context' = 'steps';
  similarityMethod: 'semantic' | 'lexical' = 'semantic';
  /** EXPERIMENTAL: 3D force graph toggle */
  use3D = false;

  /** Search nodes derived from the currently selected question's data. */
  searchNodes = signal<Array<{ id: string; role: string; text: string }>>([]);

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
    public searchService: AgenticTracesSearchService,
  ) {
    // Configure marked for clean output
    marked.setOptions({
      breaks: false,
      gfm: true,
    });
  }

  ngOnInit() {
    this.dropdownItems = this.datasets.map(ds => ({ id: ds.file, title: ds.name }));
    this.loadDatasets(this.selectedDatasets);
  }

  onSelectionChange(selectedIds: Set<string>) {
    if (selectedIds.size === 0) return; // Prevent empty selection
    this.selectedDatasetIds = selectedIds;
    this.selectedDatasets = Array.from(selectedIds);
    this.searchService.clearSearch();
    this.loadDatasets(this.selectedDatasets);
  }

  private loadDatasets(files: string[]) {
    this.selectedData = null;
    const newData: Record<string, any[]> = {};

    const requests = files.map(file => {
      if (this.datasetData[file]) {
        newData[file] = this.datasetData[file];
        return of(this.datasetData[file]);
      } else {
        return this.http.get<any[]>(this.DATA_PATH + file).pipe(
          tap(data => {
            newData[file] = data;
          })
        );
      }
    });

    forkJoin(requests).subscribe(() => {
      this.datasetData = newData;
      this.updateQuestions();
      this.updateSelectedData();
      this.cdr.detectChanges();
    });
  }

  private updateQuestions() {
    const firstFile = this.selectedDatasets[0];
    if (firstFile && this.datasetData[firstFile]) {
      const questions = this.datasetData[firstFile].map((item: any) => item.question);
      this.uniqueQuestions = Array.from(new Set(questions));

      if (this.uniqueQuestions.length > 0 && !this.uniqueQuestions.includes(this.selectedQuestion)) {
        this.selectedQuestion = this.uniqueQuestions[0];
      }
    }
  }

  onQuestionChange(question: string) {
    this.selectedQuestion = question;
    this.updateSelectedData();
    this.searchService.clearSearch();
  }

  onCompareToggle() {
    this.selectedSidebarItem = null;
    this.compareRenderedHtml = {};
    this.compareMetaFields = [];
    this.updateSelectedData();
  }

  onColorByChange(field: string) {
    this.colorByField = field as 'answer' | 'gt' | 'score';
    this.buildColorLegend();

    // Recompute colors
    this.datasetsData.forEach(ds => {
      ds.traceColors = ds.matchingItems.map(item => this.getTraceColor(item));
    });

    this.cdr.detectChanges();
  }

  onChunkByChange(val: 'steps' | 'paragraphs' | 'word' | 'sentence' | 'word_context') {
    this.chunkBy = val;
    this.buildRenderedHtml();
    if (this.selectedSidebarItem) {
      const ds = this.datasetsData.find(d => d.matchingItems.includes(this.selectedSidebarItem));
      const idx = ds ? ds.matchingItems.indexOf(this.selectedSidebarItem) : 0;
      this.buildCompareDetail(this.selectedSidebarItem, idx);
    }
    this.cdr.detectChanges();
  }

  onChunkHover(index: number | null) {
    const prev = document.querySelector('.chunk-highlight');
    if (prev) prev.classList.remove('chunk-highlight');
    
    // Don't highlight in compare mode because the wrong trace might be selected
    if (this.compareRollouts) return;
    
    if (index !== null) {
      const el = document.getElementById(`chunk-${index}`);
      if (el) {
        el.classList.add('chunk-highlight');
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
  }

  /** Called when a node or title is clicked in single-trace mode */
  onTraceClick(event: { chunkIndex: number }) {
    // In single mode, the sidebar already shows everything — no need
  }

  /** Broadcast shared config change to all compare-mode trace children */
  onSharedConfigChange() {
    this.traceVisChildren?.forEach(child => {
      Object.assign(child.config, this.sharedConfig);
      child.onConfigChange();
    });
  }

  /** Broadcast threshold change to all compare-mode trace children */
  onSharedThresholdChange() {
    this.traceVisChildren?.forEach(child => {
      Object.assign(child.config, this.sharedConfig);
      child.onThresholdChange();
    });
  }

  onShowInternalStructureChange(show: boolean) {
    this.sharedConfig = {
      ...this.sharedConfig,
      applyIntraTraceForces: show,
    };
    this.onSharedConfigChange();
  }

  onShowCrossTraceChange(show: boolean) {
    this.sharedConfig = {
      ...this.sharedConfig,
      applyCrossTraceForces: show,
    };
    this.onSharedConfigChange();
  }

  onSimilarityMethodChange() {
    this.traceVisChildren?.forEach(child => {
      child.similarityMethod = this.similarityMethod;
      child.onSimilarityMethodChange();
    });
  }

  onNumRolloutsChange(val: number) {
    this.numRollouts = val;
    if (val === 1) {
      this.showInternalStructure = true;
      this.onShowInternalStructureChange(true);
    }
    this.updateSelectedData();
  }

  /** Called when clicking a column title in compare mode */
  onCompareColumnClick(item: any, index: number) {
    this.selectedSidebarItem = item;
    this.selectedData = item;
    this.buildCompareDetail(item, index);
    this.buildSearchNodes();
    this.buildMetaFields();
    this.buildRenderedHtml();
    this.cdr.detectChanges();
  }

  /** Called when a node in a compare-mode trace is clicked */
  onCompareTraceClick(event: { chunkIndex: number; traceIndex?: number }, datasetFile: string) {
    const columnIndex = event.traceIndex ?? 0;
    const ds = this.datasetsData.find(d => d.file === datasetFile);
    const item = ds?.matchingItems[columnIndex];

    if (item) {
      this.selectedSidebarItem = item;
      this.selectedData = item;
      this.buildCompareDetail(item, columnIndex);
      this.buildSearchNodes();
      this.buildMetaFields();
      this.buildRenderedHtml();
      this.cdr.detectChanges();

      // Scroll to the clicked step and highlight it
      setTimeout(() => {
        const element = document.getElementById(`chunk-${columnIndex}-${event.chunkIndex}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          element.classList.add('chunk-highlight');
          setTimeout(() => {
            element.classList.remove('chunk-highlight');
          }, 1000);
        }
      }, 100);
    }
  }



  /** Get the grayscale color for a trace item based on colorByField */
  getTraceColor(item: any): string {
    const allMatching = this.datasetsData.flatMap(ds => ds.matchingItems);
    if (allMatching.length === 0) return '#555';
    const values = allMatching.map(it => it[this.colorByField]);
    const unique = Array.from(new Set(values.map(v => String(v))));

    const isNumeric = unique.every(v => !isNaN(parseFloat(v)));
    if (isNumeric) {
      unique.sort((a, b) => parseFloat(a) - parseFloat(b));
    } else {
      unique.sort();
    }

    const idx = unique.indexOf(String(item[this.colorByField]));
    if (unique.length <= 1) return '#555';
    const t = idx / (unique.length - 1);
    const gray = Math.round(30 + t * 180);
    return `rgb(${gray}, ${gray}, ${gray})`;
  }



  private updateSelectedData() {
    if (this.compareRollouts) {
      this.datasetsData = this.selectedDatasets.map(file => {
        const ds = this.datasets.find(d => d.file === file);
        const data = this.datasetData[file] || [];
        const allMatching = data.filter(item => item.question === this.selectedQuestion);
        return {
          file,
          name: ds ? ds.name : file,
          matchingItems: allMatching.slice(0, this.numRollouts),
          traceColors: []
        };
      });

      // Compute trace colors after datasetsData is populated
      this.datasetsData.forEach(ds => {
        ds.traceColors = ds.matchingItems.map(item => this.getTraceColor(item));
      });

      this.maxRollouts = Math.max(...this.datasetsData.map(ds => {
        const data = this.datasetData[ds.file] || [];
        return data.filter(item => item.question === this.selectedQuestion).length;
      }), 4);

      if (!this.selectedSidebarItem && this.datasetsData.length > 0 && this.datasetsData[0].matchingItems.length > 0) {
        this.selectedSidebarItem = this.datasetsData[0].matchingItems[0];
      }

      this.selectedData = this.selectedSidebarItem;

      this.buildColorLegend();

      if (this.selectedSidebarItem) {
        this.buildCompareDetail(this.selectedSidebarItem, 0);
      }
    } else {
      const firstFile = this.selectedDatasets[0];
      const data = this.datasetData[firstFile] || [];
      this.selectedData = data.find(item => item.question === this.selectedQuestion);
      this.datasetsData = [];
    }
    this.buildSearchNodes();
    this.buildMetaFields();
    this.buildRenderedHtml();
  }

  /** Build the color legend for compare mode */
  private buildColorLegend() {
    const allMatching = this.datasetsData.flatMap(ds => ds.matchingItems);
    if (!this.compareRollouts || allMatching.length === 0) {
      this.colorLegendItems = [];
      return;
    }
    const values = allMatching.map(it => it[this.colorByField]);
    const unique = Array.from(new Set(values.map(v => String(v))));

    const isNumeric = unique.every(v => !isNaN(parseFloat(v)));
    if (isNumeric) {
      unique.sort((a, b) => parseFloat(a) - parseFloat(b));
    } else {
      unique.sort();
    }
    this.colorLegendItems = unique.map((label, idx) => {
      const t = unique.length <= 1 ? 0.5 : idx / (unique.length - 1);
      const gray = Math.round(30 + t * 180);
      return { label, color: `rgb(${gray}, ${gray}, ${gray})` };
    });
  }

  /** Build detail sidebar for a specific compare trace */
  private buildCompareDetail(item: any, index: number) {
    if (!item) {
      this.compareMetaFields = [];
      this.compareRenderedHtml = {};
      return;
    }
    // Meta fields
    const excludeKeys = new Set(['question', 'solution', 'code', 'gt_cot', 'idx']);
    const entries: Array<{ key: string; value: any; display: string }> = [];
    for (const [key, value] of Object.entries(item)) {
      if (excludeKeys.has(key)) continue;
      if (value === null || value === undefined || value === '') continue;
      if (typeof value === 'string' && value.length > 100) continue;
      const display = typeof value === 'boolean' ? (value ? '✓ true' : '✗ false') : String(value);
      entries.push({ key, value, display });
    }
    entries.sort((a, b) => {
      if (a.key === 'score') return -1;
      if (b.key === 'score') return 1;
      return a.key.localeCompare(b.key);
    });
    this.compareMetaFields = entries;

    // Rendered HTML
    this.compareRenderedHtml = {};
    for (const key of ['question', 'code', 'solution', 'gt_cot']) {
      const raw = item[key];
      if (raw && raw !== 'None') {
        if (key === 'code' || key === 'solution') {
          this.compareRenderedHtml[key] = this.sanitizer.bypassSecurityTrustHtml(
            renderChunkedHtml(raw, index, this.chunkBy)
          );
        } else {
          this.compareRenderedHtml[key] = this.sanitizer.bypassSecurityTrustHtml(
            renderMarkdownWithLatex(raw)
          );
        }
      }
    }
  }

  /** Build pseudo-nodes from the selected data for search. */
  private buildSearchNodes() {
    if (!this.selectedData) {
      this.searchNodes.set([]);
      return;
    }
    const nodes: Array<{ id: string; role: string; text: string }> = [];
    if (this.selectedData.question) {
      nodes.push({ id: 'question', role: 'user', text: this.selectedData.question });
    }
    if (this.selectedData.code) {
      nodes.push({ id: 'code', role: 'assistant', text: this.selectedData.code });
    }
    if (this.selectedData.solution) {
      nodes.push({ id: 'solution', role: 'assistant', text: this.selectedData.solution });
    }
    if (this.selectedData.gt_cot && this.selectedData.gt_cot !== 'None') {
      nodes.push({ id: 'gt_cot', role: 'system', text: this.selectedData.gt_cot });
    }
    this.searchNodes.set(nodes);
  }

  isSearchActive(): boolean {
    return this.searchService.searchScores().size > 0;
  }

  isSearchMatch(sectionId: string): boolean {
    return this.searchService.isSearchMatch(sectionId);
  }

  truncate = truncate;

  /** Pre-render all content sections as markdown+LaTeX HTML. */
  private buildRenderedHtml() {
    this.renderedHtml = {};
    if (!this.selectedData) return;

    for (const key of ['question', 'code', 'solution', 'gt_cot']) {
      const raw = this.selectedData[key];
      if (raw && raw !== 'None') {
        if (key === 'code' || key === 'solution') {
          this.renderedHtml[key] = this.sanitizer.bypassSecurityTrustHtml(
            renderChunkedHtml(raw, undefined, this.chunkBy)
          );
        } else {
          this.renderedHtml[key] = this.sanitizer.bypassSecurityTrustHtml(
            renderMarkdownWithLatex(raw)
          );
        }
      }
    }
  }

  /** Extract short metadata fields from selectedData, with score first. */
  private buildMetaFields() {
    if (!this.selectedData) {
      this.metaFields = [];
      return;
    }
    // Keys that are shown as content sections or are internal
    const excludeKeys = new Set(['question', 'solution', 'code', 'gt_cot', 'idx']);
    const priorityKey = 'score';

    const entries: Array<{ key: string; value: any; display: string }> = [];

    for (const [key, value] of Object.entries(this.selectedData)) {
      if (excludeKeys.has(key)) continue;
      if (value === null || value === undefined || value === '') continue;
      // Skip very long string values (those belong in sections)
      if (typeof value === 'string' && value.length > 100) continue;

      const display = typeof value === 'boolean' ? (value ? '✓ true' : '✗ false') : String(value);
      entries.push({ key, value, display });
    }

    // Sort: score first, then alphabetical
    entries.sort((a, b) => {
      if (a.key === priorityKey) return -1;
      if (b.key === priorityKey) return 1;
      return a.key.localeCompare(b.key);
    });

    this.metaFields = entries;
  }


}
