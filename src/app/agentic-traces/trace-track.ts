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
 * @fileoverview One trace row on the timeline: its title, the channel lanes
 * with the backbone and marks, and the files lane underneath.
 *
 * Purely presentational. Positions come precomputed in `trace` (see layout.ts);
 * hover, selection and search state come in as inputs, and interactions go out
 * as outputs.
 */

import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { CHANNELS, FILES_LANE, TRACK_HEIGHT, channelCenter } from './channels';
import { COLORS } from './colors';
import { FILE_ROW_HEIGHT, FileRow } from './file-lane';
import { TraceLayout } from './layout-types';
import { Mark } from './marks';

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
  /** Show channel labels (only the first row does). */
  showLabels = input(false);
  hoveredId = input<string | null>(null);
  selectedId = input<string | null>(null);
  /** True while any search layer is enabled, even one with no matches. */
  searching = input(false);
  /** Colors of the enabled search layers that match each mark id. */
  searchColors = input<Map<string, string[]>>(new Map());
  filesExpanded = input(false);

  markSelect = output<Mark>();
  markHover = output<string | null>();
  toggleFiles = output<void>();

  readonly colors = COLORS;
  readonly channels = CHANNELS;
  readonly trackHeight = TRACK_HEIGHT;
  readonly channelCenter = channelCenter;
  readonly filesLane = FILES_LANE;
  readonly fileRowHeight = FILE_ROW_HEIGHT;

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
}
