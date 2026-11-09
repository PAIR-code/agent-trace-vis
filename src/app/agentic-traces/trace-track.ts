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
 * @fileoverview One trace row on the timeline: its title, the channel lanes
 * with the backbone and marks, and the files lane underneath.
 *
 * Purely presentational. Positions come precomputed in `trace` (see layout.ts);
 * hover, selection and search state come in as inputs, and interactions go out
 * as outputs.
 */

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CHANNELS, COLLAPSED_TRACK, Channel, ChannelId, FILES_LANE, channelCenter, collapsedY, laneGeometry, usedChannels } from './channels';
import { AnnotationMode, CHAPTERS_STRIP_HEIGHT, TraceAnnotations, annotationBarHeight } from './chapters.service';
import { COLORS } from './colors';
import { FILE_ROW_HEIGHT, FileRow } from './file-lane';
import { TraceLayout } from './layout-types';
import { Mark } from './marks';

export interface PlacedChapter {
  id: string;
  label: string;
  summary: string;
  x: number;
  /** Actual horizontal duration of the turn(s) covered by this chapter/event. */
  durationWidth: number;
  /** Maximum width available for the label before the next item begins. */
  maxWidth: number;
  startMark: Mark;
  isActive: boolean;
  isEven: boolean;
  isSingleTurn: boolean;
}

@Component({
  selector: 'app-trace-track',
  standalone: true,
  templateUrl: './trace-track.html',
  styleUrls: ['./trace-track.css'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    // Palette from colors.ts, exposed to trace-track.css.
    '[style.--user-bg]': 'colors.USER_BG',
    '[style.--user-border]': 'colors.USER_BORDER',
    '[style.--tool-line]': 'colors.TOOL_LINE',
    '[style.--error]': 'colors.ERROR',
    '[style.--error-light]': 'colors.ERROR_LIGHT',
  },
})
export class TraceTrackComponent {
  trace = input.required<TraceLayout>();
  width = input.required<number>();
  hoveredId = input<string | null>(null);
  selectedId = input<string | null>(null);
  /** True while any search layer is enabled, even one with no matches. */
  searching = input(false);
  /** Colors of the enabled search layers that match each mark id. */
  searchColors = input<Map<string, string[]>>(new Map());
  filesExpanded = input(false);
  /**
   * Expanded: the channel lanes plus the files lane. Collapsed: one lane with
   * every mark and file marker stacked on a single center line.
   */
  expanded = input(true);

  /** Auto-annotated chapters and key events for this trace. */
  annotations = input<TraceAnnotations | undefined>(undefined);
  annotationMode = input<AnnotationMode>('chapters');
  annotationsLoading = input<boolean>(false);
  hasApiKey = input<boolean>(true);

  markSelect = output<Mark>();
  markHover = output<string | null>();
  toggleFiles = output<void>();
  toggleExpand = output<void>();
  requestApiKey = output<void>();

  readonly colors = COLORS;
  readonly channels = CHANNELS;
  readonly filesLane = FILES_LANE;
  readonly fileRowHeight = FILE_ROW_HEIGHT;
  readonly chaptersStripHeight = CHAPTERS_STRIP_HEIGHT;

  annotationHeight = computed(() => annotationBarHeight(this.annotationMode()));

  /** Left offset where this trace's timeline starts (subagents start at their branch x). */
  traceStartX = computed(() => {
    const parentX = this.trace().parent?.x;
    if (parentX !== undefined) return parentX;
    const drawn = this.trace().marks.filter(m => m.width > 0);
    return drawn.length > 0 ? Math.min(...drawn.map(m => m.x)) : 24;
  });

  /** Unified chapters & single-turn events mapped to the current X-axis coordinates. */
  placedChapters = computed<PlacedChapter[]>(() => {
    const raw = this.annotations()?.chapters ?? [];
    if (raw.length === 0) return [];
    const marks = this.trace().marks;
    const idxById = new Map(marks.map((m, i) => [m.id, i]));

    const resolved: Array<{
      label: string;
      summary: string;
      x0: number;
      x1: number;
      startMark: Mark;
      nodeIds: Set<string>;
      isSingleTurn: boolean;
    }> = [];

    for (const ch of raw) {
      const i0 = idxById.get(ch.startNodeId);
      const i1 = idxById.get(ch.endNodeId);
      if (i0 === undefined || i1 === undefined) continue;
      let lo = Math.min(i0, i1);
      let hi = Math.max(i0, i1);
      const isSingleTurn = marks[lo].stepRef === marks[hi].stepRef;

      // Expand `hi` to the end of its turn (`stepRef`) so a single-turn event
      // or a chapter ending on a step's first node gets the full duration of that turn.
      const endStep = marks[hi].stepRef;
      while (hi + 1 < marks.length && marks[hi + 1].stepRef === endStep) {
        hi++;
      }
      if (isSingleTurn) {
        const startStep = marks[lo].stepRef;
        while (lo > 0 && marks[lo - 1].stepRef === startStep) {
          lo--;
        }
      }

      const slice = marks.slice(lo, hi + 1).filter(m => m.width > 0);
      if (slice.length === 0) continue;
      const x0 = Math.min(...slice.map(m => m.x));
      const x1 = Math.max(...slice.map(m => m.x + (m.span ?? m.width)));
      resolved.push({
        label: ch.label,
        summary: ch.summary,
        x0,
        x1,
        startMark: slice[0],
        nodeIds: new Set(slice.map(m => m.id)),
        isSingleTurn,
      });
    }

    resolved.sort((a, b) => a.x0 - b.x0);

    const sel = this.selectedId();
    const hov = this.hoveredId();
    const maxRight = Math.max(200, this.width() - 68);
    const MIN_CHAPTER_GAP_PX = 75;

    // Filter out labels that start too close to the previously placed label so they never overlap.
    const visible: typeof resolved = [];
    for (const item of resolved) {
      if (visible.length === 0 || item.x0 - visible[visible.length - 1].x0 >= MIN_CHAPTER_GAP_PX) {
        visible.push(item);
      }
    }

    return visible.map((item, k) => {
      const left = item.x0;
      const nextLeft = k + 1 < visible.length ? visible[k + 1].x0 : maxRight;
      const maxWidth = Math.max(24, nextLeft - left - 6);
      const rawDuration = Math.max(6, item.x1 - left);
      const durationWidth = Math.min(maxWidth, rawDuration);

      return {
        id: `${item.startMark.id}_ch_${k}`,
        label: item.label,
        summary: item.summary,
        x: left,
        durationWidth,
        maxWidth,
        startMark: item.startMark,
        isActive: (!!sel && item.nodeIds.has(sel)) || (!!hov && item.nodeIds.has(hov)),
        isEven: k % 2 === 0,
        isSingleTurn: item.isSingleTurn,
      };
    });
  });

  /**
   * Only the channels this trace uses are drawn (see `usedChannels`). Marks are
   * laid out against the full channel set (marks.ts), so their y is shifted to
   * the trace's own lane centers here, the same way collapsing shifts them.
   */
  shownChannels = computed(() => usedChannels(this.trace().marks));
  geometry = computed(() => laneGeometry(this.shownChannels()));

  trackHeight = computed(() => this.expanded() ? this.geometry().height : COLLAPSED_TRACK.height);

  isShown(ch: Channel): boolean {
    return this.shownChannels().has(ch.id);
  }

  /**
   * What the artifacts channel holds in this row: messages to and from other
   * agents (see MESSAGE_SPEC in marks.ts), scratch-file writes, or both.
   */
  private artifactsContent = computed(() => {
    let messages = false, files = false;
    for (const m of this.trace().marks) {
      if (m.hidden || m.channel !== 'artifacts') continue;
      if (m.look.icon === 'message-send' || m.look.icon === 'message-receive') messages = true;
      else files = true;
    }
    return { messages, files };
  });

  laneLabel(ch: Channel): string {
    if (ch.id !== 'artifacts') return ch.label;
    const { messages, files } = this.artifactsContent();
    return messages && files ? 'messages / scratch files' : messages ? 'messages' : ch.label;
  }

  /** Center y of a channel in this trace's track (expanded). */
  laneCenter(id: ChannelId): number {
    return this.geometry().centers.get(id) ?? channelCenter(id);
  }

  /**
   * Lane heights animate between the two modes: collapsed, the agent lane is
   * the single lane and the others shrink to nothing. Unused lanes are 0 either way.
   */
  laneHeight(ch: Channel): number {
    if (this.expanded()) return this.isShown(ch) ? ch.height : 0;
    return ch.id === 'agent' ? COLLAPSED_TRACK.height : 0;
  }

  /** Files lane height: 0 when the row is collapsed, else by its own show-all state. */
  filesLaneHeight = computed(() => {
    if (!this.expanded()) return 0;
    return this.filesExpanded() ? Math.max(FILES_LANE.height, this.trace().files.totalHeight) : FILES_LANE.height;
  });

  /** The backbone is laid out on the agent line; shift it to where that line is drawn. */
  backboneTransform = computed(() => {
    const target = this.expanded() ? this.laneCenter('agent') : COLLAPSED_TRACK.center;
    const dy = target - channelCenter('agent');
    return dy === 0 ? 'none' : `translate(0, ${dy}px)`;
  });

  /** File markers draw at y=14 within their row group (see the files lane markup). */
  collapsedFilesTransform = `translate(0, ${COLLAPSED_TRACK.center - 14})`;

  markY(mark: Mark): number {
    if (!this.expanded()) return collapsedY(mark);
    return mark.y - channelCenter(mark.channel) + this.laneCenter(mark.channel);
  }

  /**
   * Search glow per matched mark: a box-shadow in each matching layer's color.
   * Avoid filter: drop-shadow here; it's far slower to paint across hundreds of marks.
   */
  glow = computed(() => {
    const glow = new Map<string, string>();
    for (const [id, colors] of this.searchColors()) {
      glow.set(id, colors.map(c => `0 0 12px 6px ${c}`).join(', '));
    }
    return glow;
  });

  /** First matching search-layer color for a mark, if any. */
  searchColor(id: string): string | undefined {
    return this.searchColors().get(id)?.[0];
  }

  isRowActive(row: FileRow): boolean {
    const h = this.hoveredId(), s = this.selectedId();
    return (!!h && row.nodeIds.has(h)) || (!!s && row.nodeIds.has(s));
  }

  /** True while searching if none of the row's markers match. */
  isRowDimmed(row: FileRow): boolean {
    if (!this.searching()) return false;
    const colors = this.searchColors();
    for (const id of row.nodeIds) if (colors.has(id)) return false;
    return true;
  }

  onSelect(mark: Mark | undefined, event: Event) {
    event.stopPropagation();
    if (mark) this.markSelect.emit(mark);
  }

  onToggleFiles(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    this.toggleFiles.emit();
  }

  onToggleExpand(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    this.toggleExpand.emit();
  }

  onRequestApiKey(event: Event) {
    event.stopPropagation();
    event.preventDefault();
    this.requestApiKey.emit();
  }
}
