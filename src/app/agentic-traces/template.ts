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

import { FILE_GANTT_TEMPLATE } from './file-gantt-template';

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

      <!-- Stretch Checkbox -->
      <div class="selector-group">
        <label class="selector-label" style="display: flex; align-items: center; gap: 4px; color: rgba(255,255,255,0.7); font-size: 0.7rem;">
          <input type="checkbox" [ngModel]="stretch()" (ngModelChange)="stretch.set($event); processTraces()" style="margin: 0;">
          Fill space
        </label>
      </div>

      <!-- Token Options Dropdown -->
      <div class="selector-group">
        <label class="selector-label">Tokens</label>
        <app-multi-select-dropdown
          [items]="tokenMetricItems()"
          [selectedIds]="selectedTokenTypes()"
          [itemTypeName]="'token'"
          [allowRename]="false"
          [showSelectOnly]="true"
          (selectionChange)="onTokenMetricSelectionChange($event)">
        </app-multi-select-dropdown>
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
          <div class="legend-bar trace-legend" 
               *ngIf="legendEntries().length > 0"
               [class.collapsed]="isLegendCollapsed()"
               (click)="$event.stopPropagation()">
            <div class="legend-header" (click)="toggleLegend($event)" [title]="isLegendCollapsed() ? 'Expand legend' : 'Minimize legend'">
              <span class="legend-title">Legend</span>
              <button class="legend-toggle-btn" 
                      type="button" 
                      (click)="toggleLegend($event)" 
                      [title]="isLegendCollapsed() ? 'Expand legend' : 'Minimize legend'">
                <svg *ngIf="!isLegendCollapsed()" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="6 9 12 15 18 9"></polyline>
                </svg>
                <svg *ngIf="isLegendCollapsed()" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="18 15 12 9 6 15"></polyline>
                </svg>
              </button>
            </div>
            <div class="legend-items-list" *ngIf="!isLegendCollapsed()">
              <div class="legend-item" *ngFor="let entry of legendEntries()">
                <div class="legend-color" 
                     [style.background-color]="entry.color" 
                     [style.border]="entry.border ? entry.border : (entry.isDiamond ? ('1.5px solid ' + (selectedTraces()[0]?.agentColor || '#d97706')) : ((entry.isAI || entry.color === '#ffffff') ? '1px solid #9ca3af' : 'none'))"
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
          </div>

          <!-- Scrollable area for headers and SVG -->
          <div class="vis-scroll-area" #visScrollArea (dragover)="onContainerDragOver($event)" (drop)="onTrackDrop($event)">
          <div class="vis-content"
               (dragover)="onContainerDragOver($event)"
               (drop)="onTrackDrop($event)"
               [style.width.px]="contentWidth()"
               [style.min-width.px]="contentWidth()"
               [style.height.px]="contentHeight()"
               [style.margin-left.px]="0">
            <!-- Time Axis -->
            <div class="time-axis-horizontal" *ngIf="!stretch()">
              <div class="time-tick-h" *ngFor="let tick of timeTicks()" [style.left.px]="tick.x">
                <div class="time-tick-line-h"></div>
                <span class="time-tick-label-h">{{ tick.label }}</span>
              </div>
            </div>

            <!-- Row Lanes -->
            <div class="row-lanes" [style.width.px]="contentWidth()" [style.padding-top.px]="60 + 18">
              <div class="drop-indicator-row"
                   *ngIf="draggedTrackIndex() !== null && dropIndex() !== null"
                   [style.top.px]="getRowDropIndicatorTop()">
              </div>
              <div *ngFor="let t of selectedTraces(); let i = index"
                   class="trace-background-row"
                   [class.is-dragging]="draggedTrackIndex() === i"
                   [class.is-active]="activeTraceId() === t.id"
                   draggable="true"
                   (mousedown)="onMouseDown($event)"
                   (click)="selectTrack(t.id, $event)"
                   (dragstart)="onTrackDragStart($event, i)"
                   (dragover)="onContainerDragOver($event)"
                   (drop)="onTrackDrop($event)"
                   (dragend)="onTrackDragEnd($event)"
                   title="Drag track to reorder">
                <div class="row-trace-title">
                  <span class="row-trace-title-text" [title]="t.title">{{ t.title }}</span>
                </div>

                <div class="row-main-track" [style.width.px]="contentWidth()">
                  <!-- Base track layer: lanes, lines, and base nodes (dimmed & grayscaled when search active) -->
                  <div class="track-base-layer" [class.layer-dimmed]="layersService.anyLayerEnabled()">
                    <div class="row-lane lane-user" [style.width.px]="contentWidth()"></div>
                    <div class="row-lane lane-agent" [style.width.px]="contentWidth()"></div>
                    <div class="row-lane lane-tools" [style.width.px]="contentWidth()"></div>

                    <!-- Track SVG layer -->
                    <svg class="track-lines-layer" [attr.width]="contentWidth()" [attr.height]="140"
                         draggable="false"
                         (dragstart)="$event.stopPropagation(); $event.preventDefault()">
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
                      <!-- Thinking Area SVG Nodes -->
                      <g class="thinking-areas">
                        <path *ngFor="let area of t.thinkingAreaNodes; trackBy: trackByNodeId"
                              class="thinking-area-path"
                              [attr.d]="area.path"
                              [attr.fill]="area.fill"
                              [attr.stroke]="area.stroke"
                              [attr.stroke-width]="area.strokeWidth"
                              [attr.opacity]="(isThinkingAreaHovered(area) || isThinkingAreaSelected(area)) ? 1 : (area.opacity || 0.65)"
                              [class.is-hovered]="isThinkingAreaHovered(area)"
                              [class.selected]="isThinkingAreaSelected(area)"
                              draggable="false"
                              (dragstart)="$event.preventDefault(); $event.stopPropagation()"
                              (click)="selectNode(area, $event)"
                              (mouseenter)="hoveredNodeId.set(area.id)"
                              (mouseleave)="hoveredNodeId.set(null)"
                              [title]="'Thinking process'" />
                      </g>
                    </svg>

                    <!-- Track Nodes layer -->
                    <div class="track-nodes-layer"
                         draggable="false"
                         (dragstart)="$event.stopPropagation(); $event.preventDefault()">
                      <ng-container *ngFor="let node of t.nodes; trackBy: trackByNodeId">
                        <ng-container *ngTemplateOutlet="visNodeTemplate; context: { node: node, isHighlight: false }"></ng-container>
                      </ng-container>
                    </div>
                  </div>

                  <!-- Highlight layer for matching nodes (rendered in full color & opacity on top) -->
                  <div class="track-highlight-layer" *ngIf="layersService.anyLayerEnabled()"
                       draggable="false"
                       (dragstart)="$event.stopPropagation(); $event.preventDefault()">
                    <ng-container *ngFor="let node of t.nodes; trackBy: trackByNodeId">
                      <ng-container *ngIf="layersService.isNodeMatch(node.id)">
                        <ng-container *ngTemplateOutlet="visNodeTemplate; context: { node: node, isHighlight: true }"></ng-container>
                      </ng-container>
                    </ng-container>
                  </div>
                </div>

` + FILE_GANTT_TEMPLATE + `
              </div>
            </div>

            <!-- Channel labels on first trace -->
            <ng-container *ngIf="selectedTraces().length > 0">
              <span class="row-channel-label" [style.top.px]="60 + 18 + 23.33">user / agent conversation</span>
              <span class="row-channel-label" [style.top.px]="60 + 18 + 46.66 + 23.33">agent internal processes</span>
              <span class="row-channel-label" [style.top.px]="60 + 18 + 93.33 + 23.33">tools</span>
            </ng-container>
          </div>
          </div>
        </div>

        <!-- Resizer handle -->
        <div class="sidebar-resizer"
             (mousedown)="onSidebarResizeStart($event)"
             title="Drag to resize sidebar">
          <div class="resizer-handle-line"></div>
        </div>

        <!-- Right: Conversation Panel -->
        <div class="panel-wrapper" [style.width.px]="sidebarWidth()" [style.flex]="'0 0 ' + sidebarWidth() + 'px'">
          <app-conversation-viewer
            [messages]="threadMessages()"
            [showJumpButtons]="true"
            [activeNodeId]="selectedNode()?.id"
            [hoveredNodeId]="hoveredNodeId()"
            [searchQuery]="layersService.anyLayerEnabled() ? ' ' : ''"
            [title]="activeTraceTitle() ? 'Trace: ' + activeTraceTitle() : 'Trace Conversation'"
            [subtitle]="activeTraceStepsCount() + ' steps'"
            [getSpeakerLabel]="getSpeakerLabelForViewer"
            [getSpeakerColor]="getSpeakerColorForViewer"
            [getSpeakerBgColor]="getSpeakerBgColorForViewer"
            [getSpeakerBorder]="getSpeakerBorderForViewer"
            [getHighlightedText]="getHighlightedTextForViewer"
            [scrollBehavior]="'smooth'"
            (messageClick)="selectNodeById($event)"
            (messageHover)="hoveredNodeId.set($event)"
            (jumpToStart)="onJumpToStart()"
            (jumpToEnd)="onJumpToEnd()"
            (overlayClick)="null">
          </app-conversation-viewer>
        </div>
      </div>
    </div>



    <!-- Reusable Vis Node Template -->
    <ng-template #visNodeTemplate let-node="node" let-isHighlight="isHighlight">
      <div *ngIf="node.type !== 'thinking_area' && !node.hidden"
           class="vis-node"
           [style.left.px]="node.x"
           [style.top.px]="node.y"
           [style.width.px]="node.width"
           [style.height.px]="node.height"
           [style.border-color]="getNodeBorderColor(node)"
           [style.background-color]="node.color"
           [ngClass]="[node.type, getNodeVisualConfig(node).shape, getNodeVisualConfig(node).type]"
           [class.is-failed]="node.isFailed"
           [class.hidden]="node.hidden"
           [class.layer-match]="isHighlight"
           [style.box-shadow]="isHighlight ? layersService.getNodeShadow(node.id) : 'none'"
           draggable="false"
           (dragstart)="$event.preventDefault(); $event.stopPropagation()"
           (click)="selectNode(node, $event)"
           (mouseenter)="hoveredNodeId.set(node.id)"
           (mouseleave)="hoveredNodeId.set(null)"
           [class.selected]="selectedNode()?.id === node.id"
           [class.is-hovered]="hoveredNodeId() === node.id"
           [title]="node.label">
        <ng-container [ngSwitch]="getNodeVisualConfig(node).type">
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
    </ng-template>

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
