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
 * @fileoverview Search bar component with fuzzy/semantic mode toggle and
 * reference chip support.
 */

import { Component, Input, Output, EventEmitter, ViewChild, ElementRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ReferenceChip } from './search.service';

@Component({
  selector: 'app-search-bar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="search-bar" [class.has-focus]="searchFocused">
      <div class="search-mode-toggle">
        <button class="mode-btn" [class.active]="searchMode === 'fuzzy'" (click)="setSearchMode('fuzzy')" title="Keyword match">Text</button>
        <button class="mode-btn mode-ai" [class.active]="searchMode === 'semantic'" (click)="setSearchMode('semantic')" [disabled]="aiDisabled" title="AI semantic search">✦ AI</button>
      </div>
      <div class="search-chips-and-input">
        <span class="reference-chip" *ngFor="let chip of referenceChips; let i = index">
          {{ chip.label }}
          <button class="chip-remove" (click)="onRemoveChip(i)">×</button>
        </span>
        <input #searchInput
               class="search-input"
               type="text"
               [placeholder]="searchMode === 'semantic' ? 'Describe what to find...' : 'Search turns...'"
               [ngModel]="searchQuery"
               (ngModelChange)="onQueryChange($event)"
               (keydown.enter)="onExecute()"
               (focus)="onFocus(true)"
               (blur)="onFocus(false)">
      </div>
      <div class="search-loading" *ngIf="searchLoading">
        <div class="spinner"></div>
        <button class="search-cancel" *ngIf="showCancelButton" (click)="onCancel()" title="Cancel search">✕</button>
      </div>
      <button class="search-clear" *ngIf="!searchLoading && (searchQuery || referenceChips.length > 0)" (click)="onClear()">×</button>
    </div>
  `,
  styles: [`
    .search-bar {
      display: flex;
      align-items: center;
      gap: 8px;
      background: rgba(255,255,255,0.15);
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 8px;
      padding: 4px 10px;
      flex: 1;
      min-width: 150px;
      transition: all 0.2s;
    }

    .search-bar.has-focus {
      background: rgba(255,255,255,0.25);
      border-color: rgba(255,255,255,0.6);
      box-shadow: 0 0 0 2px rgba(255,255,255,0.1);
    }

    .search-mode-toggle {
      display: flex;
      background: rgba(0,0,0,0.2);
      border-radius: 5px;
      padding: 1px;
      flex-shrink: 0;
    }

    .mode-btn {
      background: none;
      border: none;
      color: rgba(255,255,255,0.5);
      font-size: 0.7rem;
      font-weight: 600;
      padding: 3px 8px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .mode-btn.active {
      background: rgba(255,255,255,0.25);
      color: #fff;
    }

    .mode-btn:disabled {
      opacity: 0.3;
      cursor: default;
    }

    .mode-ai.active {
      background: rgba(96,165,250,0.4);
      color: #fff;
    }

    .search-chips-and-input {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 4px;
      flex: 1;
      min-width: 0;
    }

    .search-input {
      background: transparent;
      border: none;
      outline: none;
      color: #fff;
      font-size: 0.8rem;
      flex: 1;
      min-width: 80px;
    }

    .search-input::placeholder {
      color: rgba(255,255,255,0.5);
    }

    .reference-chip {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      background: rgba(96, 165, 250, 0.35);
      color: #fff;
      font-size: 0.7rem;
      font-weight: 500;
      padding: 2px 8px;
      border-radius: 12px;
      white-space: nowrap;
      max-width: 160px;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .chip-remove {
      background: none;
      border: none;
      color: rgba(255,255,255,0.7);
      cursor: pointer;
      font-size: 0.85rem;
      padding: 0 2px;
      line-height: 1;
    }

    .chip-remove:hover {
      color: #fff;
    }

    .search-clear {
      background: none;
      border: none;
      color: rgba(255,255,255,0.6);
      cursor: pointer;
      font-size: 1rem;
      padding: 0 4px;
      line-height: 1;
      flex-shrink: 0;
    }

    .search-clear:hover {
      color: #fff;
    }

    .search-loading {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .spinner {
      width: 14px;
      height: 14px;
      border: 2px solid rgba(255,255,255,0.3);
      border-top-color: #fff;
      border-radius: 50%;
      animation: spin 0.6s linear infinite;
    }

    .search-cancel {
      background: none;
      border: none;
      color: rgba(255,255,255,0.6);
      font-size: 0.65rem;
      cursor: pointer;
      padding: 0 2px;
      margin-left: -2px;
    }

    .search-cancel:hover {
      color: #fff;
    }

    @keyframes spin { to { transform: rotate(360deg); } }
  `]
})
export class SearchBarComponent {
  @Input() searchMode: 'fuzzy' | 'semantic' = 'fuzzy';
  @Input() searchQuery: string = '';
  @Input() searchLoading: boolean = false;
  @Input() searchFocused: boolean = false;
  @Input() referenceChips: ReferenceChip[] = [];
  @Input() aiDisabled: boolean = false;
  @Input() showCancelButton: boolean = false;

  @Output() searchModeChange = new EventEmitter<'fuzzy' | 'semantic'>();
  @Output() searchQueryChange = new EventEmitter<string>();
  @Output() executeSearch = new EventEmitter<void>();
  @Output() clearSearch = new EventEmitter<void>();
  @Output() cancelSearch = new EventEmitter<void>();
  @Output() removeReferenceChip = new EventEmitter<number>();
  @Output() focusChange = new EventEmitter<boolean>();

  @ViewChild('searchInput') searchInput!: ElementRef<HTMLInputElement>;

  setSearchMode(mode: 'fuzzy' | 'semantic') {
    this.searchModeChange.emit(mode);
  }

  onQueryChange(query: string) {
    this.searchQueryChange.emit(query);
  }

  onExecute() {
    this.executeSearch.emit();
  }

  onClear() {
    this.clearSearch.emit();
  }

  onCancel() {
    this.cancelSearch.emit();
  }

  onRemoveChip(index: number) {
    this.removeReferenceChip.emit(index);
  }

  onFocus(focused: boolean) {
    this.focusChange.emit(focused);
  }

  focus() {
    this.searchInput.nativeElement.focus();
  }
}
