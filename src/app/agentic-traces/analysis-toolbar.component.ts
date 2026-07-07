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
 * @fileoverview Toolbar component for Analysis Layers — provides search input,
 * layer chips, presets menu, and per-layer detail popover.
 */

import { Component, Input, HostListener, ViewChild, ElementRef, AfterViewInit, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SearchBarComponent } from '../shared/search/search-bar.component';
import { AnalysisLayersService } from './analysis-layers.service';
import { AnalysisLayer } from './analysis-layers.types';

@Component({
  selector: 'app-analysis-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchBarComponent],
  template: `
    <div class="analysis-toolbar">
      <!-- Search input (reuses shared SearchBarComponent) -->
      <app-search-bar
        [searchMode]="layersService.currentMode()"
        [searchQuery]="layersService.currentQuery()"
        [searchLoading]="false"
        [searchFocused]="layersService.searchFocused()"
        [aiDisabled]="!layersService.apiKey()"
        [referenceChips]="[]"
        (searchModeChange)="layersService.setSearchMode($event)"
        (searchQueryChange)="layersService.currentQuery.set($event)"
        (executeSearch)="onSubmitSearch()"
        (clearSearch)="layersService.currentQuery.set('')"
        (focusChange)="layersService.searchFocused.set($event)">
      </app-search-bar>

      <!-- Scrollable Layer Chips list -->
      <div class="chips-scroll-container">
        <button class="scroll-btn left" *ngIf="showLeftScroll" (click)="scrollChips(-200)" title="Scroll left">&#10094;</button>
        
        <div class="layer-chips" #chipsContainer (scroll)="onScroll()">
          <!-- Active and Preset search layers -->
          <div *ngFor="let layer of layersService.layers(); trackBy: trackByLayerId"
               class="layer-chip"
               [style.background]="layer.enabled ? layer.color : 'transparent'"
               [style.borderColor]="layer.color"
               [class.disabled]="!layer.enabled"
               [class.loading]="layer.loading"
               (click)="onChipClick($event, layer)">
            <span class="chip-ai-marker" *ngIf="layer.mode === 'semantic'">&#10022;</span>
            <span class="chip-label">{{ layer.name }}</span>
            <div class="chip-spinner" *ngIf="layer.loading"></div>
            <button class="chip-remove" (click)="onRemove($event, layer)" title="Remove layer">\u2715</button>
          </div>
        </div>
        
        <button class="scroll-btn right" *ngIf="showRightScroll" (click)="scrollChips(200)" title="Scroll right">&#10095;</button>
      </div>
    </div>

    <!-- Popover backdrop -->
    <div class="popover-backdrop" *ngIf="editingLayer" (click)="closePopover()"></div>

    <!-- Layer detail popover -->
    <div class="layer-popover" *ngIf="editingLayer"
         [style.left.px]="popoverX" [style.top.px]="popoverY">
      <div class="popover-section">
        <label class="popover-label">Name</label>
        <input type="text" class="popover-input"
               [(ngModel)]="editingName">
      </div>
      <div class="popover-section">
        <label class="popover-label">Query</label>
        <textarea class="popover-textarea"
                  [(ngModel)]="editingQuery"></textarea>
      </div>
      <div class="popover-section popover-row">
        <div>
          <label class="popover-label">Type</label>
          <span class="popover-type">{{ editingLayer.mode === 'semantic' ? '\u2726 AI semantic' : 'Text match' }}</span>
        </div>
        <div>
          <label class="popover-label">Color</label>
          <input type="color" class="popover-color"
                 [(ngModel)]="editingColor">
        </div>
      </div>
      <div class="popover-matches">
        Matches: {{ editingLayer.results.size }} nodes
      </div>
      <div class="popover-actions">
        <button class="popover-btn rerun" [disabled]="!hasChanges" (click)="onSave()">
          {{ queryChanged ? 'Save & rerun' : 'Save' }}
        </button>
        <button class="popover-btn cancel-edit" (click)="closePopover()">Cancel</button>
      </div>
    </div>
  `,
  styles: [`
    .analysis-toolbar {
      display: flex;
      align-items: center;
      gap: 16px;
      padding: 6px 24px;
      background: #3a506b;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
      position: relative;
    }

    ::ng-deep app-search-bar {
      width: 280px;
      flex-shrink: 0;
    }

    /* ─── Scrollable Chips Container ────────────────────────────── */

    .chips-scroll-container {
      display: flex;
      align-items: center;
      overflow: hidden;
      flex: 1;
      position: relative;
    }

    .layer-chips {
      display: flex;
      align-items: center;
      gap: 6px;
      overflow-x: hidden;
      scroll-behavior: smooth;
      flex: 1;
      padding: 0 32px; /* Buffer padding so chips don't start hidden under gradients */
    }

    .scroll-btn {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 44px;
      border: none;
      background: none;
      color: rgba(255, 255, 255, 0.6);
      display: flex;
      align-items: center;
      cursor: pointer;
      font-size: 0.85rem;
      transition: color 0.15s;
      user-select: none;
      z-index: 10;
    }

    .scroll-btn:hover {
      color: #fff;
    }

    .scroll-btn.left {
      left: 0;
      background: linear-gradient(to right, #3a506b 50%, rgba(58, 80, 107, 0));
      padding-left: 8px;
      justify-content: flex-start;
    }

    .scroll-btn.right {
      right: 0;
      background: linear-gradient(to left, #3a506b 50%, rgba(58, 80, 107, 0));
      padding-right: 8px;
      justify-content: flex-end;
    }

    .layer-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 6px 3px 8px;
      border-radius: 14px;
      border: 1.5px solid;
      color: #fff;
      font-size: 0.72rem;
      font-weight: 500;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
      user-select: none;
    }

    .layer-chip:hover {
      filter: brightness(1.15);
    }

    .layer-chip.disabled {
      opacity: 0.5;
      color: rgba(255, 255, 255, 0.7);
    }

    .layer-chip.loading {
      animation: layerPulse 1.5s ease-in-out infinite;
    }

    @keyframes layerPulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.6; }
    }

    .chip-ai-marker {
      font-size: 0.65rem;
      opacity: 0.85;
      margin-right: 1px;
    }

    .chip-label {
      max-width: 120px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .chip-spinner {
      width: 10px;
      height: 10px;
      border: 1.5px solid rgba(255, 255, 255, 0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: chipSpin 0.6s linear infinite;
    }

    .chip-toggle, .chip-remove {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.7);
      cursor: pointer;
      font-size: 0.7rem;
      padding: 0 2px;
      line-height: 1;
      transition: color 0.1s;
    }

    .chip-toggle:hover, .chip-remove:hover {
      color: #fff;
    }



    /* ─── Popover ──────────────────────────────────────────────── */

    .popover-backdrop {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      z-index: 199;
    }

    .layer-popover {
      position: fixed;
      background: #1e1e2e;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 10px;
      padding: 16px;
      z-index: 200;
      width: 320px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
    }

    .popover-section {
      margin-bottom: 12px;
    }

    .popover-label {
      display: block;
      font-size: 0.68rem;
      font-weight: 600;
      color: rgba(255, 255, 255, 0.5);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 4px;
    }

    .popover-input {
      width: 100%;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      color: #fff;
      font-size: 0.82rem;
      padding: 6px 8px;
      outline: none;
      box-sizing: border-box;
    }

    .popover-input:focus {
      border-color: rgba(255, 255, 255, 0.3);
    }

    .popover-textarea {
      width: 100%;
      min-height: 60px;
      background: rgba(255, 255, 255, 0.08);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 6px;
      color: #fff;
      font-size: 0.78rem;
      padding: 6px 8px;
      outline: none;
      resize: vertical;
      font-family: inherit;
      box-sizing: border-box;
    }

    .popover-textarea:focus {
      border-color: rgba(255, 255, 255, 0.3);
    }

    .popover-row {
      display: flex;
      gap: 16px;
      align-items: flex-start;
    }

    .popover-type {
      font-size: 0.78rem;
      color: rgba(255, 255, 255, 0.7);
    }

    .popover-color {
      width: 32px;
      height: 24px;
      border: none;
      border-radius: 4px;
      cursor: pointer;
      padding: 0;
      background: none;
    }

    .popover-matches {
      font-size: 0.72rem;
      color: rgba(255, 255, 255, 0.5);
      margin-bottom: 12px;
    }

    .popover-actions {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 8px;
    }

    .popover-query-actions {
      display: flex;
      gap: 6px;
    }

    .popover-btn {
      font-size: 0.72rem;
      font-weight: 500;
      padding: 5px 12px;
      border-radius: 6px;
      border: none;
      cursor: pointer;
      transition: all 0.15s;
    }

    .popover-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
      pointer-events: none;
    }

    .popover-btn.rerun {
      background: rgba(59, 130, 246, 0.3);
      color: #93c5fd;
    }

    .popover-btn.rerun:hover {
      background: rgba(59, 130, 246, 0.5);
    }

    .popover-btn.cancel-edit {
      background: rgba(255, 255, 255, 0.1);
      color: rgba(255, 255, 255, 0.7);
    }

    .popover-btn.cancel-edit:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .popover-btn.delete {
      background: rgba(239, 68, 68, 0.2);
      color: #fca5a5;
      margin-left: auto;
    }

    .popover-btn.delete:hover {
      background: rgba(239, 68, 68, 0.4);
    }

    @keyframes chipSpin { to { transform: rotate(360deg); } }
  `]
})
export class AnalysisToolbarComponent implements AfterViewInit, AfterViewChecked {
  @Input() nodes: any[] = [];
  @ViewChild('chipsContainer') chipsContainer!: ElementRef<HTMLDivElement>;

  showLeftScroll = false;
  showRightScroll = false;

  editingLayer: AnalysisLayer | null = null;
  editingName = '';
  editingColor = '';
  editingQuery = '';
  popoverX = 0;
  popoverY = 0;

  private clickTimeout: any = null;

  get queryChanged(): boolean {
    return !!this.editingLayer && this.editingQuery.trim() !== this.editingLayer.query;
  }

  get hasChanges(): boolean {
    if (!this.editingLayer) return false;
    return this.editingName.trim() !== this.editingLayer.name ||
           this.editingQuery.trim() !== this.editingLayer.query ||
           this.editingColor !== this.editingLayer.color;
  }

  constructor(public layersService: AnalysisLayersService) {}

  ngAfterViewInit(): void {
    this.updateScrollButtons();
  }

  ngAfterViewChecked(): void {
    this.updateScrollButtons();
  }

  onScroll(): void {
    this.updateScrollButtons();
  }

  scrollChips(offset: number): void {
    if (!this.chipsContainer) return;
    const el = this.chipsContainer.nativeElement;
    el.scrollBy({ left: offset, behavior: 'smooth' });
  }

  private updateScrollButtons(): void {
    if (!this.chipsContainer) return;
    const el = this.chipsContainer.nativeElement;
    const hasLeft = el.scrollLeft > 0;
    const hasRight = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;

    if (this.showLeftScroll !== hasLeft || this.showRightScroll !== hasRight) {
      setTimeout(() => {
        this.showLeftScroll = hasLeft;
        this.showRightScroll = hasRight;
      });
    }
  }

  trackByLayerId(_: number, layer: AnalysisLayer): string {
    return layer.id;
  }

  onSubmitSearch(): void {
    this.layersService.submitSearch(this.nodes);
  }

  onChipClick(event: MouseEvent, layer: AnalysisLayer): void {
    const target = event.target as HTMLElement;
    if (target.closest('.chip-remove')) return;

    if (this.clickTimeout) {
      clearTimeout(this.clickTimeout);
      this.clickTimeout = null;
      this.openEditPopover(event, layer);
    } else {
      this.clickTimeout = setTimeout(() => {
        this.clickTimeout = null;
        this.layersService.toggleLayer(layer.id, this.nodes);
      }, 250);
    }
  }

  private openEditPopover(event: MouseEvent, layer: AnalysisLayer): void {
    this.editingLayer = layer;
    this.editingName = layer.name;
    this.editingColor = layer.color;
    this.editingQuery = layer.query;

    const chip = event.currentTarget as HTMLElement;
    const rect = chip.getBoundingClientRect();
    this.popoverX = Math.min(rect.left, window.innerWidth - 340);
    this.popoverY = rect.bottom + 8;
  }

  onRemove(event: MouseEvent, layer: AnalysisLayer): void {
    event.stopPropagation();
    this.layersService.removeLayer(layer.id);
    if (this.editingLayer?.id === layer.id) {
      this.editingLayer = null;
    }
  }

  onSave(): void {
    if (!this.editingLayer) return;

    const name = this.editingName.trim();
    const color = this.editingColor;
    const query = this.editingQuery.trim();

    if (!name) return;

    const queryChanged = this.queryChanged;

    this.layersService.updateLayer(this.editingLayer.id, { name, color, query });

    if (queryChanged) {
      this.layersService.rerunLayer(this.editingLayer.id, this.nodes);
    }

    this.editingLayer = null;
  }

  closePopover(): void {
    this.editingLayer = null;
  }


}
