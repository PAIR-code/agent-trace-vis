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

    <!-- Summary Lane when collapsed: single lane containing data from ALL files -->
    <svg *ngIf="isFilesCollapsed(t.id)"
         class="file-gantt-svg file-gantt-summary-svg"
         [attr.width]="contentWidth()"
         [attr.height]="fileRowHeight"
         style="display:block; overflow: visible;">
      <g>
        <!-- All view event transparent dots on the summary line -->
        <circle
          *ngFor="let view of t.fileGanttData.summaryRow.views"
          [attr.cx]="view.x"
          cy="14"
          r="3"
          fill="#ffffff"
          stroke="#94a3b8"
          stroke-width="1.2"
          class="file-marker-clickable"
          (click)="selectFileNode(view.node, $event)"
          (mouseenter)="hoveredNodeId.set(view.node?.id)"
          (mouseleave)="hoveredNodeId.set(null)"
          [attr.title]="view.label" />

        <!-- All edit segments from all files on the summary line -->
        <ng-container *ngFor="let edit of t.fileGanttData.summaryRow.edits">
          <line
            [attr.x1]="edit.x"
            [attr.x2]="edit.x + edit.width"
            y1="14" y2="14"
            [attr.stroke]="edit.isPlan ? '#94a3b8' : '#334155'"
            stroke-width="2" />

          <rect
            [attr.x]="edit.x"
            y="14"
            [attr.width]="edit.width"
            [attr.height]="edit.barHeight"
            [attr.fill]="edit.isPlan ? '#94a3b8' : '#334155'"
            [attr.opacity]="edit.isPlan ? 0.75 : 0.85"
            rx="1.5"
            class="file-marker-clickable"
            (click)="selectFileNode(edit.node, $event)"
            (mouseenter)="hoveredNodeId.set(edit.node?.id)"
            (mouseleave)="hoveredNodeId.set(null)"
            [attr.title]="edit.label" />
        </ng-container>
      </g>
    </svg>

    <!-- Expanded View: one row per file -->
    <svg *ngIf="!isFilesCollapsed(t.id)"
         class="file-gantt-svg"
         [attr.width]="contentWidth()"
         [attr.height]="t.fileGanttData.totalHeight"
         style="display:block; overflow: visible;">

      <!-- One group per file row -->
      <g *ngFor="let row of t.fileGanttData.rows; let rowIndex = index"
         [attr.transform]="'translate(0,' + (rowIndex * fileRowHeight) + ')'">

        <!-- File label above the line (starts where the file is first accessed) -->
        <text
          [attr.x]="row.startX"
          y="10"
          text-anchor="start"
          font-size="9"
          font-weight="500"
          font-family="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace"
          fill="#334155"
          class="file-label-clickable"
          (click)="selectFileNode(row.edits[0]?.node || row.views[0]?.node, $event)"
          [attr.title]="row.filePath">{{ row.basename }}</text>

        <!-- Continuous dotted light gray track for the whole file lifespan -->
        <line
          [attr.x1]="row.startX"
          [attr.x2]="row.endX"
          y1="14" y2="14"
          stroke="#cbd5e1"
          stroke-width="1.5"
          stroke-dasharray="3,3" />

        <!-- View event transparent dots (just a border) on the dotted line -->
        <circle
          *ngFor="let view of row.views"
          [attr.cx]="view.x"
          cy="14"
          r="3"
          fill="#ffffff"
          stroke="#94a3b8"
          stroke-width="1.2"
          class="file-marker-clickable"
          (click)="selectFileNode(view.node, $event)"
          (mouseenter)="hoveredNodeId.set(view.node?.id)"
          (mouseleave)="hoveredNodeId.set(null)"
          [attr.title]="view.label" />

        <!-- Individual edit segments on top of the gray line -->
        <ng-container *ngFor="let edit of row.edits">
          <!-- Solid baseline segment under the edit -->
          <line
            [attr.x1]="edit.x"
            [attr.x2]="edit.x + edit.width"
            y1="14" y2="14"
            [attr.stroke]="row.isPlan ? '#94a3b8' : '#334155'"
            stroke-width="2" />

          <!-- Downward-hanging edit bar proportional in height to lines written -->
          <rect
            [attr.x]="edit.x"
            y="14"
            [attr.width]="edit.width"
            [attr.height]="edit.barHeight"
            [attr.fill]="row.isPlan ? '#94a3b8' : '#334155'"
            [attr.opacity]="row.isPlan ? 0.75 : 0.85"
            rx="1.5"
            class="file-marker-clickable"
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
  }

  .file-marker-clickable {
    cursor: pointer;
    pointer-events: auto !important;
    transition: filter 0.1s ease, stroke 0.1s ease;
  }

  .file-marker-clickable:hover {
    filter: brightness(1.25);
    stroke: #2563eb !important;
  }

  .file-label-clickable {
    cursor: pointer;
    pointer-events: auto !important;
    user-select: none;
    transition: fill 0.1s ease;
  }

  .file-label-clickable:hover {
    fill: #2563eb !important;
  }
`;
