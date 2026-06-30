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
 * @fileoverview Page component for the linear (token-level) reasoning trace
 * comparison view with configurable coloring and tokenization modes.
 */

import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { forkJoin, of } from 'rxjs';
import { tap } from 'rxjs/operators';
import { MultiSelectDropdownComponent, DropdownItem } from '../../shared/multi-select-dropdown.component';
import { tokenize, normalizeToken, TokenizeMode } from '../tokenizer';
import {
  ColoringScheme, TraceInfo, TokenStats,
  computeTokenStats, getTokenColor, getDatasetColors, getScoreColors, getChromogramLegend, getChromogramGradient,
} from './token-coloring';
import { renderMarkdownWithLatex } from '../helpers';
import { precomputeTokenSimilarities, mergeTokensByThreshold, SimilarityPair } from '../../shared/jaccard';

interface ColoredToken {
  raw: string;
  normalized: string;
  /** The merged (canonical) token identity — used for coloring & highlighting. */
  merged: string;
  color: string;
}

interface TraceData {
  item: any;
  dataset: string;
  datasetName: string;
  coloredTokens: ColoredToken[];
}

interface DatasetGroup {
  file: string;
  name: string;
  traces: TraceData[];
}

@Component({
  selector: 'app-unstructured-reasoning-linear',
  standalone: true,
  imports: [CommonModule, FormsModule, MultiSelectDropdownComponent],
  templateUrl: './unstructured-reasoning-linear.html',
  styleUrls: ['./unstructured-reasoning-linear.css'],
})
export class UnstructuredReasoningLinearComponent implements OnInit {
  private readonly DATA_PATH = 'assets/data/rlvr_vs_base/';

  datasets = [
    { file: 'mistral-base_aime24_samples.json', name: 'Mistral Base' },
    { file: 'dapo-qwen-32b_aime24_samples.json', name: 'DAPO Qwen 32B' },
    { file: 'magistral-rl_aime24_samples.json', name: 'Magistral RL' },
    { file: 'qwen2.5-32b_aime24_samples.json', name: 'Qwen 2.5 32B' },
  ];
  selectedDatasets: string[] = ['mistral-base_aime24_samples.json', 'magistral-rl_aime24_samples.json'];
  selectedDatasetIds: Set<string> = new Set(['mistral-base_aime24_samples.json', 'magistral-rl_aime24_samples.json']);
  dropdownItems: DropdownItem[] = [];

  datasetData: Record<string, any[]> = {};
  uniqueQuestions: string[] = [];
  selectedQuestion: string = '';

  tokenizeMode: TokenizeMode = 'paragraphs';
  coloringScheme: ColoringScheme = 'score';
  fontSize = 5;
  numRollouts = 8;
  maxRollouts = 8;

  similarityCutoff = 1.0;
  /** Maps each normalized token → its merged canonical representative. */
  private mergeMap: Map<string, string> = new Map();
  /** Cached similarity pairs — recomputed only when token set changes. */
  private cachedSimPairs: SimilarityPair[] = [];
  /** Cached token list matching cachedSimPairs indices. */
  private cachedSimTokens: string[] = [];
  /** Cached original stats for re-thresholding without re-computing. */
  private cachedOrigStats: TokenStats | null = null;

  isLoading = false;

  datasetsData: DatasetGroup[] = [];
  tokenStats: TokenStats | null = null;
  /** Cached trace infos for re-computing stats after merge changes. */
  private allTraces: TraceInfo[] = [];

  selectedTrace: TraceData | null = null;
  selectedMetaFields: Array<{ key: string; value: any; display: string }> = [];
  selectedRenderedHtml: Record<string, SafeHtml> = {};
  hoveredToken: string | null = null;
  hoveredTokenRenderedHtml: SafeHtml | null = null;

  legendItems: Array<{ label: string; color: string }> = [];
  continuousLegendGradient: string = '';

  Math = Math;

  constructor(
    private http: HttpClient,
    private cdr: ChangeDetectorRef,
    private sanitizer: DomSanitizer,
  ) {}

  ngOnInit() {
    this.dropdownItems = this.datasets.map(ds => ({ id: ds.file, title: ds.name }));
    this.loadDatasets(this.selectedDatasets);
  }

  // ── Event handlers ──

  onSelectionChange(selectedIds: Set<string>) {
    if (selectedIds.size === 0) return;
    this.selectedDatasetIds = selectedIds;
    this.selectedDatasets = Array.from(selectedIds);
    this.loadDatasets(this.selectedDatasets);
  }

  onQuestionChange(question: string) {
    this.selectedQuestion = question;
    this.rebuildVisualization();
  }

  onNumRolloutsChange(val: number) {
    this.numRollouts = val;
    this.rebuildVisualization();
  }

  onTokenizeModeChange(mode: TokenizeMode) {
    this.tokenizeMode = mode;
    this.rebuildVisualization();
  }

  onColoringSchemeChange(scheme: ColoringScheme) {
    this.coloringScheme = scheme;
    this.recolorAllTokens();
    this.buildLegend();
    this.cdr.detectChanges();
  }

  onSimilarityCutoffChange(value: number) {
    this.similarityCutoff = value;
    this.rebuildMergeMap();
    this.applyMergeToAllTokens();
    this.recolorAllTokens();
    this.buildLegend();
    this.cdr.detectChanges();
  }

  onFontSizeChange(size: number) {
    this.fontSize = size;
    this.cdr.detectChanges();
  }

  onTraceColumnClick(trace: TraceData, ds: DatasetGroup) {
    this.selectedTrace = trace;
    this.buildSelectedTraceDetails(trace);
    this.cdr.detectChanges();
  }

  onTokenHover(normalized: string | null, raw: string | null = null) {
    // Use merged identity for cross-highlighting
    this.hoveredToken = normalized ? (this.mergeMap.get(normalized) ?? normalized) : null;
    if (raw) {
      this.hoveredTokenRenderedHtml = this.sanitizer.bypassSecurityTrustHtml(
        renderMarkdownWithLatex(raw)
      );
    } else {
      this.hoveredTokenRenderedHtml = null;
    }
  }



  getTokenTraceCount(normalized: string): number {
    const merged = this.mergeMap.get(normalized) ?? normalized;
    return this.tokenStats?.traceCount.get(merged) ?? 0;
  }

  getTokenTotalCount(normalized: string): number {
    const merged = this.mergeMap.get(normalized) ?? normalized;
    return this.tokenStats?.totalCount.get(merged) ?? 0;
  }

  trackByIdx(index: number): number {
    return index;
  }

  truncate(text: string, maxLen: number): string {
    return text.length > maxLen ? text.substring(0, maxLen) + '…' : text;
  }

  // ── Data loading ──

  private loadDatasets(files: string[]) {
    const newData: Record<string, any[]> = {};

    const requests = files.map(file => {
      if (this.datasetData[file]) {
        newData[file] = this.datasetData[file];
        return of(this.datasetData[file]);
      } else {
        return this.http.get<any[]>(this.DATA_PATH + file).pipe(
          tap(data => { newData[file] = data; })
        );
      }
    });

    forkJoin(requests).subscribe(() => {
      this.datasetData = newData;
      this.updateQuestions();
      this.rebuildVisualization();
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

  // ── Core visualization pipeline ──

  private async rebuildVisualization() {
    this.isLoading = true;
    this.cdr.detectChanges();
    await new Promise(r => setTimeout(r, 50));

    // 1. Gather all matching items across selected datasets
    const allTraces: TraceInfo[] = [];
    const datasetsData: DatasetGroup[] = [];

    for (const file of this.selectedDatasets) {
      const ds = this.datasets.find(d => d.file === file);
      const data = this.datasetData[file] || [];
      const matching = data.filter(item => item.question === this.selectedQuestion);
      const limited = matching.slice(0, this.numRollouts);

      this.maxRollouts = Math.max(
        this.maxRollouts,
        ...this.selectedDatasets.map(f => {
          const d = this.datasetData[f] || [];
          return d.filter(item => item.question === this.selectedQuestion).length;
        })
      );

      const traceDataItems: TraceData[] = [];

      for (let i = 0; i < limited.length; i++) {
        const item = limited[i];
        let rawText = item.solution || item.code || '';
        if (typeof rawText === 'object' && rawText !== null) {
          rawText = (rawText as any).text || (rawText as any).content || JSON.stringify(rawText);
        }
        const text = String(rawText);
        let rawTokens = tokenize(text, this.tokenizeMode);
        let displayTokens = rawTokens;
        
        if (this.tokenizeMode === 'word') {
          rawTokens = rawTokens.filter(t => /\S/.test(t));
          displayTokens = rawTokens;
        } else if (this.tokenizeMode === 'word_context') {
          displayTokens = rawTokens.map(t => t.split('|')[1] || t);
        }
        
        const normalizedTokens = rawTokens.map(t => normalizeToken(t));
        const datasetName = ds?.name ?? file;

        // Build TraceInfo for stats computation
        const traceInfo: TraceInfo = {
          id: `${file}_${i}`,
          dataset: datasetName,
          score: typeof item.score === 'string' ? parseInt(item.score, 10) : (item.score ?? 0),
          answer: String(item.answer ?? ''),
          normalizedTokens,
        };
        allTraces.push(traceInfo);

        // Build TraceData (colored tokens will be filled after stats)
        traceDataItems.push({
          item,
          dataset: file,
          datasetName,
          coloredTokens: displayTokens.map((raw, idx) => ({
            raw,
            normalized: normalizedTokens[idx],
            merged: normalizedTokens[idx],
            color: 'transparent',
          })),
        });
      }

      datasetsData.push({
        file,
        name: ds?.name ?? file,
        traces: traceDataItems,
      });
    }

    this.datasetsData = datasetsData;

    // 2. Compute global token stats (on original tokens first)
    this.allTraces = allTraces;
    this.tokenStats = computeTokenStats(allTraces);

    // 2b. Precompute similarity pairs (expensive, cached)
    this.precomputeSimilarities();

    // 2c. Apply threshold & merge
    this.rebuildMergeMap();
    this.applyMergeToAllTokens();

    // 3. Color all tokens
    this.recolorAllTokens();

    // 4. Build legend
    this.buildLegend();

    // 5. Re-select trace if needed
    if (this.selectedTrace) {
      // Try to find equivalent trace in new data
      const found = this.datasetsData
        .flatMap(ds => ds.traces)
        .find(t => t.item === this.selectedTrace?.item);
      if (found) {
        this.selectedTrace = found;
        this.buildSelectedTraceDetails(found);
      } else {
        this.selectedTrace = null;
      }
    }
    this.isLoading = false;
    this.cdr.detectChanges();
  }

  private recolorAllTokens() {
    if (!this.tokenStats) return;
    for (const ds of this.datasetsData) {
      for (const trace of ds.traces) {
        for (const ct of trace.coloredTokens) {
          ct.color = getTokenColor(ct.merged, ct.raw, this.coloringScheme, this.tokenStats);
        }
      }
    }
  }

  /** Precompute similarity pairs (expensive). Called when token set changes. */
  private precomputeSimilarities() {
    const origStats = computeTokenStats(this.allTraces);
    this.cachedOrigStats = origStats;
    this.cachedSimTokens = Array.from(origStats.traceCount.keys());
    this.cachedSimPairs = precomputeTokenSimilarities(this.cachedSimTokens);
  }

  /** Apply threshold to cached similarities (cheap). Called on slider change. */
  private rebuildMergeMap() {
    if (!this.cachedOrigStats || this.similarityCutoff >= 1) {
      this.mergeMap = new Map();
      // Restore original stats
      if (this.allTraces.length > 0) {
        this.tokenStats = computeTokenStats(this.allTraces);
      }
      return;
    }

    this.mergeMap = mergeTokensByThreshold(
      this.cachedSimTokens,
      this.cachedSimPairs,
      this.similarityCutoff,
      this.cachedOrigStats.totalCount,
    );

    // Re-compute token stats with merged tokens so colors aggregate properly
    const mergedTraces: TraceInfo[] = this.allTraces.map(t => ({
      ...t,
      normalizedTokens: t.normalizedTokens.map(tok => this.mergeMap.get(tok) ?? tok),
    }));
    this.tokenStats = computeTokenStats(mergedTraces);
  }

  /** Apply the current mergeMap to all colored tokens. */
  private applyMergeToAllTokens() {
    for (const ds of this.datasetsData) {
      for (const trace of ds.traces) {
        for (const ct of trace.coloredTokens) {
          ct.merged = this.mergeMap.get(ct.normalized) ?? ct.normalized;
        }
      }
    }
  }

  private buildLegend() {
    if (!this.tokenStats) {
      this.legendItems = [];
      return;
    }

    switch (this.coloringScheme) {
      case 'count':
        this.legendItems = [
          { label: 'Few traces', color: 'rgba(90, 50, 160, 0.1)' },
          { label: 'Many traces', color: 'rgba(90, 50, 160, 0.9)' },
        ];
        break;
      case 'total_count':
        this.legendItems = [
          { label: 'Low count', color: 'rgba(20, 100, 120, 0.1)' },
          { label: 'High count', color: 'rgba(20, 100, 120, 0.9)' },
        ];
        break;
      case 'dataset':
        this.legendItems = getDatasetColors(this.tokenStats.datasets);
        break;
      case 'score':
        this.legendItems = getScoreColors();
        break;
      case 'answer':
        this.legendItems = this.tokenStats.answers.map((ans, i) => {
          const hue = (i / Math.max(this.tokenStats!.answers.length, 1)) * 360;
          return {
            label: ans || '(empty)',
            color: `hsl(${hue}, 70%, 50%)`,
          };
        });
        break;
      case 'chromogram':
        this.legendItems = getChromogramLegend();
        this.continuousLegendGradient = getChromogramGradient();
        break;
      default:
        this.legendItems = [];
    }
  }

  // ── Sidebar details ──

  private buildSelectedTraceDetails(trace: TraceData) {
    const item = trace.item;

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
    this.selectedMetaFields = entries;

    // Rendered HTML for question and solution
    this.selectedRenderedHtml = {};
    if (item.question) {
      this.selectedRenderedHtml['question'] = this.sanitizer.bypassSecurityTrustHtml(
        renderMarkdownWithLatex(item.question)
      );
    }
    if (item.solution) {
      let solText = item.solution;
      if (typeof solText === 'object' && solText !== null) {
        solText = (solText as any).text || (solText as any).content || JSON.stringify(solText);
      }
      this.selectedRenderedHtml['solution'] = this.sanitizer.bypassSecurityTrustHtml(
        renderMarkdownWithLatex(String(solText))
      );
    }
  }
}
