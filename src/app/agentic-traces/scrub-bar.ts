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
 * Drag it along the row. Over a mark, it selects that mark. In a gap between
 * marks, it selects nothing but points at the next mark, so the side panel can
 * scroll to it. The playhead stays where it's dropped until the layout changes
 * or a mark is selected some other way.
 */

import { ChangeDetectionStrategy, Component, ElementRef, computed, inject, input, linkedSignal, output, signal } from '@angular/core';
import { Mark } from './marks';

/** What's under the playhead: a mark, or (in a gap) null and the next mark. */
export interface ScrubEvent {
  mark: Mark | null;
  next: Mark | null;
}

/**
 * The mark covering `x`, or null in a gap. `drawn` must be sorted by x.
 * Where several marks cover `x`, the latest-starting wins. Marks that start at
 * the same x, like a step's thinking, tool calls and response, split their span
 * evenly, in trace order, so each one gets its turn.
 */
export function markAt(drawn: readonly Mark[], x: number): Mark | null {
  const covering = drawn.filter(m => m.x <= x && x < m.x + m.width);
  if (covering.length === 0) return null;

  const x0 = covering[covering.length - 1].x;
  const tied = covering.filter(m => m.x === x0);
  const nextStart = drawn.find(m => m.x > x0)?.x ?? Infinity;
  const end = Math.min(nextStart, Math.max(...tied.map(m => m.x + m.width)));
  const i = Math.floor((x - x0) / (end - x0) * tied.length);
  return tied[Math.min(tied.length - 1, Math.max(0, i))];
}

@Component({
  selector: 'app-scrub-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // The page treats `.scrub-bar` as interactive (no row drag, no track click).
    class: 'scrub-bar',
  },
  template: `
    <div class="playhead" [style.left.px]="x()"
         (pointerdown)="onDown($event)"
         (pointermove)="onMove($event)">
      <div class="line"></div>
    </div>
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
  `],
})
export class ScrubBarComponent {
  /** The row's marks. */
  marks = input.required<Mark[]>();
  selectedId = input<string | null>(null);

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

  /** Where it was dropped, unless a mark was selected elsewhere since; then on that mark. */
  x = computed(() => {
    const pos = this.pos(), sel = this.selectedId();
    if (pos !== null && (sel === null || sel === this.scrubbedId())) return pos;
    return this.marks().find(m => m.id === sel)?.x ?? this.drawn()[0]?.x ?? 0;
  });

  onDown(event: PointerEvent) {
    // Capture so the drag keeps tracking outside the handle.
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
    this.lastKey = '';
    this.onMove(event);
  }

  onMove(event: PointerEvent) {
    if (!(event.currentTarget as Element).hasPointerCapture(event.pointerId)) return;
    const rect = this.host.nativeElement.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
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
