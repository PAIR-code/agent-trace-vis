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
 * @fileoverview The divider between a side panel and the timeline. Drag it to
 * resize the panel; click it (or its chevron tab) to minimize or reopen it.
 * Used by both side panels so they behave the same.
 */

import { Component, OnDestroy, computed, input, output, signal } from '@angular/core';

/** Pointer travel, in px, before a press counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;

@Component({
  selector: 'app-panel-splitter',
  standalone: true,
  template: `
    <div class="splitter"
         [class.collapsed]="collapsed()"
         [class.pressed]="pressed()"
         [title]="title()"
         (mousedown)="onMouseDown($event)">
      <div class="line"></div>
      <div class="tab">
        <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
          <polyline [attr.points]="pointsLeft() ? '15 18 9 12 15 6' : '9 18 15 12 9 6'"></polyline>
        </svg>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: flex;
      flex: 0 0 auto;
      position: relative;
      z-index: 30;
    }
    /* Overlaps the panel edge by half its width, so the hit area is wider than the line. */
    .splitter {
      position: relative;
      width: 10px;
      margin: 0 -5px;
      height: 100%;
      cursor: col-resize;
      user-select: none;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .splitter.collapsed {
      margin: 0;
      cursor: pointer;
      background: #f8fafc;
    }
    .line {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 50%;
      width: 1px;
      transform: translateX(-50%);
      background: #e2e8f0;
      transition: background 0.15s ease, width 0.15s ease;
    }
    .tab {
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      width: 10px;
      height: 28px;
      border-radius: 3px;
      background: #e2e8f0;
      color: #64748b;
      cursor: pointer;
      transition: background 0.15s ease, color 0.15s ease;
    }
    /* Pressed: stays dark for the whole drag, even when the pointer outruns the splitter. */
    .splitter:hover .line, .splitter.pressed .line { background: #64748b; width: 2px; }
    .splitter:hover .tab, .splitter.pressed .tab { background: #475569; color: #ffffff; }
  `],
})
export class PanelSplitterComponent implements OnDestroy {
  /** Which side of the splitter the panel is on. */
  side = input.required<'left' | 'right'>();
  collapsed = input(false);
  width = input.required<number>();
  minWidth = input(200);
  maxWidth = input(1200);

  collapsedChange = output<boolean>();
  widthChange = output<number>();

  /** The chevron points the way the panel will move. */
  pointsLeft = computed(() => (this.side() === 'left') !== this.collapsed());
  title = computed(() => this.collapsed()
    ? 'Click to open'
    : 'Drag to resize · click to minimize');

  /** Between mousedown and mouseup on the splitter. */
  readonly pressed = signal(false);

  private onMove?: (e: MouseEvent) => void;
  private onUp?: (e: MouseEvent) => void;

  ngOnDestroy(): void {
    this.stopTracking();
  }

  onMouseDown(event: MouseEvent): void {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = this.width();
    const collapsed = this.collapsed();
    let dragging = false;
    this.pressed.set(true);

    this.onMove = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      if (!dragging) {
        if (collapsed || Math.abs(dx) < DRAG_THRESHOLD_PX) return;
        dragging = true;
        document.body.style.userSelect = 'none';
        document.body.style.cursor = 'col-resize';
      }
      const raw = this.side() === 'left' ? startWidth + dx : startWidth - dx;
      const max = Math.max(this.minWidth(), Math.min(this.maxWidth(), window.innerWidth - 300));
      this.widthChange.emit(Math.max(this.minWidth(), Math.min(max, raw)));
    };
    this.onUp = () => {
      this.stopTracking();
      if (!dragging) this.collapsedChange.emit(!collapsed);
    };
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
  }

  private stopTracking(): void {
    // Nothing to undo unless a press is being tracked (and no DOM to touch on the server).
    if (!this.onMove && !this.onUp) return;
    this.pressed.set(false);
    if (this.onMove) window.removeEventListener('mousemove', this.onMove);
    if (this.onUp) window.removeEventListener('mouseup', this.onUp);
    this.onMove = this.onUp = undefined;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }
}
