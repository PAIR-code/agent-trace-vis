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
 * @fileoverview Reusable scrollable conversation thread viewer with search
 * highlighting, nested children, and expandable raw JSON.
 */

import { Component, Input, Output, EventEmitter, ElementRef, ViewChild, OnChanges, SimpleChanges } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { SafeHtml } from '@angular/platform-browser';

export interface ConversationMessage {
  id: string;
  speaker?: string;
  text: string;
  timestamp?: string | number;
  children?: ConversationMessage[];
  score?: number;
  isSearchMatch?: boolean;
  glowStyle?: string;
  data?: any;
}

@Component({
  selector: 'app-conversation-viewer',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="thread-viewer">
      <!-- Static Header -->
      <div class="panel-static-header">
        <div class="header-content">
          <h3>{{ title }}</h3>
          <p>{{ subtitle }}</p>
        </div>
        <div class="header-actions">
          <ng-container [ngTemplateOutlet]="headerActionsTemplate"></ng-container>
        </div>
      </div>

      <!-- Scrollable Thread Area -->
      <div class="thread-scroll" #threadScrollContainer (scroll)="onScroll($event)">
        <!-- Search Overlay -->
        <div class="search-overlay" *ngIf="searchQuery" (click)="overlayClick.emit()"></div>
        <div class="message-list">
          <ng-container *ngFor="let msg of messages">
            <!-- Message Card -->
            <div [id]="'msg-' + msg.id"
                 class="message-card"
                 [class.is-active]="activeNodeId === msg.id || (msg.id.includes('_thinking_0') && activeNodeId && activeNodeId.startsWith(msg.id.replace('_thinking_0', '')))"
                 [class.is-hovered]="hoveredNodeId === msg.id"
                 [class.search-match]="isMatch(msg)"
                 [class.search-dim]="isDim(msg)"
                 [style.boxShadow]="msg.glowStyle"
                 [style.borderLeftColor]="getSpeakerColor(msg)"
                 [style.background-color]="getSpeakerBgColor(msg)"
                 [style.border]="getSpeakerBorder(msg)"
                 (click)="onMessageClick(msg.id)"
                 (mouseenter)="messageHover.emit(msg.id)"
                 (mouseleave)="messageHover.emit(null)">

              <div class="message-meta">
                <span class="role-badge" [style.color]="getSpeakerColor(msg)">{{ getSpeakerLabel(msg) }}</span>
                <span class="timestamp" *ngIf="msg.timestamp">{{ formatTime(msg.timestamp) }}</span>
              </div>
              <div class="message-body" [innerHTML]="getHighlightedText(msg)"></div>

              <!-- Raw JSON Section -->
              <div class="raw-json-section" *ngIf="msg.data">
                <div class="raw-json-header">
                  <button class="raw-json-btn" (click)="toggleRawJson(msg.id); $event.stopPropagation()">
                    {{ isRawJsonExpanded(msg.id) ? '▴' : '▾' }} json
                  </button>
                  <button class="raw-json-btn" *ngIf="isRawJsonExpanded(msg.id)" (click)="openFullScreenJson(msg.data); $event.stopPropagation()" title="Full screen view">
                    ⛶ expand
                  </button>
                </div>
                <pre class="raw-json-pre" *ngIf="isRawJsonExpanded(msg.id)" [innerHTML]="formatJson(msg.data)"></pre>
              </div>

              <!-- Slot for actions (e.g. star button) -->
              <div class="message-actions">
                <ng-container [ngTemplateOutlet]="messageActionsTemplate" [ngTemplateOutletContext]="{ $implicit: msg }"></ng-container>
              </div>
            </div>

            <!-- Slot for branches or replies (sits between messages) -->
            <ng-container [ngTemplateOutlet]="betweenMessagesTemplate" [ngTemplateOutletContext]="{ $implicit: msg }"></ng-container>

            <!-- Children (for nested structures like agentic-traces) -->
            <div class="children-list" *ngIf="msg.children && msg.children.length > 0">
              <div class="child-msg" *ngFor="let child of msg.children"
                   [id]="'msg-' + child.id"
                   [class.is-active]="activeNodeId === child.id"
                   [class.is-hovered]="hoveredNodeId === child.id"
                   [style.background-color]="getSpeakerBgColor(child)"
                   [style.border]="getSpeakerBorder(child)"
                   (click)="onMessageClick(child.id); $event.stopPropagation()"
                   (mouseenter)="messageHover.emit(child.id)"
                   (mouseleave)="messageHover.emit(null)">
                <div class="child-header">
                  <span class="role-badge" [style.color]="getSpeakerColor(child)">{{ getSpeakerLabel(child) }}</span>
                  <span class="timestamp" *ngIf="child.timestamp">{{ formatTime(child.timestamp) }}</span>
                </div>
                <div class="message-body" [innerHTML]="getHighlightedText(child)"></div>
                
                <!-- Raw JSON Section for Child -->
                <div class="raw-json-section" *ngIf="child.data">
                  <div class="raw-json-header">
                    <button class="raw-json-btn" (click)="toggleRawJson(child.id); $event.stopPropagation()">
                      {{ isRawJsonExpanded(child.id) ? '▴' : '▾' }} json
                    </button>
                    <button class="raw-json-btn" *ngIf="isRawJsonExpanded(child.id)" (click)="openFullScreenJson(child.data); $event.stopPropagation()" title="Full screen view">
                      ⛶ expand
                    </button>
                  </div>
                  <pre class="raw-json-pre" *ngIf="isRawJsonExpanded(child.id)" [innerHTML]="formatJson(child.data)"></pre>
                </div>
              </div>
            </div>
          </ng-container>
        </div>
      </div>
    </div>

    <!-- Full Screen JSON Modal -->
    <div class="fullscreen-json-overlay" *ngIf="fullScreenJsonData" (click)="closeFullScreenJson()">
      <div class="fullscreen-json-content" (click)="$event.stopPropagation()">
        <div class="fullscreen-json-header">
          <h3>Raw JSON</h3>
          <button class="close-btn" (click)="closeFullScreenJson()">×</button>
        </div>
        <pre class="fullscreen-json-pre" [innerHTML]="formatJson(fullScreenJsonData)"></pre>
      </div>
    </div>
  `,
  styles: [`
    .thread-viewer {
      display: flex;
      flex-direction: column;
      height: 100%;
      background: #1e1e1e;
      border-left: 1px solid rgba(255,255,255,0.1);
    }

    .panel-static-header {
      padding: 12px 16px;
      background: rgba(0,0,0,0.2);
      border-bottom: 1px solid rgba(255,255,255,0.05);
      flex-shrink: 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .panel-static-header h3 {
      margin: 0 0 2px 0;
      font-size: 0.95rem;
      font-weight: 600;
      color: #fff;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .panel-static-header p {
      margin: 0;
      font-size: 0.75rem;
      color: rgba(255,255,255,0.5);
    }

    .thread-scroll {
      flex: 1;
      overflow-y: auto;
      padding: 16px;
      position: relative;
    }

    .message-list {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .message-card {
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 8px;
      padding: 10px 12px;
      cursor: pointer;
      transition: all 0.2s;
      position: relative;
      border-left-width: 3px;
    }

    .message-card:hover {
      background: rgba(255,255,255,0.06);
      border-color: rgba(255,255,255,0.15);
    }

    .message-card.is-active {
      background: rgba(255,255,255,0.08);
      border-color: rgba(255,255,255,0.2);
      box-shadow: 0 0 0 1px rgba(255,255,255,0.1);
    }

    .message-card.search-match {
      z-index: 20;
      position: relative;
    }

    .search-overlay {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.25);
      z-index: 15;
      cursor: pointer;
    }

    .message-meta {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .role-badge {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    .timestamp {
      font-size: 0.7rem;
      color: rgba(255,255,255,0.4);
    }

    .message-body {
      font-size: 0.85rem;
      line-height: 1.45;
      color: rgba(255,255,255,0.85);
      white-space: pre-wrap;
      word-break: break-word;
    }

    .message-actions {
      position: absolute;
      top: 8px;
      right: 8px;
    }

    /* Children styles */
    .children-list {
      margin-left: 16px;
      border-left: 1px solid rgba(255,255,255,0.1);
      padding-left: 12px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      margin-top: -4px;
      margin-bottom: 4px;
    }

    .child-msg {
      background: rgba(255,255,255,0.02);
      border: 1px solid rgba(255,255,255,0.05);
      border-radius: 6px;
      padding: 6px 8px;
      cursor: pointer;
      font-size: 0.8rem;
    }

    .child-msg.is-active {
      background: rgba(255,255,255,0.05);
      border-color: rgba(255,255,255,0.1);
    }

    .child-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 4px;
    }

    .raw-json-section {
      margin-top: 4px;
    }

    .raw-json-header {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 2px;
    }

    .raw-json-btn {
      background: transparent;
      border: none;
      color: rgba(255,255,255,0.5);
      font-size: 0.7rem;
      cursor: pointer;
      padding: 2px 6px;
      border-radius: 4px;
    }

    .raw-json-btn:hover {
      color: rgba(255,255,255,0.8);
      background: rgba(255,255,255,0.05);
    }

    .raw-json-pre {
      margin: 6px 0 0 0;
      font-size: 0.75rem;
      background: rgba(0,0,0,0.2);
      padding: 8px;
      border-radius: 4px;
      overflow-x: auto;
      color: rgba(255,255,255,0.8);
    }

    .json-key { color: #9ca3af; }
    .json-string-val { color: inherit; }
    .json-number { color: #bd93f9; }
    .json-boolean { color: #50fa7b; }
    .json-null { color: #8be9fd; }

    .fullscreen-json-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0,0,0,0.8);
      z-index: 1000;
      display: flex;
      justify-content: center;
      align-items: center;
    }

    .fullscreen-json-content {
      background: #1e1e1e;
      width: 90vw;
      height: 90vh;
      border-radius: 12px;
      display: flex;
      flex-direction: column;
      padding: 20px;
      box-shadow: 0 10px 30px rgba(0,0,0,0.5);
    }

    .fullscreen-json-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 16px;
      border-bottom: 1px solid rgba(255,255,255,0.1);
      padding-bottom: 10px;
    }

    .fullscreen-json-header h3 {
      margin: 0;
      color: #fff;
    }

    .close-btn {
      background: transparent;
      border: none;
      color: rgba(255,255,255,0.7);
      font-size: 1.5rem;
      cursor: pointer;
    }

    .close-btn:hover {
      color: #fff;
    }

    .fullscreen-json-pre {
      flex: 1;
      overflow-y: auto;
      background: rgba(0,0,0,0.3);
      padding: 16px;
      border-radius: 8px;
      font-size: 0.9rem;
      color: rgba(255,255,255,0.9);
    }
  `]
})
export class ConversationViewerComponent implements OnChanges {
  @Input() messages: ConversationMessage[] = [];
  private lastClickedNodeId: string | null = null;
  @Input() activeNodeId: string | null = null;
  @Input() hoveredNodeId: string | null = null;
  @Input() searchQuery: string = '';
  @Input() title: string = '';
  @Input() subtitle: string = '';

  @Output() messageHover = new EventEmitter<string | null>();

  // Color mapping functions passed from parent
  @Input() getSpeakerColor: (msg: any) => string = () => '';
  @Input() getSpeakerBgColor: (msg: any) => string = () => '';
  @Input() getSpeakerBorder: (msg: any) => string = () => '';
  @Input() getSpeakerLabel: (msg: any) => string = (msg) => msg.speaker || msg.type || '';
  @Input() getHighlightedText: (msg: any) => string | SafeHtml = (msg) => msg.text || '';

  // Custom templates
  @Input() headerActionsTemplate: any;
  @Input() messageActionsTemplate: any;
  @Input() betweenMessagesTemplate: any;
  @Input() scrollBehavior: 'auto' | 'smooth' | 'instant' = 'instant';

  @Output() messageClick = new EventEmitter<string>();
  @Output() panelScroll = new EventEmitter<Event>();
  @Output() overlayClick = new EventEmitter<void>();

  @ViewChild('threadScrollContainer') scrollContainer!: ElementRef<HTMLDivElement>;

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['activeNodeId'] || changes['messages']) && this.activeNodeId) {
      const wasClicked = this.activeNodeId === this.lastClickedNodeId;
      this.lastClickedNodeId = null; // Always reset

      if (!wasClicked) {
        this.scrollToNode(this.activeNodeId);
      }
    }
  }

  onMessageClick(id: string) {
    this.lastClickedNodeId = id;
    this.messageClick.emit(id);
  }

  onScroll(event: Event) {
    this.panelScroll.emit(event);
  }

  isMatch(msg: ConversationMessage): boolean {
    if (msg.isSearchMatch) return true;
    if (msg.score !== undefined && msg.score > 0) return true;
    return false;
  }

  isDim(msg: ConversationMessage): boolean {
    if (!this.searchQuery) return false;
    return !this.isMatch(msg);
  }

  scrollToNode(nodeId: string) {
    setTimeout(() => {
      const el = document.getElementById('msg-' + nodeId) || document.getElementById('chunk-' + nodeId);
      if (el && this.scrollContainer) {
        const container = this.scrollContainer.nativeElement;
        const containerRect = container.getBoundingClientRect();
        const elementRect = el.getBoundingClientRect();
        const relativeTop = elementRect.top - containerRect.top + container.scrollTop;

        container.scrollTo({
          top: relativeTop,
          behavior: this.scrollBehavior as ScrollBehavior
        });
      }
    }, 100);
  }

  formatTime(timestamp?: string | number): string {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return String(timestamp);
    }
    const formatted = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    return formatted;
  }

  // Raw JSON view state
  expandedRawJson = new Set<string>();

  toggleRawJson(id: string) {
    if (this.expandedRawJson.has(id)) {
      this.expandedRawJson.delete(id);
    } else {
      this.expandedRawJson.add(id);
    }
  }

  isRawJsonExpanded(id: string): boolean {
    return this.expandedRawJson.has(id);
  }

  formatJson(obj: any, depth = 0): string {
    if (!obj) return '';

    if (depth === 0) {
      const { children, ...rest } = obj;
      obj = rest;
    }

    if (obj === null) return `<span class="json-null">null</span>`;
    if (typeof obj === 'boolean') return `<span class="json-boolean">${obj}</span>`;
    if (typeof obj === 'number') return `<span class="json-number">${obj}</span>`;
    if (typeof obj === 'string') {
      const escaped = obj.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      return `<span class="json-string-val">${escaped}</span>`;
    }

    const indent = '  '.repeat(depth);

    if (Array.isArray(obj)) {
      if (obj.length === 0) return '[]';
      let html = '[\n';
      for (let i = 0; i < obj.length; i++) {
        html += `${indent}  ${this.formatJson(obj[i], depth + 1)}${i < obj.length - 1 ? ',' : ''}\n`;
      }
      html += `${indent}]`;
      return html;
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj).filter(k => k !== 'children');
      if (keys.length === 0) return '{}';
      let html = '{\n';
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i];
        const val = obj[key];
        html += `${indent}  <span class="json-key">"${key}"</span>: ${this.formatJson(val, depth + 1)}${i < keys.length - 1 ? ',' : ''}\n`;
      }
      html += `${indent}}`;
      return html;
    }

    return String(obj);
  }

  // Full screen JSON view state
  fullScreenJsonData: any = null;

  openFullScreenJson(data: any) {
    this.fullScreenJsonData = data;
  }

  closeFullScreenJson() {
    this.fullScreenJsonData = null;
  }
}
