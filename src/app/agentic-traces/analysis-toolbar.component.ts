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

import { Component, Input, ViewChild, ElementRef, AfterViewInit, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SearchBarComponent } from '../shared/search/search-bar.component';
import { AnalysisLayersService } from './analysis-layers.service';
import { AnalysisLayer } from './analysis-layers.types';
import { Mark } from './marks';

@Component({
  selector: 'app-analysis-toolbar',
  standalone: true,
  imports: [CommonModule, FormsModule, SearchBarComponent],
  templateUrl: './analysis-toolbar.component.html',
  styleUrls: ['./analysis-toolbar.component.css'],
})
export class AnalysisToolbarComponent implements AfterViewInit, AfterViewChecked {
  /** Every mark on the timeline: what search layers search. */
  @Input() marks: Mark[] = [];
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
    this.layersService.submitSearch(this.marks);
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
        this.layersService.toggleLayer(layer.id, this.marks);
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
      this.layersService.rerunLayer(this.editingLayer.id, this.marks);
    }

    this.editingLayer = null;
  }

  closePopover(): void {
    this.editingLayer = null;
  }


}
