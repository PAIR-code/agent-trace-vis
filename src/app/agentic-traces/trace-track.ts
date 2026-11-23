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
import { CHANNELS, COLLAPSED_TRACK, Channel, ChannelId, FILES_LANE, channelCenter, collapsedY, expandedY, laneGeometry, usedChannels } from './channels';
import { ANNOTATION_BAR_HEIGHT, CHAPTERS_STRIP_HEIGHT, TraceAnnotations } from './chapters.service';
import { COLORS } from './colors';
import { FILE_ROW_HEIGHT, FileRow } from './file-lane';
import type { TraceSearchReport } from './search-reports';
import { BASE_OFFSET, InlineSubagentBar, SUBAGENT_ROW_HEIGHT, TraceLayout, subagentLaneHeight } from './layout-types';
import { Mark } from './marks';
import { TOOL_ICONS } from './tools';

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

/** A search's verdict on a row: its own report, plus how many inline subagents it was found in. */
export interface RowSearchReport extends TraceSearchReport {
  subagentsFound?: number;
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
  annotationsLoading = input<boolean>(false);
  hasApiKey = input<boolean>(true);
  /** Tool marks show a glyph per kind of tool; off, every tool is a plain dot. */
  toolIcons = input(true);
  /** Enabled semantic searches' verdicts for this row (dots at the title's right end). */
  searchReports = input<RowSearchReport[]>([]);

  markSelect = output<Mark>();
  markHover = output<string | null>();
  toggleFiles = output<void>();
  toggleExpand = output<void>();
  requestApiKey = output<void>();
  /** Hovering a search dot: its report and where to show it (null on leave). */
  searchDotHover = output<{ report: RowSearchReport; x: number; y: number } | null>();
  /** Clicking a search dot: open this row's report for that search. */
  searchDotClick = output<string>();

  readonly colors = COLORS;
  readonly channels = CHANNELS;
  readonly filesLane = FILES_LANE;
  readonly fileRowHeight = FILE_ROW_HEIGHT;
  readonly chaptersStripHeight = CHAPTERS_STRIP_HEIGHT;

  readonly annotationHeight = ANNOTATION_BAR_HEIGHT;

  /** Left offset where this trace's timeline starts (subagents start at their branch x). */
  traceStartX = computed(() => {
    const parentX = this.trace().parent?.x;
    if (parentX !== undefined) return parentX;
    const drawn = this.trace().marks.filter(m => m.width > 0);
    return drawn.length > 0 ? Math.min(...drawn.map(m => m.x)) : BASE_OFFSET;
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
      // The first chapter has no divider, so its label lines up with the row's
      // left edge (like the title) instead of the axis origin BASE_OFFSET in.
      const left = k === 0 ? Math.max(0, item.x0 - BASE_OFFSET) : item.x0;
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

  onSearchDotEnter(report: RowSearchReport, event: MouseEvent): void {
    const r = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.searchDotHover.emit({ report, x: r.right, y: r.bottom });
  }

  onSearchDotClick(report: RowSearchReport, event: MouseEvent): void {
    event.stopPropagation();
    this.searchDotClick.emit(report.layerId);
  }

  /** Color of the first search found in this row with nothing to highlight; tints the title. */
  traceLevelColor = computed(() => this.searchReports().find(r => r.state === 'found' && r.traceLevel)?.color ?? null);

  searchDotTitle(r: RowSearchReport): string {
    return r.state === 'running' ? `${r.name}: searching…` : '';
  }

  // --- "Subagents inline" ------------------------------------------------------

  readonly subagentLaneHeight = subagentLaneHeight;
  readonly subagentBarHeight = SUBAGENT_ROW_HEIGHT - 2;

  /** Center y of a sub-row in the subagents lane. */
  subagentRowCenter(row: number): number {
    return 4 + row * SUBAGENT_ROW_HEIGHT + SUBAGENT_ROW_HEIGHT / 2;
  }

  /**
   * One vertical line per launch point, from the agent line (above the
   * subagents lane, so negative y) down to the lowest bar it launched. Each
   * bar then joins it with a short line to its right, so lines don't cross.
   */
  subagentTrunks = computed(() => {
    const sub = this.trace().subagents;
    if (!sub) return [];
    const top = -(this.geometry().height - this.laneCenter('agent'));
    const byX = new Map<number, { x: number; y1: number; y2: number; color: string }>();
    for (const bar of sub.bars) {
      const key = Math.round(bar.launchX);
      const y2 = this.subagentRowCenter(bar.row);
      const trunk = byX.get(key);
      if (trunk) trunk.y2 = Math.max(trunk.y2, y2);
      else byX.set(key, { x: bar.launchX, y1: top, y2, color: bar.color });
    }
    return [...byX.values()];
  });

  /**
   * Trace id of the inline subagent being hovered: hovering its bar or any of
   * its marks (e.g. its file edits) highlights both.
   */
  hoveredSubagent = computed(() => this.subagentOf(this.hoveredId()));

  private subagentOf(markId: string | null): string | null {
    const sub = this.trace().subagents;
    if (!markId || !sub) return null;
    const bar = sub.bars.find(b => b.mark && markId.startsWith(b.mark.traceId + '_'));
    return bar?.mark?.traceId ?? null;
  }

  /** Whether the selected mark belongs to this inline subagent. */
  isSubagentSelected(bar: InlineSubagentBar): boolean {
    return !!bar.mark && this.subagentOf(this.selectedId()) === bar.mark.traceId;
  }

  /** The mark's glyph, unless it is a tool glyph and tool icons are off. */
  iconOf(mark: Mark): string | undefined {
    const icon = mark.look.icon;
    return icon && !this.toolIcons() && TOOL_ICONS.has(icon) ? undefined : icon;
  }

  /** Expanded: centered on the mark's lane line. Collapsed: anchored to the shared line. */
  markY(mark: Mark): number {
    if (!this.expanded()) return collapsedY(mark);
    return expandedY(mark, this.laneCenter(mark.channel));
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
