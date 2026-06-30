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
 * @fileoverview Multi-select dropdown with toggle, select-only, and
 * long-press-to-rename support.
 */

import { Component, Input, Output, EventEmitter, HostListener, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';

export interface DropdownItem {
  id: string;
  title: string;
  date?: string;
  models?: { name: string, color: string }[];
}

@Component({
  selector: 'app-multi-select-dropdown',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="conv-dropdown-wrapper" (click)="$event.stopPropagation()">
      <button class="conv-dropdown-trigger" (click)="toggleDropdown($event)">
        <span class="dropdown-label-text">{{ getDropdownLabel() }}</span>
        <span class="dropdown-caret">▾</span>
      </button>
      <div class="conv-dropdown-menu" *ngIf="showDropdown" (click)="$event.stopPropagation()">
        <div class="conv-dropdown-item" *ngFor="let item of items"
             [class.is-selected]="isSelected(item.id)">
          <input *ngIf="editingId === item.id"
                 type="text"
                 class="conv-inline-input"
                 [ngModel]="item.title"
                 (ngModelChange)="onItemTitleChange(item, $event)"
                 (blur)="finishRename(item.id, item.title)"
                 (keydown.enter)="finishRename(item.id, item.title)"
                 (click)="$event.stopPropagation()"
                 autofocus />
          <div *ngIf="editingId !== item.id"
                class="conv-item-title"
                (mousedown)="onMouseDown(item.id, $event)"
                (mouseup)="onMouseUp(item.id, $event)">
            <div class="conv-item-main-title">{{ item.title }}</div>
            <div class="conv-item-subtitle">
              <span *ngIf="item.date" class="conv-item-date">{{ item.date }}</span>
              <div *ngIf="item.models" class="conv-item-models">
                <span *ngFor="let m of item.models" [style.color]="m.color">{{ m.name }}</span>
              </div>
            </div>
          </div>
          <div class="conv-item-actions">
            <button class="conv-btn-toggle"
                    (click)="onToggle(item.id)"
                    [class.is-checked]="isSelected(item.id)"
                    [title]="isSelected(item.id) ? 'Remove from view' : 'Add to view'">
              {{ isSelected(item.id) ? '✓' : '+' }}
            </button>
            <button class="conv-btn-only"
                    (click)="onSelectOnly(item.id)"
                    title="View only this item">
              only
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .conv-dropdown-wrapper {
      position: relative;
    }

    .conv-dropdown-trigger {
      padding: 4px 10px;
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 5px;
      font-size: 0.8rem;
      color: #fff;
      background: rgba(255,255,255,0.15);
      cursor: pointer;
      outline: none;
      max-width: 350px;
      display: flex;
      align-items: center;
      gap: 6px;
      white-space: nowrap;
    }

    .conv-dropdown-trigger:hover {
      background: rgba(255,255,255,0.25);
      border-color: rgba(255,255,255,0.5);
    }

    .dropdown-caret {
      font-size: 0.65rem;
      opacity: 0.7;
    }

    .dropdown-label-text {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      flex: 1;
      text-align: left;
    }

    .conv-dropdown-menu {
      position: absolute;
      top: calc(100% + 4px);
      left: 0;
      min-width: 320px;
      max-width: 450px;
      max-height: 360px;
      overflow-y: auto;
      background: #fff;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      box-shadow: 0 8px 24px rgba(0,0,0,0.15);
      z-index: 200;
      padding: 4px;
    }

    .conv-dropdown-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 10px;
      border-radius: 6px;
      transition: background 0.1s;
    }

    .conv-dropdown-item:hover {
      background: #f3f4f6;
    }

    .conv-dropdown-item.is-selected {
      background: #eff6ff;
    }

    .conv-item-title {
      flex: 1;
      display: flex;
      flex-direction: column;
      cursor: pointer;
      overflow: hidden;
    }

    .conv-item-main-title {
      font-size: 0.82rem;
      color: #374151;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .conv-item-subtitle {
      font-size: 0.7rem;
      color: #9ca3af;
      display: flex;
      gap: 8px;
      align-items: center;
      margin-top: 2px;
    }

    .conv-item-models {
      display: flex;
      gap: 4px;
      flex-wrap: wrap;
    }

    .conv-item-models span {
      font-weight: 600;
    }

    .conv-item-actions {
      display: flex;
      align-items: center;
      gap: 4px;
      flex-shrink: 0;
    }

    .conv-btn-toggle {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      border: 1px solid #d1d5db;
      background: #fff;
      color: #9ca3af;
      font-size: 0.85rem;
      font-weight: 600;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: all 0.15s;
    }

    .conv-btn-toggle:hover {
      border-color: #3b82f6;
      color: #3b82f6;
      background: #eff6ff;
    }

    .conv-btn-toggle.is-checked {
      background: #3b82f6;
      border-color: #3b82f6;
      color: #fff;
    }

    .conv-btn-toggle.is-checked:hover {
      background: #ef4444;
      border-color: #ef4444;
    }

    .conv-btn-only {
      padding: 2px 8px;
      border-radius: 6px;
      border: 1px solid #d1d5db;
      background: #fff;
      color: #9ca3af;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.03em;
      cursor: pointer;
      transition: all 0.15s;
    }

    .conv-btn-only:hover {
      border-color: #6b7280;
      color: #374151;
      background: #f9fafb;
    }

    .conv-inline-input {
      flex: 1;
      padding: 2px 6px;
      border: 1px solid #3b82f6;
      border-radius: 4px;
      font-size: 0.82rem;
      outline: none;
    }
  `]
})
export class MultiSelectDropdownComponent {
  @Input() items: DropdownItem[] = [];
  @Input() selectedIds: Set<string> = new Set();
  @Input() itemTypeName: string = 'item';

  @Output() selectionChange = new EventEmitter<Set<string>>();
  @Output() renameItem = new EventEmitter<{ id: string, title: string }>();

  showDropdown = false;
  editingId: string | null = null;
  private pressTimer: any = null;
  private longPressed = false;

  @HostListener('document:click')
  onDocumentClick() {
    this.showDropdown = false;
  }

  toggleDropdown(event: Event) {
    this.showDropdown = !this.showDropdown;
  }

  isSelected(id: string): boolean {
    return this.selectedIds.has(id);
  }

  getDropdownLabel(): string {
    const selectedCount = this.selectedIds.size;
    if (selectedCount === 0) return `Select ${this.itemTypeName}s`;
    if (selectedCount === 1) {
      const id = Array.from(this.selectedIds)[0];
      const item = this.items.find(i => i.id === id);
      return item ? item.title : `1 ${this.itemTypeName} selected`;
    }
    return `${selectedCount} ${this.itemTypeName}s selected`;
  }

  onToggle(id: string) {
    const newSelection = new Set(this.selectedIds);
    if (newSelection.has(id)) {
      newSelection.delete(id);
    } else {
      newSelection.add(id);
    }
    this.selectionChange.emit(newSelection);
  }

  onSelectOnly(id: string) {
    this.selectionChange.emit(new Set([id]));
  }

  onMouseDown(id: string, event: MouseEvent) {
    this.longPressed = false;
    this.pressTimer = setTimeout(() => {
      this.longPressed = true;
      this.editingId = id;
    }, 400);
  }

  onMouseUp(id: string, event: MouseEvent) {
    if (this.pressTimer) {
      clearTimeout(this.pressTimer);
    }
    if (!this.longPressed) {
      this.onSelectOnly(id);
    }
  }

  onItemTitleChange(item: DropdownItem, newTitle: string) {
    item.title = newTitle;
  }

  finishRename(id: string, newTitle: string) {
    this.editingId = null;
    if (newTitle && newTitle.trim()) {
      this.renameItem.emit({ id, title: newTitle.trim() });
    }
  }
}
