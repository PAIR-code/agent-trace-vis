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
 * @fileoverview A playhead over one trace row, like in a video editor.
 *
 * Every row has one; only the active row's is shown. Pressing anywhere on a
 * row (the page calls `start()`) or on the playhead jumps it to the pointer
 * and scrubs until release. Over a mark, it selects that mark. In a gap
 * between marks, it selects nothing but points at the next mark, so the side
 * panel can scroll to it. The playhead stays where it's dropped until the
 * layout changes or a mark is selected some other way.
 */

import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Mark } from './marks';

/** What's under the playhead: a mark, or (in a gap) null and the next mark. */
export interface ScrubEvent {
  mark: Mark | null;
  next: Mark | null;
}

/**
 * The mark under the playhead at `x`, or null in a gap. `drawn` must be sorted
 * by x (ties in trace order).
 *
 * Scrubbing passes every mark in order: the marks that start at the same x
 * (e.g. a user turn, the model's reply and a harness message) share the span
 * up to the next mark's start in equal slots, in trace order. It's a gap where
 * nothing drawn so far still reaches.
 */
export function markAt(drawn: readonly Mark[], x: number): Mark | null {
  // The last marks to start at or before x, and how far any mark so far reaches.
  let last = -1;
  let reach = -Infinity;
  for (let i = 0; i < drawn.length && drawn[i].x <= x; i++) {
    last = i;
    reach = Math.max(reach, drawn[i].x + drawn[i].width);
  }
  if (last < 0 || x >= reach) return null;

  const x0 = drawn[last].x;
  const group = drawn.filter(m => m.x === x0);
  const end = Math.min(drawn[last + 1]?.x ?? Infinity, reach);
  const i = Math.floor((x - x0) / (end - x0) * group.length);
  return group[Math.min(group.length - 1, i)];
}

@Component({
  selector: 'app-scrub-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // The page ignores row presses inside `.scrub-bar` (the playhead starts its own drag).
    class: 'scrub-bar',
  },
  template: `
    @if (hoverX() !== null) {
      <div class="ghost" [style.left.px]="hoverX()"></div>
    }
    @if (visible()) {
      <div class="playhead" [style.left.px]="x()" (pointerdown)="start($event)">
        <div class="line"></div>
      </div>
    }
  `,
  styles: [`
    /* Spans the whole row: channel lanes and files lane. */
    :host {
      position: absolute;
      inset: 0;
      z-index: 30;
      pointer-events: none;
    }
    /* A wider, invisible hit area around the line, so it's easy to grab. */
    .playhead {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 11px;
      transform: translateX(-50%);
      display: flex;
      justify-content: center;
      pointer-events: auto;
      cursor: ew-resize;
      touch-action: none;
      user-select: none;
    }
    .line {
      width: 2px;
      background: #6b7280;
    }
    /* Hover preview: where a press would put the playhead. */
    .ghost {
      position: absolute;
      top: 0;
      bottom: 0;
      width: 1px;
      transform: translateX(-50%);
      background: #6b7280;
      opacity: 0.4;
    }
  `],
})
export class ScrubBarComponent {
  /** The row's marks. */
  marks = input.required<Mark[]>();
  selectedId = input<string | null>(null);
  /** Shows the playhead (only the active row's is shown). */
  visible = input(false);

  /** Emitted whenever what's under the playhead changes during a drag. */
  scrub = output<ScrubEvent>();

  private host = inject<ElementRef<HTMLElement>>(ElementRef);

  /** Drawn marks sorted by x (stable, so ties keep trace order). */
  private drawn = computed(() => this.marks().filter(m => m.width > 0).sort((a, b) => a.x - b.x));

  /** Where the playhead was dragged to; cleared when the layout changes. */
  private pos = linkedSignal<Mark[], number | null>({ source: this.marks, computation: () => null });
  /** The mark this scrubber last selected (null in a gap). */
  private scrubbedId = signal<string | null>(null);
  /** Identifies the last emitted event, so each change is emitted once. */
  private lastKey = '';
  /** Ends the current drag, if any. */
  private stopDrag?: () => void;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.stopDrag?.());
  }

  /** Where it was dropped, unless a mark was selected elsewhere since; then on that mark. */
  x = computed(() => {
    const pos = this.pos(), sel = this.selectedId();
    if (pos !== null && (sel === null || sel === this.scrubbedId())) return pos;
    return this.marks().find(m => m.id === sel)?.x ?? this.drawn()[0]?.x ?? 0;
  });

  /** Where a press would put the playhead (the ghost line), or null to hide it. */
  hoverX = signal<number | null>(null);

  /** Shows the ghost at the pointer; pass null to hide it. Hidden while a button is held (scrubbing). */
  hover(event: PointerEvent | null) {
    this.hoverX.set(event && !event.buttons ? this.toX(event.clientX) : null);
  }

  /** Jumps the playhead to the pointer and scrubs until the button is released. */
  start(event: PointerEvent) {
    if (event.button !== 0) return;
    event.preventDefault();  // no text selection while scrubbing
    this.stopDrag?.();
    this.hoverX.set(null);
    this.lastKey = '';
    this.moveTo(event.clientX);

    const move = (e: PointerEvent) => this.moveTo(e.clientX);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      this.stopDrag = undefined;
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
    this.stopDrag = stop;
  }

  /** Pointer x relative to the row, clamped to it. */
  private toX(clientX: number): number {
    const rect = this.host.nativeElement.getBoundingClientRect();
    return Math.max(0, Math.min(rect.width, clientX - rect.left));
  }

  private moveTo(clientX: number) {
    const x = this.toX(clientX);
    this.pos.set(x);

    const mark = markAt(this.drawn(), x);
    const next = mark ? null : this.drawn().find(m => m.x > x) ?? null;
    const key = mark ? mark.id : `gap:${next?.id}`;
    if (key === this.lastKey) return;
    this.lastKey = key;
    this.scrubbedId.set(mark?.id ?? null);
    this.scrub.emit({ mark, next });
  }
}
