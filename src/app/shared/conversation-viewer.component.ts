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
          <h3 [title]="title">{{ title }}</h3>
          <p>{{ subtitle }}</p>
        </div>
        <div class="header-actions">
          <ng-container [ngTemplateOutlet]="headerActionsTemplate"></ng-container>
        </div>
      </div>

      <!-- Scrollable Area with Top/Bottom Hover Overlays -->
      <div class="thread-body-container">
        <!-- Top Hover Overlay -->
        <div class="trace-jump-overlay top-overlay" *ngIf="showJumpButtons">
          <button class="trace-jump-pill-btn" (click)="scrollToTop(); $event.stopPropagation()" title="Jump to beginning of trace">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="18 15 12 9 6 15"></polyline>
              <line x1="6" y1="6" x2="18" y2="6"></line>
            </svg>
            <span>Start</span>
          </button>
        </div>

        <!-- Scrollable Thread Area -->
        <div class="thread-scroll" #threadScrollContainer (scroll)="onScroll($event)">
          <div class="message-list">
          <ng-container *ngFor="let msg of messages">
            <!-- Message Card -->
            <div [id]="'msg-' + msg.id"
                 class="message-card"
                 [class.is-active]="activeNodeId === msg.id"
                 [class.is-hovered]="hoveredNodeId === msg.id"
                 [class.search-match]="isMatch(msg)"
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

      <!-- Bottom Hover Overlay -->
      <div class="trace-jump-overlay bottom-overlay" *ngIf="showJumpButtons">
        <button class="trace-jump-pill-btn" (click)="scrollToBottom(); $event.stopPropagation()" title="Jump to end of trace">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="6 9 12 15 18 9"></polyline>
            <line x1="6" y1="18" x2="18" y2="18"></line>
          </svg>
          <span>End</span>
        </button>
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
      min-width: 0;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-shrink: 0;
    }

    .thread-body-container {
      position: relative;
      flex: 1;
      min-height: 0;
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .trace-jump-overlay {
      position: absolute;
      left: 0;
      right: 0;
      height: 54px;
      display: flex;
      justify-content: center;
      z-index: 50;
      pointer-events: none;
      transition: opacity 0.2s ease, transform 0.2s ease;
      opacity: 0;
    }

    .top-overlay {
      top: 0;
      align-items: flex-start;
      padding-top: 6px;
      transform: translateY(-6px);
      background: linear-gradient(to bottom, rgba(30, 30, 30, 0.85) 0%, rgba(30, 30, 30, 0.4) 50%, transparent 100%);
    }

    .bottom-overlay {
      bottom: 0;
      align-items: flex-end;
      padding-bottom: 22px;
      transform: translateY(6px);
      background: linear-gradient(to top, rgba(30, 30, 30, 0.85) 0%, rgba(30, 30, 30, 0.4) 50%, transparent 100%);
    }

    .top-overlay:hover,
    .bottom-overlay:hover {
      opacity: 1;
      transform: translateY(0);
    }

    .trace-jump-pill-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 9px;
      font-size: 0.7rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.8);
      background: rgba(35, 35, 35, 0.9);
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 12px;
      cursor: pointer;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.25);
      pointer-events: auto;
      transition: all 0.15s ease;
      white-space: nowrap;
      user-select: none;
      line-height: 1.2;
    }

    .trace-jump-pill-btn:hover {
      background: rgba(55, 55, 55, 0.95);
      color: #fff;
      border-color: rgba(255, 255, 255, 0.3);
      box-shadow: 0 2px 8px rgba(0, 0, 0, 0.35);
    }

    .trace-jump-pill-btn:active {
      transform: scale(0.97);
    }

    .header-content {
      flex: 1;
      min-width: 0;
      overflow: hidden;
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
      padding: 16px 16px 64px 16px;
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
      line-height: 1.5;
      color: rgba(255,255,255,0.85);
      word-break: break-word;
      overflow-wrap: break-word;
    }

    .message-body p {
      margin: 0 0 0.5em 0;
    }

    .message-body p:last-child {
      margin-bottom: 0;
    }

    .message-body h1,
    .message-body h2,
    .message-body h3,
    .message-body h4,
    .message-body h5,
    .message-body h6 {
      color: #fff;
      font-weight: 600;
      margin: 0.8em 0 0.3em 0;
      line-height: 1.3;
    }

    .message-body h1 { font-size: 1.15rem; }
    .message-body h2 { font-size: 1.05rem; }
    .message-body h3 { font-size: 0.95rem; }
    .message-body h4 { font-size: 0.9rem; }

    .message-body ul,
    .message-body ol {
      margin: 0.4em 0;
      padding-left: 1.4em;
    }

    .message-body li {
      margin: 0.15em 0;
    }

    .message-body strong {
      font-weight: 600;
      color: #fff;
    }

    .message-body em {
      font-style: italic;
    }

    .message-body code {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.82em;
      background: rgba(255, 255, 255, 0.1);
      color: #e2e8f0;
      padding: 0.15em 0.35em;
      border-radius: 4px;
      word-break: break-all;
    }

    .message-body pre {
      background: rgba(0, 0, 0, 0.4);
      color: #e2e8f0;
      border-radius: 6px;
      padding: 10px 12px;
      overflow-x: auto;
      margin: 0.6em 0;
      font-size: 0.8rem;
      line-height: 1.45;
    }

    .message-body pre code {
      background: none;
      padding: 0;
      border: none;
      color: inherit;
      font-size: inherit;
      white-space: pre;
      word-break: normal;
    }

    .message-body blockquote {
      border-left: 3px solid #3b82f6;
      margin: 0.5em 0;
      padding: 0.3em 0.8em;
      background: rgba(59, 130, 246, 0.1);
      color: #93c5fd;
      border-radius: 0 4px 4px 0;
    }

    .message-body table {
      border-collapse: collapse;
      margin: 0.6em 0;
      width: 100%;
      font-size: 0.8rem;
    }

    .message-body th,
    .message-body td {
      border: 1px solid rgba(255, 255, 255, 0.15);
      padding: 5px 8px;
      text-align: left;
    }

    .message-body th {
      background: rgba(255, 255, 255, 0.08);
      font-weight: 600;
      color: #fff;
    }

    .message-body a {
      color: #60a5fa;
      text-decoration: underline;
    }

    .message-body hr {
      border: none;
      border-top: 1px solid rgba(255, 255, 255, 0.15);
      margin: 0.8em 0;
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

  @Input() showJumpButtons: boolean = true;
  @Output() jumpToStart = new EventEmitter<void>();
  @Output() jumpToEnd = new EventEmitter<void>();

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

  scrollToTop() {
    if (this.scrollContainer) {
      this.scrollContainer.nativeElement.scrollTo({
        top: 0,
        behavior: 'smooth'
      });
    }
    this.jumpToStart.emit();
  }

  scrollToBottom() {
    if (this.scrollContainer) {
      this.scrollContainer.nativeElement.scrollTo({
        top: this.scrollContainer.nativeElement.scrollHeight,
        behavior: 'smooth'
      });
    }
    this.jumpToEnd.emit();
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
