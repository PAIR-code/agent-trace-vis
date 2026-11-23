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
 * @fileoverview Dialog behind the toolbar's download button: pick which
 * searches to export, and optionally include the matches they already found
 * on the examples on screen (searches are not re-run).
 */

import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { WorkspaceService } from '../data/workspace.service';
import { AnalysisLayersService } from './analysis-layers.service';
import { AnalysisLayer, AnalysisResultsExample } from './analysis-layers.types';
import { Mark } from './marks';

@Component({
  selector: 'app-export-dialog',
  standalone: true,
  imports: [CommonModule],
  host: { '(document:keydown.escape)': 'close()' },
  template: `
    <div class="export-overlay" *ngIf="layersService.exportDialogOpen()" (click)="close()">
      <div class="export-card" role="dialog" aria-modal="true" aria-label="Export searches"
           (click)="$event.stopPropagation()">
        <div class="export-header">
          <h3>Export searches</h3>
          <button type="button" class="close-btn" title="Close" (click)="close()">&times;</button>
        </div>

        <div class="export-body">
          <div class="section-row">
            <span class="section-label">Search layers</span>
            <button type="button" class="link-btn" (click)="toggleAll()">
              {{ allSelected() ? 'Select none' : 'Select all' }}
            </button>
          </div>
          <div class="search-list">
            <!-- The prompt shows on hover. -->
            <label class="search-item" *ngFor="let l of sortedLayers(); trackBy: trackById" [title]="l.query">
              <input type="checkbox" [checked]="selected().has(l.id)" (change)="toggle(l.id)" />
              <span class="search-name"><span class="ai" *ngIf="l.mode === 'semantic'">&#10022;</span>{{ l.name }}</span>
              <span class="search-status">{{ statusLabel(l) }}</span>
            </label>
          </div>

          <label class="option">
            <input type="checkbox" [checked]="includeResults()" (change)="includeResults.set(!includeResults())" />
            <span>
              Download matching results
              <span class="hint">
                The example IDs, matching turns, and AI reports each search already found on the
                {{ examples().length }} {{ examples().length === 1 ? 'example' : 'examples' }} on screen.
                Searches aren't re-run, so searches that are turned off have no results.
              </span>
            </span>
          </label>
        </div>

        <div class="export-footer">
          <button type="button" class="btn" (click)="close()">Cancel</button>
          <button type="button" class="btn primary" [disabled]="selected().size === 0" (click)="download()">
            Download
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    /* Light dialog, matching the sidebar's "Demo traces" picker. */
    .export-overlay {
      position: fixed;
      inset: 0;
      z-index: 2000;
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(15, 23, 42, 0.45);
    }
    .export-card {
      width: 480px;
      max-width: 94vw;
      max-height: 80vh;
      display: flex;
      flex-direction: column;
      background: #fff;
      color: #1f2937;
      font-size: 0.8rem;
      border: 1px solid #d1d5db;
      border-radius: 10px;
      box-shadow: 0 20px 35px rgba(0, 0, 0, 0.25);
      overflow: hidden;
    }
    .export-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 14px 16px 10px;
      border-bottom: 1px solid #e5e7eb;
    }
    .export-header h3 {
      margin: 0;
      font-size: 1rem;
      font-weight: 600;
      color: #0f172a;
    }
    .close-btn {
      border: none;
      background: none;
      cursor: pointer;
      color: #6b7280;
      font-size: 1.3rem;
      line-height: 1;
      padding: 0 2px;
    }
    .close-btn:hover { color: #0f172a; }
    .export-body {
      display: flex;
      flex-direction: column;
      gap: 10px;
      padding: 12px 16px;
      min-height: 0;
      overflow-y: auto;
    }
    .section-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .section-label {
      font-size: 0.65rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: #6b7280;
    }
    .link-btn {
      border: none;
      background: none;
      padding: 0;
      font: inherit;
      font-size: 0.75rem;
      color: #3a506b;
      cursor: pointer;
    }
    .link-btn:hover { text-decoration: underline; }
    .search-list {
      display: flex;
      flex-direction: column;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      max-height: 280px;
      overflow-y: auto;
    }
    .search-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      cursor: pointer;
      border-bottom: 1px solid #f1f5f9;
    }
    .search-item:last-child { border-bottom: none; }
    .search-item:hover { background: #f8fafc; }
    .search-item input { margin: 0; flex-shrink: 0; }
    .search-name {
      flex: 1;
      min-width: 0;
      font-weight: 500;
      color: #0f172a;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .ai { color: #6366f1; margin-right: 4px; }
    .search-status {
      flex-shrink: 0;
      font-size: 0.72rem;
      color: #9ca3af;
      white-space: nowrap;
    }
    .option {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      cursor: pointer;
      font-weight: 500;
    }
    .option input { margin: 2px 0 0; flex-shrink: 0; }
    .hint {
      display: block;
      margin-top: 2px;
      font-weight: 400;
      font-size: 0.72rem;
      color: #6b7280;
    }
    .export-footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 10px 16px;
      border-top: 1px solid #e5e7eb;
      background: #f8fafc;
    }
    .btn {
      padding: 4px 12px;
      border: 1px solid #d1d5db;
      border-radius: 5px;
      background: #fff;
      color: #1f2937;
      font: inherit;
      font-size: 0.78rem;
      font-weight: 500;
      cursor: pointer;
    }
    .btn:hover:not(:disabled) { background: #f1f5f9; }
    .btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .btn.primary {
      background: #3a506b;
      border-color: #3a506b;
      color: #fff;
    }
    .btn.primary:hover:not(:disabled) { background: #2c3e54; }
  `],
})
export class ExportDialogComponent {
  readonly layersService = inject(AnalysisLayersService);
  private readonly workspace = inject(WorkspaceService);

  /** The marks searches ran on (every mark on the timeline). */
  marks = input<Mark[]>([]);

  readonly selected = signal<ReadonlySet<string>>(new Set());
  readonly includeResults = signal(false);

  /** Oldest first, as in the exported file. */
  readonly sortedLayers = computed(() =>
    [...this.layersService.layers()].sort((a, b) => a.createdAt - b.createdAt));
  readonly allSelected = computed(() =>
    this.sortedLayers().every(l => this.selected().has(l.id)));

  /** The examples on screen, with the ids the export uses for them. */
  private readonly exampleInfo = computed(() => {
    const examples: AnalysisResultsExample[] = [];
    const exampleIdByTrace = new Map<string, string>();
    const used = new Set<string>();
    for (const entry of this.workspace.selectedEntries()) {
      const origin = this.workspace.originOf(entry.id);
      const ds = origin ? this.workspace.dataset(origin.key) : undefined;
      const fallback = origin ? `${ds?.datasetId ?? origin.key}#${origin.index}` : entry.id;
      let id = entry.data?.sourceId || fallback;
      // Two datasets can hold the same trace id; keep ids unique.
      if (used.has(id)) id = fallback;
      used.add(id);
      exampleIdByTrace.set(entry.id, id);
      examples.push({
        id,
        title: entry.title,
        ...(ds ? { source: ds.sourceId, dataset: ds.datasetId } : {}),
        ...(origin ? { index: origin.index } : {}),
      });
    }
    return { examples, exampleIdByTrace };
  });
  readonly examples = computed(() => this.exampleInfo().examples);

  constructor() {
    // Every search starts checked each time the dialog opens (and only then:
    // layers update while their searches run).
    effect(() => {
      if (!this.layersService.exportDialogOpen()) return;
      untracked(() => this.selected.set(new Set(this.layersService.layers().map(l => l.id))));
    });
  }

  statusLabel(layer: AnalysisLayer): string {
    if (layer.loading) return 'searching…';
    if (!layer.enabled) return '';
    const traceOfNode = new Map(this.marks().map(m => [m.id, m.traceId]));
    const traces = new Set<string>();
    for (const nodeId of layer.results.keys()) {
      const t = traceOfNode.get(nodeId);
      if (t) traces.add(t);
    }
    return `${traces.size} of ${this.examples().length} matched`;
  }

  toggle(id: string): void {
    const next = new Set(this.selected());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.selected.set(next);
  }

  toggleAll(): void {
    this.selected.set(this.allSelected()
      ? new Set()
      : new Set(this.sortedLayers().map(l => l.id)));
  }

  close(): void {
    this.layersService.exportDialogOpen.set(false);
  }

  download(): void {
    const info = this.exampleInfo();
    this.layersService.downloadConfig({
      layerIds: this.selected(),
      ...(this.includeResults() ? {
        results: { examples: info.examples, exampleIdByTrace: info.exampleIdByTrace, marks: this.marks() },
      } : {}),
    });
    this.close();
  }

  trackById = (_: number, l: AnalysisLayer) => l.id;
}
