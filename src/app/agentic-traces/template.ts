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
 * @fileoverview Angular template for the agentic traces component.
 */

export const AGENTIC_TRACES_TEMPLATE = `
    <div class="selector-bar">
      <div class="selector-group">
        <label class="selector-label">Dataset</label>
        <select class="selector-dropdown" [ngModel]="selectedDatasetFile()" (ngModelChange)="onDatasetChange($event)">
          <option *ngFor="let ds of datasets()" [value]="ds.file">{{ ds.name }}</option>
          <option value="__import_hf_dataset__">➕ Import OpenTraces HF Dataset...</option>
        </select>
      </div>

      <div class="conv-selector-group" *ngIf="traces().length > 0">
        <label class="selector-label">Trace</label>
        <app-multi-select-dropdown
          [items]="traces()"
          [selectedIds]="selectedTraceIds()"
          [itemTypeName]="'trace'"
          (selectionChange)="onTraceSelectionChange($event)"
          (renameItem)="finishRenameTrace($event.id, $event.title)">
        </app-multi-select-dropdown>
      </div>

      <!-- Y Axis Toggle -->
      <div class="selector-group">
        <label class="selector-label">Y Axis</label>
        <div class="timeline-toggle">
          <button class="timeline-btn" [class.active]="yAxisMode() === 'default'" (click)="setYAxisMode('default')">Default</button>
          <button class="timeline-btn" [class.active]="yAxisMode() === 'time'" (click)="setYAxisMode('time')">Time</button>
          <button class="timeline-btn" [class.active]="yAxisMode() === 'tokens'" (click)="setYAxisMode('tokens')">Tokens</button>
        </div>
      </div>

      <!-- Hide Gaps Checkbox -->
      <div class="selector-group" *ngIf="yAxisMode() === 'time'">
        <label class="selector-label" style="display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.7); font-size: 0.7rem;">
          <input type="checkbox" [ngModel]="hideGaps()" (ngModelChange)="hideGaps.set($event); processTraces()" style="margin: 0;">
          Hide Gaps
        </label>
      </div>

      <!-- Token Options Dropdown -->
      <div class="selector-group" *ngIf="yAxisMode() === 'tokens'">
        <label class="selector-label">Metrics</label>
        <app-multi-select-dropdown
          [items]="tokenMetricItems()"
          [selectedIds]="selectedTokenTypes()"
          [itemTypeName]="'metric'"
          [allowRename]="false"
          [showSelectOnly]="true"
          (selectionChange)="onTokenMetricSelectionChange($event)">
        </app-multi-select-dropdown>
      </div>

      <!-- Layout Toggle -->
      <div class="selector-group">
        <label class="selector-label">Layout</label>
        <div class="timeline-toggle">
          <button class="timeline-btn" [class.active]="layoutMode() === 'column'" (click)="setLayoutMode('column')">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="1" y="0" width="3" height="12" rx="0.5"/><rect x="5" y="2" width="3" height="10" rx="0.5" opacity="0.6"/><rect x="9" y="1" width="3" height="11" rx="0.5" opacity="0.4"/></svg>
          </button>
          <button class="timeline-btn" [class.active]="layoutMode() === 'row'" (click)="setLayoutMode('row')">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="currentColor"><rect x="0" y="1" width="12" height="3" rx="0.5"/><rect x="2" y="5" width="10" height="3" rx="0.5" opacity="0.6"/><rect x="1" y="9" width="11" height="3" rx="0.5" opacity="0.4"/></svg>
          </button>
        </div>
      </div>



    </div>

    <!-- Analysis Toolbar (separate row below header) -->
    <app-analysis-toolbar [nodes]="nodes()"></app-analysis-toolbar>

    <div class="vis-page-container" *ngIf="!isLoading() && activeTrace(); else loading" (click)="onBackgroundClick($event)">
      <div class="main-layout">
        <div class="vis-container">
          <!-- No results banner -->
          <div class="no-results-banner" *ngIf="layersService.noResultsLayers().length > 0">
            No matches found for:
            <span class="no-results-layer-name" *ngFor="let l of layersService.noResultsLayers(); let last = last" [style.color]="l.color">
              "{{ l.name }}"{{ last ? '' : ', ' }}
            </span>
          </div>

          <!-- Legend -->
          <div class="legend-bar trace-legend" *ngIf="legendEntries().length > 0">
            <div class="legend-item" *ngFor="let entry of legendEntries()">
              <div class="legend-color" 
                   [style.background-color]="entry.color" 
                   [style.border]="entry.border ? entry.border : (entry.isDiamond ? '1.5px solid #c4c9d0' : ((entry.isAI || entry.color === '#ffffff') ? '1px solid #9ca3af' : 'none'))"
                   [style.border-radius]="entry.isDiamond ? '0' : '50%'"
                   [style.transform]="entry.isDiamond ? 'rotate(45deg)' : 'none'"></div>
              <span class="legend-label">
                <ng-container *ngIf="entry.subLabel; else simpleLabel">
                  <span class="legend-main-label">{{ entry.label }}</span>
                  <span class="legend-sub-label">{{ entry.subLabel }}</span>
                </ng-container>
                <ng-template #simpleLabel>{{ entry.label }}</ng-template>
              </span>
            </div>
          </div>

          <!-- Scrollable area for headers and SVG -->
          <div class="vis-scroll-area" (dragover)="onContainerDragOver($event)" (drop)="onTrackDrop($event)">
          <!-- Column mode headers (at top) -->
          <div class="col-headers" *ngIf="layoutMode() === 'column'" [style.width.px]="contentWidth()" [style.min-width.px]="contentWidth()">
            <ng-container *ngFor="let t of selectedTraces(); let i = index">
              <div class="trace-header"
                   draggable="true"
                   (dragstart)="onTrackDragStart($event, i)"
                   (dragover)="onContainerDragOver($event)"
                   (drop)="onTrackDrop($event)"
                   (dragend)="onTrackDragEnd($event)"
                   [style.left.px]="((yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0) + i * 160"
                   title="Drag track to reorder">
                <div class="drag-handle" title="Drag track to reorder">⠿</div>
                <div class="trace-title" [title]="t.title">{{ t.title }}</div>
                <div class="model-list">
                  <div class="model-item" *ngFor="let m of t.models">
                    <span class="model-name" [title]="m.name" [style.color]="m.color">{{ m.name }}</span>
                  </div>
                </div>
              </div>
              <div class="col-header" [style.left.px]="((yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0) + i * 160 + 23.33">U</div>
              <div class="col-header" [style.left.px]="((yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0) + i * 160 + 70">A</div>
              <div class="col-header" [style.left.px]="((yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0) + i * 160 + 116.66">T</div>
            </ng-container>
          </div>

          <div class="vis-content"
               (dragover)="onContainerDragOver($event)"
               (drop)="onTrackDrop($event)"
               [class.row-layout]="layoutMode() === 'row'"
               [style.width.px]="contentWidth()"
               [style.min-width.px]="contentWidth()"
               [style.height.px]="contentHeight()"
               [style.margin-left.px]="0">
            <!-- Time Axis (column mode: left side) -->
            <div class="time-axis" *ngIf="(yAxisMode() === 'time' || yAxisMode() === 'tokens') && layoutMode() === 'column'">
              <div class="time-tick" *ngFor="let tick of timeTicks()" [style.top.px]="tick.y">
                <span class="time-tick-label">{{ tick.label }}</span>
                <div class="time-tick-line"></div>
              </div>
              <div class="unit-bracket" *ngIf="hideGaps() && timeTicks().length > 1" 
                   [style.top.px]="timeTicks()[0].y" 
                   [style.height.px]="timeTicks()[1].y - timeTicks()[0].y" 
                   style="position: absolute; left: 50px; width: 5px; border: 1px solid #cbd5e1; border-right: none; pointer-events: none;">
                <span style="position: absolute; right: 8px; top: 50%; transform: translateY(-50%); font-size: 10px; color: #6b7280; font-weight: 600; white-space: nowrap;">
                  {{ timeUnitLabel() }}
                </span>
              </div>
            </div>

            <!-- Time Axis (row mode: top side) -->
            <div class="time-axis-horizontal" *ngIf="(yAxisMode() === 'time' || yAxisMode() === 'tokens') && layoutMode() === 'row'">
              <div class="time-tick-h" *ngFor="let tick of timeTicks()" [style.left.px]="tick.x">
                <div class="time-tick-line-h"></div>
                <span class="time-tick-label-h">{{ tick.label }}</span>
              </div>
            </div>

            <!-- Column Lanes (column mode) -->
            <div class="col-lanes" *ngIf="layoutMode() === 'column'" [style.height.px]="contentHeight()" [style.padding-left.px]="(yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0">
              <div class="drop-indicator-col"
                   *ngIf="draggedTrackIndex() !== null && dropIndex() !== null"
                   [style.left.px]="getColDropIndicatorLeft()">
              </div>
              <div class="trace-background"
                   *ngFor="let t of selectedTraces(); let i = index"
                   [class.is-dragging]="draggedTrackIndex() === i"
                   draggable="true"
                   (dragstart)="onTrackDragStart($event, i)"
                   (dragover)="onContainerDragOver($event)"
                   (drop)="onTrackDrop($event)"
                   (dragend)="onTrackDragEnd($event)"
                   title="Drag track to reorder">
                <div class="col-lane lane-user" [style.height.px]="t.maxTraceY"></div>
                <div class="col-lane lane-agent" [style.height.px]="t.maxTraceY"></div>
                <div class="col-lane lane-tools" [style.height.px]="t.maxTraceY"></div>

                <!-- Track SVG layer -->
                <svg class="track-lines-layer" [attr.width]="140" [attr.height]="contentHeight()" [class.layer-active]="layersService.anyLayerEnabled()">
                  <defs>
                    <linearGradient [attr.id]="'grad-' + sanitizeId(t.id)" x1="0" y1="0" x2="0" [attr.y2]="contentHeight()" gradientUnits="userSpaceOnUse">
                      <stop *ngFor="let stop of t.gradientStops" [attr.offset]="stop.offset" [attr.stop-color]="stop.color" />
                    </linearGradient>
                  </defs>
                  <!-- Thinking Area SVG Nodes -->
                  <g class="thinking-areas">
                    <path *ngFor="let area of t.thinkingAreaNodes; trackBy: trackByNodeId"
                          [attr.d]="area.path"
                          [attr.fill]="area.fill"
                          [attr.stroke]="area.stroke"
                          [attr.stroke-width]="area.strokeWidth"
                          [attr.opacity]="area.opacity" />
                  </g>
                  <!-- Agent Backbone Lines -->
                  <g class="backbone-lines">
                    <path *ngFor="let backbone of t.backboneLines; trackBy: trackByLineId"
                          [attr.d]="backbone.path"
                          [attr.stroke]="backbone.stroke"
                          [attr.stroke-width]="backbone.strokeWidth"
                          [attr.stroke-dasharray]="backbone.strokeDasharray || 'none'"
                          [attr.opacity]="backbone.opacity"
                          fill="none" />
                  </g>
                  <!-- Connection Lines -->
                  <g class="connection-lines">
                    <ng-container *ngFor="let node of t.nodes; trackBy: trackByNodeId">
                      <path *ngIf="node.connectionLine"
                            [attr.d]="node.connectionLine.path"
                            [attr.stroke]="node.connectionLine.stroke"
                            [attr.stroke-width]="(hoveredNodeId() === node.id) ? node.connectionLine.strokeWidth + 2 : node.connectionLine.strokeWidth"
                            [attr.opacity]="(hoveredNodeId() === node.id) ? 0.8 : node.connectionLine.opacity"
                            [attr.stroke-dasharray]="node.connectionLine.strokeDasharray || 'none'"
                            fill="none"
                            style="cursor: pointer;"
                            (click)="selectNode(node)"
                            (mouseenter)="hoveredNodeId.set(node.id)"
                            (mouseleave)="hoveredNodeId.set(null)" />
                      <path *ngIf="node.returnConnectionLine"
                            [attr.d]="node.returnConnectionLine.path"
                            [attr.stroke]="node.returnConnectionLine.stroke"
                            [attr.stroke-width]="(hoveredNodeId() === node.id) ? node.returnConnectionLine.strokeWidth + 2 : node.returnConnectionLine.strokeWidth"
                            [attr.opacity]="(hoveredNodeId() === node.id) ? 0.8 : node.returnConnectionLine.opacity"
                            [attr.stroke-dasharray]="node.returnConnectionLine.strokeDasharray || 'none'"
                            fill="none"
                            style="cursor: pointer;"
                            (click)="selectNode(node)"
                            (mouseenter)="hoveredNodeId.set(node.id)"
                            (mouseleave)="hoveredNodeId.set(null)" />
                    </ng-container>
                  </g>
                </svg>

                <!-- Track Nodes layer -->
                <div class="track-nodes-layer">
                  <ng-container *ngFor="let node of t.nodes; trackBy: trackByNodeId">
                    <div *ngIf="node.type !== 'thinking_area'"
                         class="vis-node"
                         [style.left.px]="node.x"
                         [style.top.px]="node.y"
                         [style.width.px]="node.width"
                         [style.height.px]="node.height"
                         [style.border-color]="getNodeBorderColor(node)"
                         [style.background-color]="node.color"
                         [ngClass]="[node.type, node.type === 'thinking' ? 'units-' + (node.units || 1) : '', getNodeVisualConfig(node).shape, getNodeVisualConfig(node).type]"
                         [class.is-waiting]="node.isWaiting"
                         [class.is-failed]="node.isFailed"
                         [class.hidden]="node.hidden"
                         [class.layer-match]="layersService.isNodeMatch(node.id)"
                         [class.layer-dim]="layersService.anyLayerEnabled() && !layersService.isNodeMatch(node.id)"
                         [style.box-shadow]="layersService.getNodeShadow(node.id)"
                         (click)="selectNode(node)"
                         (mouseenter)="hoveredNodeId.set(node.id)"
                         (mouseleave)="hoveredNodeId.set(null)"
                         [class.selected]="selectedNode()?.id === node.id"
                         [class.is-hovered]="hoveredNodeId() === node.id"
                         [title]="node.label">
                      <ng-container [ngSwitch]="getNodeVisualConfig(node).type">
                        <div *ngSwitchCase="'diff'" class="diff-content">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" />
                            <path d="M14 2v4c0 1.1.9 2 2 2h4L14 2z" fill="#94a3b8" />
                            <rect x="7" y="12" width="10" height="2" fill="#10b981" rx="0.5"/>
                            <rect x="7" y="16" width="7" height="2" fill="#ef4444" rx="0.5"/>
                          </svg>
                        </div>
                        <div *ngSwitchCase="'view'" class="view-content">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" />
                            <path d="M14 2v4c0 1.1.9 2 2 2h4L14 2z" fill="#94a3b8" />
                            <rect x="7" y="12" width="10" height="2" fill="#64748b" rx="0.5"/>
                            <rect x="7" y="16" width="7" height="2" fill="#64748b" rx="0.5"/>
                          </svg>
                        </div>
                        <div *ngSwitchCase="'search'" class="search-content">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" />
                            <path d="M14 2v4c0 1.1.9 2 2 2h4L14 2z" fill="#94a3b8" />
                            <rect x="7" y="14" width="10" height="3" fill="#f59e0b" rx="0.5"/>
                          </svg>
                        </div>
                        <div *ngSwitchCase="'command'" class="command-content">
                          {{ getNodeVisualConfig(node).content }}
                        </div>
                        <div *ngSwitchCase="'external-search'" class="external-search-content">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          </svg>
                        </div>
                      </ng-container>
                    </div>
                  </ng-container>
                </div>
              </div>
            </div>

            <!-- Row Lanes (row mode) -->
            <div class="row-lanes" *ngIf="layoutMode() === 'row'" [style.width.px]="contentWidth()" [style.padding-top.px]="((yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0) + 18">
              <div class="drop-indicator-row"
                   *ngIf="draggedTrackIndex() !== null && dropIndex() !== null"
                   [style.top.px]="getRowDropIndicatorTop()">
              </div>
              <div class="trace-background-row"
                   *ngFor="let t of selectedTraces(); let i = index"
                   [class.is-dragging]="draggedTrackIndex() === i"
                   draggable="true"
                   (dragstart)="onTrackDragStart($event, i)"
                   (dragover)="onContainerDragOver($event)"
                   (drop)="onTrackDrop($event)"
                   (dragend)="onTrackDragEnd($event)"
                   title="Drag track to reorder">
                <div class="row-lane lane-user" [style.width.px]="contentWidth()"></div>
                <div class="row-lane lane-agent" [style.width.px]="contentWidth()"></div>
                <div class="row-lane lane-tools" [style.width.px]="contentWidth()"></div>

                <!-- Track SVG layer -->
                <svg class="track-lines-layer" [attr.width]="contentWidth()" [attr.height]="140" [class.layer-active]="layersService.anyLayerEnabled()">
                  <defs>
                    <linearGradient [attr.id]="'grad-' + sanitizeId(t.id)" x1="0" y1="0" [attr.x2]="contentWidth()" y2="0" gradientUnits="userSpaceOnUse">
                      <stop *ngFor="let stop of t.gradientStops" [attr.offset]="stop.offset" [attr.stop-color]="stop.color" />
                    </linearGradient>
                  </defs>
                  <!-- Thinking Area SVG Nodes -->
                  <g class="thinking-areas">
                    <path *ngFor="let area of t.thinkingAreaNodes; trackBy: trackByNodeId"
                          [attr.d]="area.path"
                          [attr.fill]="area.fill"
                          [attr.stroke]="area.stroke"
                          [attr.stroke-width]="area.strokeWidth"
                          [attr.opacity]="area.opacity" />
                  </g>
                  <!-- Agent Backbone Lines -->
                  <g class="backbone-lines">
                    <path *ngFor="let backbone of t.backboneLines; trackBy: trackByLineId"
                          [attr.d]="backbone.path"
                          [attr.stroke]="backbone.stroke"
                          [attr.stroke-width]="backbone.strokeWidth"
                          [attr.stroke-dasharray]="backbone.strokeDasharray || 'none'"
                          [attr.opacity]="backbone.opacity"
                          fill="none" />
                  </g>
                  <!-- Connection Lines -->
                  <g class="connection-lines">
                    <ng-container *ngFor="let node of t.nodes; trackBy: trackByNodeId">
                      <path *ngIf="node.connectionLine"
                            [attr.d]="node.connectionLine.path"
                            [attr.stroke]="node.connectionLine.stroke"
                            [attr.stroke-width]="(hoveredNodeId() === node.id) ? node.connectionLine.strokeWidth + 2 : node.connectionLine.strokeWidth"
                            [attr.opacity]="(hoveredNodeId() === node.id) ? 0.8 : node.connectionLine.opacity"
                            [attr.stroke-dasharray]="node.connectionLine.strokeDasharray || 'none'"
                            fill="none"
                            style="cursor: pointer;"
                            (click)="selectNode(node)"
                            (mouseenter)="hoveredNodeId.set(node.id)"
                            (mouseleave)="hoveredNodeId.set(null)" />
                      <path *ngIf="node.returnConnectionLine"
                            [attr.d]="node.returnConnectionLine.path"
                            [attr.stroke]="node.returnConnectionLine.stroke"
                            [attr.stroke-width]="(hoveredNodeId() === node.id) ? node.returnConnectionLine.strokeWidth + 2 : node.returnConnectionLine.strokeWidth"
                            [attr.opacity]="(hoveredNodeId() === node.id) ? 0.8 : node.returnConnectionLine.opacity"
                            [attr.stroke-dasharray]="node.returnConnectionLine.strokeDasharray || 'none'"
                            fill="none"
                            style="cursor: pointer;"
                            (click)="selectNode(node)"
                            (mouseenter)="hoveredNodeId.set(node.id)"
                            (mouseleave)="hoveredNodeId.set(null)" />
                    </ng-container>
                  </g>
                </svg>

                <!-- Track Nodes layer -->
                <div class="track-nodes-layer">
                  <ng-container *ngFor="let node of t.nodes; trackBy: trackByNodeId">
                    <div *ngIf="node.type !== 'thinking_area'"
                         class="vis-node"
                         [style.left.px]="node.x"
                         [style.top.px]="node.y"
                         [style.width.px]="node.width"
                         [style.height.px]="node.height"
                         [style.border-color]="getNodeBorderColor(node)"
                         [style.background-color]="node.color"
                         [ngClass]="[node.type, node.type === 'thinking' ? 'units-' + (node.units || 1) : '', getNodeVisualConfig(node).shape, getNodeVisualConfig(node).type]"
                         [class.is-waiting]="node.isWaiting"
                         [class.is-failed]="node.isFailed"
                         [class.hidden]="node.hidden"
                         [class.layer-match]="layersService.isNodeMatch(node.id)"
                         [class.layer-dim]="layersService.anyLayerEnabled() && !layersService.isNodeMatch(node.id)"
                         [style.box-shadow]="layersService.getNodeShadow(node.id)"
                         (click)="selectNode(node)"
                         (mouseenter)="hoveredNodeId.set(node.id)"
                         (mouseleave)="hoveredNodeId.set(null)"
                         [class.selected]="selectedNode()?.id === node.id"
                         [class.is-hovered]="hoveredNodeId() === node.id"
                         [title]="node.label">
                      <ng-container [ngSwitch]="getNodeVisualConfig(node).type">
                        <div *ngSwitchCase="'diff'" class="diff-content">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" />
                            <path d="M14 2v4c0 1.1.9 2 2 2h4L14 2z" fill="#94a3b8" />
                            <rect x="7" y="12" width="10" height="2" fill="#10b981" rx="0.5"/>
                            <rect x="7" y="16" width="7" height="2" fill="#ef4444" rx="0.5"/>
                          </svg>
                        </div>
                        <div *ngSwitchCase="'view'" class="view-content">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" />
                            <path d="M14 2v4c0 1.1.9 2 2 2h4L14 2z" fill="#94a3b8" />
                            <rect x="7" y="12" width="10" height="2" fill="#64748b" rx="0.5"/>
                            <rect x="7" y="16" width="7" height="2" fill="#64748b" rx="0.5"/>
                          </svg>
                        </div>
                        <div *ngSwitchCase="'search'" class="search-content">
                          <svg viewBox="0 0 24 24" fill="currentColor">
                            <path d="M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6z" />
                            <path d="M14 2v4c0 1.1.9 2 2 2h4L14 2z" fill="#94a3b8" />
                            <rect x="7" y="14" width="10" height="3" fill="#f59e0b" rx="0.5"/>
                          </svg>
                        </div>
                        <div *ngSwitchCase="'command'" class="command-content">
                          {{ getNodeVisualConfig(node).content }}
                        </div>
                        <div *ngSwitchCase="'external-search'" class="external-search-content">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                          </svg>
                        </div>
                      </ng-container>
                    </div>
                  </ng-container>
                </div>
              </div>
            </div>

            <!-- Row mode: trace titles above each row + channel labels on first trace -->
            <ng-container *ngIf="layoutMode() === 'row'">
              <ng-container *ngFor="let t of selectedTraces(); let i = index">
                <div class="row-trace-title"
                     draggable="true"
                     (dragstart)="onTrackDragStart($event, i)"
                     (dragover)="onContainerDragOver($event)"
                     (drop)="onTrackDrop($event)"
                     (dragend)="onTrackDragEnd($event)"
                     [style.top.px]="((yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0) + i * 160 + 2"
                     title="Drag track to reorder">
                  <span class="drag-handle-h" title="Drag track to reorder">⠿</span>
                  <span class="row-trace-title-text" [title]="t.title">{{ t.title }}</span>
                </div>
                <ng-container *ngIf="i === 0">
                  <span class="row-channel-label" [style.top.px]="((yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0) + 18 + 4">user / agent conversation</span>
                  <span class="row-channel-label" [style.top.px]="((yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0) + 18 + 46.66 + 4">agent internal processes</span>
                  <span class="row-channel-label" [style.top.px]="((yAxisMode() === 'time' || yAxisMode() === 'tokens') ? 60 : 0) + 18 + 93.33 + 4">tools and external world</span>
                </ng-container>
              </ng-container>
            </ng-container>
          </div>
          </div>
        </div>

        <!-- Right: Conversation Panel -->
        <div class="panel-wrapper">
          <app-conversation-viewer
            [messages]="threadMessages()"
            [activeNodeId]="selectedNode()?.id"
            [hoveredNodeId]="hoveredNodeId()"
            [searchQuery]="layersService.anyLayerEnabled() ? ' ' : ''"
            [title]="'Trace Conversation'"
            [subtitle]="activeTraceStepsCount() + ' steps'"
            [getSpeakerLabel]="getSpeakerLabelForViewer"
            [getSpeakerColor]="getSpeakerColorForViewer"
            [getSpeakerBgColor]="getSpeakerBgColorForViewer"
            [getSpeakerBorder]="getSpeakerBorderForViewer"
            [getHighlightedText]="getHighlightedTextForViewer"
            [scrollBehavior]="'smooth'"
            (messageClick)="selectNodeById($event)"
            (messageHover)="hoveredNodeId.set($event)"
            (overlayClick)="null">
          </app-conversation-viewer>
        </div>
      </div>
    </div>



    <ng-template #loading>
      <div class="loading-container">
        <div class="loading-spinner" *ngIf="isLoading()"></div>
        <div class="loading-text" *ngIf="isLoading(); else noData">Loading dataset and traces...</div>
        <ng-template #noData>
          <div class="loading-text">No active trace selected or trace list is empty.</div>
        </ng-template>
      </div>
    </ng-template>

    <!-- Hugging Face Import Modal -->
    <app-hugging-face-import *ngIf="showImportModal()" (close)="closeImportModal()" (import)="onImportDataset($event)"></app-hugging-face-import>
`;
