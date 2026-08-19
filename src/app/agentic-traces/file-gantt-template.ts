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
 * @fileoverview Angular template fragment for the "files" sub-track.
 *
 * This is rendered below the existing 140px tools track in row layout mode.
 * Each file gets its own horizontal row. Bars hang downward from the row's
 * top baseline (joy-plot style), growing with cumulative content added and
 * shrinking as content is removed.
 *
 * View-only files are rendered at half opacity with a thin baseline bar.
 * All bars extend from first access to end-of-trace.
 *
 * Intended to be inlined into AGENTIC_TRACES_TEMPLATE inside the
 * `.trace-background-row` container, after the existing SVG/nodes layers.
 */

export const FILE_GANTT_TEMPLATE = `
  <!-- File Gantt Sub-Track (row layout only) -->
  <div class="file-gantt-container" *ngIf="layoutMode() === 'row' && t.fileGanttData && t.fileGanttData.rows.length > 0"
       [class.layer-dimmed]="layersService.anyLayerEnabled()"
       [style.width.px]="contentWidth()">

    <!-- Top-right Header: Lane Label + Toggle Button stacked vertically -->
    <div class="file-gantt-header">
      <div class="file-gantt-label-stack">
        <span class="file-gantt-lane-label" *ngIf="i === 0">files</span>
        <button class="file-gantt-toggle-btn"
                type="button"
                (click)="toggleTraceFiles(t.id, $event)"
                [title]="isFilesCollapsed(t.id) ? 'Show all files' : 'Hide files'">
          <span class="file-gantt-toggle-text">{{ isFilesCollapsed(t.id) ? 'show files (' + t.fileGanttData.rows.length + ')' : 'hide files' }}</span>
          <svg *ngIf="!isFilesCollapsed(t.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="18 15 12 9 6 15"></polyline>
          </svg>
          <svg *ngIf="isFilesCollapsed(t.id)" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
          </svg>
        </button>
      </div>
    </div>

    <!-- Unified File Gantt SVG (smoothly transitions between collapsed summary and expanded multi-row) -->
    <svg class="file-gantt-svg"
         [attr.width]="contentWidth()"
         [attr.height]="isFilesCollapsed(t.id) ? fileRowHeight : t.fileGanttData.totalHeight"
         style="display:block; overflow: visible;">

      <!-- Summary Baseline (shown when collapsed) -->
      <line
        class="file-summary-baseline"
        [attr.x1]="t.fileGanttData.summaryRow.startX"
        [attr.x2]="t.fileGanttData.summaryRow.endX"
        y1="14" y2="14"
        stroke="#cbd5e1"
        stroke-width="1.5"
        stroke-dasharray="3,3"
        [style.opacity]="isFilesCollapsed(t.id) ? 1 : 0" />

      <!-- One group per file row (slides vertically to 0 when collapsed) -->
      <g *ngFor="let row of t.fileGanttData.rows; let rowIndex = index; trackBy: trackByFileRow"
         class="file-row-group"
         [attr.transform]="'translate(0,' + (isFilesCollapsed(t.id) ? 0 : (rowIndex * fileRowHeight)) + ')'">

        <!-- File label above the line (fades out when collapsed) -->
        <text
          [attr.x]="row.startX"
          y="10"
          text-anchor="start"
          font-size="9"
          font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          [attr.fill]="isRowHoveredOrSelected(row) ? '#0f172a' : '#334155'"
          [attr.font-weight]="isRowHoveredOrSelected(row) ? '700' : '500'"
          class="file-label-clickable"
          [style.opacity]="isFilesCollapsed(t.id) ? 0 : 1"
          [style.pointer-events]="isFilesCollapsed(t.id) ? 'none' : 'auto'"
          (click)="selectFileNode(row.edits[0]?.node || row.views[0]?.node, $event)"
          [attr.title]="row.filePath">{{ row.basename }}</text>

        <!-- Continuous dotted light gray track for the whole file lifespan (fades out when collapsed) -->
        <line
          class="file-row-track-line"
          [attr.x1]="row.startX"
          [attr.x2]="row.endX"
          y1="14" y2="14"
          [attr.stroke]="isRowHoveredOrSelected(row) ? '#475569' : '#cbd5e1'"
          [attr.stroke-width]="isRowHoveredOrSelected(row) ? 2 : 1.5"
          stroke-dasharray="3,3"
          [style.opacity]="isFilesCollapsed(t.id) ? 0 : 1" />

        <!-- View/Grep event dots on the line -->
        <circle
          *ngFor="let view of row.views; trackBy: trackByFileView"
          [attr.cx]="view.x"
          cy="14"
          [attr.r]="isFileNodeSelected(view.node) ? 5 : (isFileNodeHovered(view.node) ? 4.5 : 3)"
          fill="#ffffff"
          [attr.stroke]="(isFileNodeSelected(view.node) || isFileNodeHovered(view.node)) ? '#0f172a' : (view.isSearch ? '#94a3b8' : '#334155')"
          [attr.stroke-width]="isFileNodeSelected(view.node) ? 3 : (isFileNodeHovered(view.node) ? 2.5 : (view.isSearch ? 1.2 : 1.5))"
          class="file-marker-clickable"
          [class.is-hovered]="isFileNodeHovered(view.node)"
          [class.selected]="isFileNodeSelected(view.node)"
          (click)="selectFileNode(view.node, $event)"
          (mouseenter)="hoveredNodeId.set(view.node?.id)"
          (mouseleave)="hoveredNodeId.set(null)"
          [attr.title]="view.label" />

        <!-- Individual edit segments on top of the line -->
        <ng-container *ngFor="let edit of row.edits; trackBy: trackByFileEdit">
          <!-- Solid baseline segment under the edit -->
          <line
            [attr.x1]="edit.x"
            [attr.x2]="edit.x + edit.width"
            y1="14" y2="14"
            [attr.stroke]="(isFileNodeSelected(edit.node) || isFileNodeHovered(edit.node)) ? '#0f172a' : (row.isPlan ? '#94a3b8' : '#334155')"
            [attr.stroke-width]="(isFileNodeSelected(edit.node) || isFileNodeHovered(edit.node)) ? 3 : 2" />

          <!-- Downward-hanging edit bar proportional in height to lines written -->
          <rect
            [attr.x]="edit.x"
            y="14"
            [attr.width]="edit.width"
            [attr.height]="edit.barHeight"
            [attr.fill]="(isFileNodeSelected(edit.node) || isFileNodeHovered(edit.node)) ? '#0f172a' : (row.isPlan ? '#94a3b8' : '#334155')"
            [attr.opacity]="(isFileNodeSelected(edit.node) || isFileNodeHovered(edit.node)) ? 1 : (row.isPlan ? 0.75 : 0.85)"
            rx="1.5"
            class="file-marker-clickable"
            [class.is-hovered]="isFileNodeHovered(edit.node)"
            [class.selected]="isFileNodeSelected(edit.node)"
            (click)="selectFileNode(edit.node, $event)"
            (mouseenter)="hoveredNodeId.set(edit.node?.id)"
            (mouseleave)="hoveredNodeId.set(null)"
            [attr.title]="edit.label" />
        </ng-container>

      </g>
    </svg>
  </div>
`;

/** CSS styles for the file gantt sub-track. Added to AGENTIC_TRACES_STYLES. */
export const FILE_GANTT_STYLES = `
  /* File Gantt Sub-Track — child inside .trace-background-row */
  .file-gantt-container {
    position: relative;
    display: block;
    overflow: visible;
    flex-shrink: 0;
    pointer-events: auto !important; /* Enable clicks since .row-lanes has pointer-events: none */
    box-sizing: border-box;
    padding-top: 4px;
    padding-bottom: 8px;
    border-top: none;
    background: #ffffff;
    z-index: 10;
    transition: filter 0.3s ease, opacity 0.3s ease;
  }

  .file-gantt-container.layer-dimmed {
    opacity: .3;
    filter: grayscale(1);
  }

  .file-gantt-header {
    display: flex;
    justify-content: flex-end;
    align-items: flex-start;
    padding: 0 8px;
    height: auto;
    margin-bottom: 2px;
    pointer-events: auto !important;
  }

  .file-gantt-label-stack {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 1px;
  }

  .file-gantt-lane-label {
    font-size: 0.55rem;
    font-weight: 500;
    color: #94a3b8;
    letter-spacing: 0.02em;
    pointer-events: none;
    white-space: nowrap;
    text-align: right;
    line-height: 1.1;
  }

  .file-gantt-toggle-btn {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 4px;
    padding: 1px 4px;
    font-size: 0.6rem;
    font-weight: 600;
    color: #64748b;
    cursor: pointer;
    transition: all 0.15s ease;
    user-select: none;
    pointer-events: auto !important;
  }

  .file-gantt-toggle-btn:hover {
    background: #e2e8f0;
    color: #0f172a;
    border-color: #cbd5e1;
  }

  .file-gantt-toggle-text {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.55rem;
  }

  .file-gantt-svg {
    display: block;
    overflow: visible;
    pointer-events: auto !important;
    transition: height 0.3s ease;
  }

  .file-gantt-svg g.file-row-group {
    transition: transform 0.3s ease;
  }

  .file-gantt-svg circle {
    transition: cx 0.3s ease, cy 0.3s ease, r 0.15s ease, stroke 0.15s ease, fill 0.15s ease, stroke-width 0.15s ease;
  }

  .file-gantt-svg rect {
    transition: x 0.3s ease, y 0.3s ease, width 0.3s ease, height 0.3s ease, fill 0.15s ease, opacity 0.15s ease;
  }

  .file-gantt-svg line {
    transition: x1 0.3s ease, x2 0.3s ease, y1 0.3s ease, y2 0.3s ease, opacity 0.3s ease, stroke 0.15s ease, stroke-width 0.15s ease;
  }

  .file-gantt-svg text {
    transition: x 0.3s ease, y 0.3s ease, opacity 0.3s ease, fill 0.15s ease, font-weight 0.15s ease;
  }

  .file-marker-clickable {
    cursor: pointer;
    pointer-events: auto !important;
  }

  .file-marker-clickable:hover,
  .file-marker-clickable.is-hovered {
    stroke: #0f172a !important;
  }

  .file-marker-clickable.selected {
    stroke: #0f172a !important;
  }

  .file-label-clickable {
    cursor: pointer;
    pointer-events: auto !important;
    user-select: none;
  }

  .file-label-clickable:hover {
    fill: #0f172a !important;
    font-weight: 700;
  }
`;
