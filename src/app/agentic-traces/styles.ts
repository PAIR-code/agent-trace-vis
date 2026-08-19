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
 * @fileoverview Component CSS styles for the agentic traces visualization.
 */

import { COLORS } from "./colors";
import { FILE_GANTT_STYLES } from "./file-gantt-template";

export const AGENTIC_TRACES_STYLES: string[] = [
  FILE_GANTT_STYLES,
  `
    :host {
      display: block;
      background-color: #f8fafc;
      height: calc(100vh - 50px);
      overflow: hidden;
      box-sizing: border-box;
    }

    .selector-bar {
      position: fixed;
      top: 0;
      left: 250px;
      right: 0;
      height: 64px;
      display: flex;
      align-items: center;
      gap: 20px;
      padding: 0 24px;
      z-index: 100;
      background: #3a506b;
      color: white;
    }

    .selector-group, .conv-selector-group {
      display: flex;
      align-items: center;
      gap: 8px;
    }



    .selector-label {
      font-size: 0.7rem;
      font-weight: 600;
      color: rgba(255,255,255,0.7);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .selector-dropdown {
      padding: 4px 10px;
      border: 1px solid rgba(255,255,255,0.3);
      border-radius: 5px;
      font-size: 0.8rem;
      color: #fff;
      background: rgba(255,255,255,0.15);
      cursor: pointer;
      outline: none;
    }

    .selector-dropdown option {
      color: #374151;
      background: white;
    }






    .vis-node.layer-match {
      transform: scale(1.05);
      z-index: 20;
    }
    ::ng-deep app-analysis-toolbar {
      position: fixed;
      top: 64px;
      left: 0;
      right: 0;
      z-index: 90;
    }

    .vis-page-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      padding-top: 44px;
    }

    .main-layout {
      display: flex;
      flex: 1;
      overflow: hidden;
    }

    .vis-container {
      flex: 1;
      display: flex;
      flex-direction: column;
      background: #ffffff;
      position: relative;
      min-width: 200px;
      overflow: hidden;
    }

    .vis-scroll-area {
      flex: 1;
      display: flex;
      flex-direction: column;
      overflow-y: auto;
      overflow-x: auto;
      position: relative;
      padding-left: 16px;
      padding-right: 16px;
    }

    .no-results-banner {
      padding: 0;
      font-size: 0.68rem;
      color: #94a3b8;
      background: transparent;
      margin: 12px 24px 0 24px;
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: none;
      width: fit-content;
      font-weight: 500;
      user-select: none;
    }

    .no-results-layer-name {
      font-weight: 600;
    }

    /* ── Legend ── */
    .legend-bar {
      display: flex;
      align-items: center;
      padding: 6px 14px;
      gap: 16px;
      border-radius: 8px;
      z-index: 30;
    }

    .trace-legend {
      position: absolute;
      bottom: 25px;
      right: 12px;
      background: rgba(255,255,255,0.92);
      backdrop-filter: blur(8px);
      box-shadow: 0 1px 6px rgba(0,0,0,0.08);
      border: 1px solid #e2e8f0;
      flex-direction: column;
      align-items: stretch;
      gap: 8px;
      padding: 8px 12px 10px 12px;
      transition: all 0.15s ease;
      min-width: 100px;
    }

    .trace-legend.collapsed {
      padding: 4px 8px;
      gap: 0;
      min-width: auto;
      cursor: pointer;
      border-radius: 6px;
    }

    .trace-legend.collapsed:hover {
      background: #ffffff;
      border-color: #cbd5e1;
      box-shadow: 0 2px 8px rgba(0,0,0,0.12);
    }

    .legend-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      user-select: none;
      cursor: pointer;
      width: 100%;
    }

    .legend-title {
      font-size: 0.68rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #64748b;
    }

    .legend-toggle-btn {
      background: transparent;
      border: none;
      padding: 2px;
      margin: 0;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      color: #64748b;
      border-radius: 4px;
      line-height: 1;
      transition: color 0.15s, background-color 0.15s;
    }

    .legend-toggle-btn:hover {
      color: #0f172a;
      background: rgba(0,0,0,0.06);
    }

    .legend-items-list {
      display: flex;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      width: 100%;
    }

    .legend-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      flex-shrink: 0;
    }

    .legend-color {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      flex-shrink: 0;
      margin-top: 3px;
    }

    .legend-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: #374151;
      display: flex;
      flex-direction: column;
      line-height: 1.2;
      flex-shrink: 0;
    }

    .legend-main-label {
      font-weight: 600;
    }

    .legend-sub-label {
      font-size: 0.65rem;
      color: #64748b;
      font-weight: normal;
    }

    .col-headers {
      position: sticky;
      top: 0;
      z-index: 20;
      height: 90px;
      background: rgba(248,250,252,0.95);
      border-bottom: 1px solid #e2e8f0;
      backdrop-filter: blur(4px);
      flex-shrink: 0;
    }

    .trace-header {
      position: absolute;
      top: 4px;
      width: 140px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 4px 8px;
      box-sizing: border-box;
      transition: left 0.3s ease, background 0.15s, outline 0.15s, opacity 0.15s;
      cursor: grab;
      border-radius: 6px;
      user-select: none;
    }

    .trace-header:hover {
      background: rgba(226, 232, 240, 0.6);
    }

    .trace-header.is-dragging {
      cursor: grabbing;
      opacity: 0.25;
    }

    .drag-handle {
      position: absolute;
      top: 2px;
      right: 4px;
      font-size: 0.7rem;
      color: #94a3b8;
      opacity: 0.5;
      cursor: grab;
    }

    .trace-header:hover .drag-handle {
      opacity: 1;
      color: #3b82f6;
    }

    .trace-title {
      font-size: 0.75rem;
      font-weight: 700;
      color: #1e293b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1rem;
      text-align: left;
    }

    .model-list {
      display: flex;
      flex-direction: column;
      gap: 1px;
    }

    .model-name {
      font-size: 0.6rem;
      font-weight: 600;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .col-header {
      position: absolute;
      top: 75px;
      transform: translateX(-50%);
      font-size: 0.75rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: #64748b;
      transition: left 0.3s ease;
    }

    .col-lanes {
      position: absolute;
      top: 0;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      pointer-events: none;
      z-index: 0;
      transition: padding-left 0.3s ease;
    }

    .trace-background {
      position: relative;
      display: flex;
      width: 140px;
      margin-right: 20px;
      height: 100%;
      flex-shrink: 0;
      align-items: flex-start;
      pointer-events: auto;
      cursor: grab;
      border-radius: 8px;
      box-sizing: border-box;
      transition: opacity 0.15s, outline 0.15s, box-shadow 0.15s, background 0.15s;
    }

    .track-base-layer {
      position: relative;
      display: flex;
      width: 100%;
      height: 100%;
      transition: filter 0.3s ease, opacity 0.3s ease;
    }

    .track-base-layer.layer-dimmed {
      opacity: .3;
      filter: grayscale(1);
    }

    .track-lines-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 140px;
      height: 100%;
      pointer-events: none;
      z-index: 5;
    }

    .track-lines-layer path {
      transition: d 0.3s ease;
    }

    .track-nodes-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 140px;
      height: 100%;
      pointer-events: none;
      z-index: 10;
    }

    .track-nodes-layer .vis-node {
      pointer-events: auto;
    }

    .track-highlight-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 140px;
      height: 100%;
      pointer-events: none;
      z-index: 15;
    }

    .track-highlight-layer .vis-node {
      pointer-events: auto;
    }

    .trace-background.is-dragging {
      cursor: grabbing;
      opacity: 0.25;
      background: #eff6ff;
      outline: 2px solid #3b82f6;
      outline-offset: 4px;
      box-shadow: 0 4px 20px rgba(59, 130, 246, 0.25);
    }

    .trace-background.is-active {
      border-bottom: 3px solid #3b82f6;
    }

    .drop-indicator-col {
      position: absolute;
      top: 0;
      width: 4px;
      height: 100%;
      background: #3b82f6;
      border-radius: 2px;
      z-index: 50;
      pointer-events: none;
      transform: translateX(-50%);
      transition: left 0.08s ease-out;
    }

    .drop-indicator-row {
      position: absolute;
      left: 0;
      height: 4px;
      width: 100%;
      background: #3b82f6;
      border-radius: 2px;
      z-index: 50;
      pointer-events: none;
      transform: translateY(-50%);
      transition: top 0.08s ease-out;
    }

    .trace-background:last-child {
      margin-right: 0;
    }

    .col-lane {
      flex: 1;
      position: relative;
    }

    .lane-user {
      background: #e2e6ea;
    }

    .lane-agent {
      background: #ebf0f4;
    }

    .lane-tools {
      background: #f4f7f9;
    }



    .vis-content {
      position: relative;
    }

    .vis-node {
      position: absolute;
      cursor: pointer;
      z-index: 10;
      border-radius: 6px;
      transition: opacity 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease, filter 0.2s ease;
      outline: none;
      -webkit-user-drag: none;
      opacity: 0.65;
    }

    .vis-node.hidden {
      display: none;
    }

    .vis-node:hover, .vis-node.is-hovered, .vis-node.selected {
      z-index: 20;
      opacity: 1 !important;
      filter: brightness(0.95);
    }

    .vis-node.selected {
      box-shadow: 0 0 0 3px #3b82f6;
    }

    /* Thinking area SVG blocks */
    .thinking-areas path {
      cursor: pointer;
      transition: opacity 0.2s ease, filter 0.2s ease;
    }
    .thinking-areas path:hover,
    .thinking-areas path.is-hovered {
      opacity: 1 !important;
      filter: brightness(0.95);
    }

    /* ── Filled types ── */
    .vis-node.user_input { background: ${COLORS.USER_BG}; border: 1.5px solid ${COLORS.USER_BORDER}; border-radius: 3px; }
    .vis-node.response { background: ${COLORS.AGENT}; border-radius: 3px; }
    .vis-node.thinking { background: ${COLORS.THINKING}; border-top-left-radius: 0; border-bottom-left-radius: 0; transform-origin: left center; }
    .vis-node.thinking.is-waiting { background: ${COLORS.THINKING_WAITING}; }
    .vis-node.error { background: ${COLORS.ERROR_LIGHT}; }


    /* Override for thinking nodes to have flat left edge */
    .vis-node.thinking {
      border-radius: 0 !important;
      background: transparent !important;
      border: none !important;
    }

    /* ── Hollow types ── */
    .vis-node.tool_call { background: ${COLORS.USER_BG}; border: 1.5px solid ${COLORS.TOOL_LINE}; }
    .vis-node.tool_data { background: ${COLORS.USER_BG}; border: 1.5px solid ${COLORS.TOOL_LINE}; }
    .vis-node.system { background: ${COLORS.USER_BG}; border: 1.5px solid ${COLORS.AGENT}; border-radius: 0; transform: rotate(45deg); }
    .vis-node.system:hover, .vis-node.system.is-hovered { transform: rotate(45deg); }

    /* Custom shapes and content for abstracted node rendering */
    .vis-node.rect {
      border-radius: 2px;
    }
    .vis-node.circle {
      border-radius: 50%;
    }
    
    /* Remove default styling for SVG icons to avoid double borders */
    .vis-node.diff, .vis-node.view, .vis-node.search {
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
      transform: translate(-2px, -2px);
    }
    
    /* Make SVGs fill the container */
    .diff-content svg, .view-content svg, .search-content svg {
      width: 100%;
      height: 100%;
      display: block;
      color: #cbd5e1; /* Gray for file body */
    }
    
    /* Command nodes: gray background with white text */
    .vis-node.command {
      background: #6b7280 !important;
      border: none !important;
      border-radius: 3px !important;
      box-shadow: none !important;
    }
    
    .command-content {
      display: flex;
      justify-content: center;
      align-items: center;
      width: 100%;
      height: 100%;
      font-family: monospace;
      font-size: 7px; /* Slightly smaller for padding effect */
      font-weight: bold;
      color: #ffffff !important;
      box-sizing: border-box;
      padding: 1px;
    }
    
    /* External Search: just the icon, no circle */
    .vis-node.external-search {
      background: transparent !important;
      border: none !important;
      box-shadow: none !important;
    }
    
    .external-search-content svg {
      width: 100%;
      height: 100%;
      display: block;
      color: #000000; /* Black instead of purple */
    }

    /* Failed states for tool nodes */
    .vis-node.is-failed svg {
      color: ${COLORS.ERROR} !important;
    }
    .vis-node.command.is-failed {
      background: ${COLORS.ERROR} !important;
    }
    .vis-node.circle.is-failed {
      border-color: ${COLORS.ERROR} !important;
      background-color: ${COLORS.ERROR_LIGHT} !important;
    }

    .sidebar-resizer {
      width: 8px;
      margin-left: -4px;
      margin-right: -4px;
      cursor: col-resize;
      z-index: 30;
      position: relative;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      background: transparent;
      transition: background 0.15s ease;
      user-select: none;
    }

    .sidebar-resizer:hover,
    .sidebar-resizer:active {
      background: rgba(59, 130, 246, 0.08);
    }

    .sidebar-resizer .resizer-handle-line {
      width: 3px;
      height: 32px;
      border-radius: 1.5px;
      background: #cbd5e1;
      transition: background 0.15s ease, height 0.15s ease;
    }

    .sidebar-resizer:hover .resizer-handle-line,
    .sidebar-resizer:active .resizer-handle-line {
      background: #3b82f6;
      height: 48px;
    }

    .panel-wrapper {
      background: white;
      border-left: 1px solid #e5e7eb;
      position: relative;
      display: flex;
      flex-direction: column;
      height: 100%;
      min-width: 260px;
      max-width: 85vw;
      overflow: hidden;
    }

    .panel-wrapper app-conversation-viewer {
      height: 100%;
      display: flex;
      flex-direction: column;
      min-height: 0;
    }

    /* Override dark theme of shared conversation viewer to look like tree vis */
    ::ng-deep .thread-viewer {
      background: #f8fafc !important;
      color: #1e293b !important;
      border-left: 1px solid #e2e8f0 !important;
    }

    ::ng-deep .thread-scroll {
      scroll-behavior: smooth !important;
    }

    ::ng-deep .panel-static-header {
      background: #ffffff !important;
      border-bottom: 1px solid #e2e8f0 !important;
      padding: 12px 16px !important;
      display: flex !important;
      justify-content: space-between !important;
      align-items: center !important;
      min-width: 0 !important;
    }

    ::ng-deep .header-content {
      flex: 1 1 auto !important;
      min-width: 0 !important;
      overflow: hidden !important;
    }

    ::ng-deep .panel-static-header h3 {
      color: #0f172a !important;
      font-size: 1rem !important;
      margin: 0 0 2px 0 !important;
      white-space: nowrap !important;
      overflow: hidden !important;
      text-overflow: ellipsis !important;
    }

    ::ng-deep .panel-static-header p {
      color: #64748b !important;
      font-size: 0.8rem !important;
      margin: 0 !important;
    }

    ::ng-deep .top-overlay {
      background: linear-gradient(to bottom, rgba(248, 250, 252, 0.9) 0%, rgba(248, 250, 252, 0.4) 50%, transparent 100%) !important;
    }

    ::ng-deep .bottom-overlay {
      background: linear-gradient(to top, rgba(248, 250, 252, 0.9) 0%, rgba(248, 250, 252, 0.4) 50%, transparent 100%) !important;
    }

    ::ng-deep .trace-jump-pill-btn {
      color: #475569 !important;
      background: #ffffff !important;
      border: 1px solid #e2e8f0 !important;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08) !important;
      padding: 3px 9px !important;
      font-size: 0.7rem !important;
      font-weight: 500 !important;
      border-radius: 12px !important;
    }

    ::ng-deep .trace-jump-pill-btn:hover {
      background: #f8fafc !important;
      color: #0f172a !important;
      border-color: #cbd5e1 !important;
      box-shadow: 0 2px 6px rgba(0, 0, 0, 0.12) !important;
    }

    ::ng-deep .trace-jump-pill-btn:active {
      transform: scale(0.97) !important;
    }

    ::ng-deep .message-card {
      color: #1e293b !important;
      padding: 12px 16px !important;
      opacity: 0.65;
      transition: opacity 0.2s ease, background 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease;
    }

    ::ng-deep .message-card:hover,
    ::ng-deep .message-card.is-hovered,
    ::ng-deep .message-card.is-active {
      opacity: 1 !important;
      background: #f1f5f9 !important;
    }

    ::ng-deep .message-card.is-active {
      background: #ffffff !important;
      border-color: #3b82f6 !important;
      box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.2) !important;
    }

    ::ng-deep .message-body {
      color: #334155 !important;
      font-size: 0.85rem !important;
      line-height: 1.5 !important;
      word-break: break-word !important;
      overflow-wrap: break-word !important;
      white-space: normal !important;
    }

    ::ng-deep .message-body p {
      margin: 0 0 0.5em 0;
    }

    ::ng-deep .message-body p:last-child {
      margin-bottom: 0;
    }

    ::ng-deep .message-body h1,
    ::ng-deep .message-body h2,
    ::ng-deep .message-body h3,
    ::ng-deep .message-body h4,
    ::ng-deep .message-body h5,
    ::ng-deep .message-body h6 {
      color: #0f172a !important;
      font-weight: 600 !important;
      margin: 0.8em 0 0.3em 0 !important;
      line-height: 1.3 !important;
    }

    ::ng-deep .message-body h1 { font-size: 1.15rem !important; }
    ::ng-deep .message-body h2 { font-size: 1.05rem !important; }
    ::ng-deep .message-body h3 { font-size: 0.95rem !important; }
    ::ng-deep .message-body h4 { font-size: 0.9rem !important; }

    ::ng-deep .message-body ul,
    ::ng-deep .message-body ol {
      margin: 0.4em 0;
      padding-left: 1.4em;
    }

    ::ng-deep .message-body li {
      margin: 0.15em 0;
    }

    ::ng-deep .message-body li > ul,
    ::ng-deep .message-body li > ol {
      margin: 0.1em 0;
    }

    ::ng-deep .message-body strong {
      font-weight: 600;
      color: #0f172a;
    }

    ::ng-deep .message-body em {
      font-style: italic;
    }

    ::ng-deep .message-body code {
      font-family: 'SF Mono', 'Fira Code', 'Cascadia Code', monospace;
      font-size: 0.82em;
      background: #f1f5f9;
      color: #0f172a;
      padding: 0.15em 0.35em;
      border-radius: 4px;
      border: 1px solid #e2e8f0;
      word-break: break-all;
    }

    ::ng-deep .message-body pre {
      background: #0f172a;
      color: #f8fafc;
      border-radius: 6px;
      padding: 10px 12px;
      overflow-x: auto;
      margin: 0.6em 0;
      font-size: 0.8rem;
      line-height: 1.45;
    }

    ::ng-deep .message-body pre code {
      background: none;
      padding: 0;
      border: none;
      color: inherit;
      font-size: inherit;
      white-space: pre;
      word-break: normal;
    }

    ::ng-deep .message-body blockquote {
      border-left: 3px solid #3b82f6;
      margin: 0.5em 0;
      padding: 0.3em 0.8em;
      background: #eff6ff;
      color: #1e40af;
      border-radius: 0 4px 4px 0;
    }

    ::ng-deep .message-body table {
      border-collapse: collapse;
      margin: 0.6em 0;
      width: 100%;
      font-size: 0.8rem;
    }

    ::ng-deep .message-body th,
    ::ng-deep .message-body td {
      border: 1px solid #e2e8f0;
      padding: 5px 8px;
      text-align: left;
    }

    ::ng-deep .message-body th {
      background: #f8fafc;
      font-weight: 600;
      color: #0f172a;
    }

    ::ng-deep .message-body a {
      color: #2563eb;
      text-decoration: underline;
    }

    ::ng-deep .message-body hr {
      border: none;
      border-top: 1px solid #e2e8f0;
      margin: 0.8em 0;
    }

    ::ng-deep .message-body .think-block {
      background: #fefce8;
      border: 1px solid #fde68a;
      border-left: 3px solid #f59e0b;
      border-radius: 0 6px 6px 0;
      padding: 10px 14px;
      margin: 0.6em 0;
      font-style: italic;
      color: #92400e;
    }

    ::ng-deep .message-body .think-label {
      font-size: 0.7rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: #b45309;
      margin-bottom: 4px;
    }

    ::ng-deep .message-body .katex-display {
      overflow-x: auto;
      overflow-y: hidden;
      padding: 4px 0;
      margin: 0.5em 0;
    }

    ::ng-deep .timestamp {
      color: #94a3b8 !important;
    }

    ::ng-deep .children-list {
      border-left: 1px solid #e2e8f0 !important;
      margin-left: 12px !important;
      padding-left: 12px !important;
    }

    ::ng-deep .child-msg {
      color: #1e293b !important;
      padding: 8px 10px !important;
      opacity: 0.65;
      transition: opacity 0.2s ease, background 0.2s ease, border-color 0.2s ease;
    }

    ::ng-deep .child-msg.is-active {
      background: #f8fafc !important;
      border-color: #3b82f6 !important;
      opacity: 1 !important;
    }

    ::ng-deep .child-msg:hover, ::ng-deep .child-msg.is-hovered {
      background: #f1f5f9 !important;
      opacity: 1 !important;
    }

    ::ng-deep .raw-json-btn {
      color: #64748b !important;
    }

    ::ng-deep .raw-json-btn:hover {
      background: #e2e8f0 !important;
      color: #0f172a !important;
    }

    ::ng-deep .raw-json-pre {
      background: #f1f5f9 !important;
      color: #334155 !important;
      border: 1px solid #e2e8f0 !important;
    }

    ::ng-deep .json-key { color: #64748b !important; }
    ::ng-deep .json-number { color: #1565c0 !important; }
    ::ng-deep .json-boolean { color: #e65100 !important; }
    ::ng-deep .json-null { color: #78909c !important; }

    ::ng-deep .fullscreen-json-content {
      background: #ffffff !important;
      color: #1e293b !important;
    }

    ::ng-deep .fullscreen-json-header h3 {
      color: #0f172a !important;
    }

    ::ng-deep .fullscreen-json-pre {
      background: #f1f5f9 !important;
      color: #334155 !important;
      border: 1px solid #e2e8f0 !important;
    }

    ::ng-deep .close-btn {
      color: #64748b !important;
    }

    ::ng-deep .close-btn:hover {
      color: #0f172a !important;
    }



    /* ── Loading Spinner & Container ── */
    .loading-container {
      display: flex;
      flex-direction: column;
      justify-content: center;
      align-items: center;
      height: 100%;
      min-height: 400px;
      gap: 16px;
    }

    .loading-spinner {
      width: 40px;
      height: 40px;
      border: 3.5px solid rgba(255, 255, 255, 0.1);
      border-top-color: #6366f1; /* beautiful premium indigo */
      border-radius: 50%;
      animation: spin 1s cubic-bezier(0.4, 0, 0.2, 1) infinite;
    }

    .loading-text {
      font-size: 1.1rem;
      color: rgba(255, 255, 255, 0.6);
      font-weight: 400;
    }

    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }



    /* ── Timeline Toggle ── */
    .timeline-toggle {
      display: flex;
      background: rgba(0,0,0,0.2);
      border-radius: 5px;
      padding: 1px;
      flex-shrink: 0;
    }

    .timeline-btn {
      background: none;
      border: none;
      color: rgba(255,255,255,0.5);
      font-size: 0.7rem;
      font-weight: 600;
      padding: 3px 10px;
      border-radius: 4px;
      cursor: pointer;
      transition: all 0.15s;
      white-space: nowrap;
    }

    .timeline-btn.active {
      background: rgba(255,255,255,0.25);
      color: #fff;
    }

    .timeline-btn:hover:not(.active) {
      color: rgba(255,255,255,0.8);
    }

    .timeline-btn:disabled {
      opacity: 0.3;
      cursor: not-allowed;
    }

    /* ── Time Axis ── */
    .time-axis {
      position: absolute;
      top: 0;
      left: 0;
      width: 60px;
      height: 100%;
      pointer-events: none;
      z-index: 4;
      border-right: 1px solid #e2e8f0;
    }

    .time-tick {
      position: absolute;
      left: 0;
      width: 100%;
      display: flex;
      align-items: center;
      justify-content: flex-end;
      transform: translateY(-50%);
      gap: 4px;
      padding-right: 4px;
      box-sizing: border-box;
    }

    .time-tick-label {
      font-size: 0.65rem;
      font-weight: 600;
      color: #64748b;
      white-space: nowrap;
      background: rgba(248,250,252,0.9);
      padding: 1px 4px;
      border-radius: 3px;
      line-height: 1.2;
    }

    .time-tick-line {
      width: 6px;
      height: 1px;
      background: #cbd5e1;
      flex-shrink: 0;
    }

    /* ── Chunk Highlighting ── */
    ::ng-deep .text-chunk {
      transition: background-color 0.3s;
      border-radius: 2px;
      padding: 0 2px;
    }

    ::ng-deep .text-chunk.is-highlighted {
      animation: chunk-flash 2s ease-out;
    }

    @keyframes chunk-flash {
      0% {
        background-color: rgba(253, 224, 71, 0.6);
      }
      100% {
        background-color: transparent;
      }
    }

    /* Row mode: trace title label positioned above each track */
    .row-trace-title {
      position: absolute;
      top: -18px;
      left: 0;
      right: 12px;
      z-index: 20;
      padding: 0;
      overflow: hidden;
      pointer-events: auto;
      cursor: grab;
    }

    .row-trace-title-text {
      font-size: 0.7rem;
      font-weight: 700;
      color: #1e293b;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    /* Row mode: subtle channel labels on first trace */
    .row-channel-label {
      position: absolute;
      right: 8px;
      z-index: 20;
      font-size: 0.55rem;
      font-weight: 500;
      color: #94a3b8;
      letter-spacing: 0.02em;
      pointer-events: none;
      white-space: nowrap;
      text-align: right;
      transform: translateY(-50%);
    }

    /* Row lanes (horizontal background strips) */
    .row-lanes {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      display: flex;
      flex-direction: column;
      pointer-events: none;
      z-index: 0;
    }

    .trace-background-row {
      position: relative;
      display: flex;
      flex-direction: column;
      height: auto;
      min-height: 140px;
      margin-bottom: 28px;
      flex-shrink: 0;
      pointer-events: auto;
      cursor: grab;
      border-radius: 8px;
      box-sizing: border-box;
      transition: opacity 0.15s, outline 0.15s, box-shadow 0.15s;
    }

    .row-main-track {
      position: relative;
      display: flex;
      flex-direction: column;
      height: 140px;
      width: 100%;
      flex-shrink: 0;
    }

    .row-main-track .track-base-layer {
      flex-direction: column;
    }

    .row-main-track .track-lines-layer {
      width: 100%;
      height: 140px;
    }

    .row-main-track .track-nodes-layer {
      width: 100%;
      height: 140px;
    }

    .row-main-track .track-highlight-layer {
      width: 100%;
      height: 140px;
    }

    .trace-background-row.is-dragging {
      cursor: grabbing;
      opacity: 0.25;
      background: #eff6ff;
      outline: 2px solid #3b82f6;
      outline-offset: 4px;
      box-shadow: 0 4px 20px rgba(59, 130, 246, 0.25);
    }

    .trace-background-row:last-child {
      margin-bottom: 0;
    }

    .trace-background-row.is-active::after {
      content: '';
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      width: 4px;
      background: #3b82f6;
      border-top-right-radius: 8px;
      border-bottom-right-radius: 8px;
      z-index: 25;
      pointer-events: none;
    }

    .row-lane {
      flex: 1;
      position: relative;
    }



    /* Horizontal time axis (row mode) */
    .time-axis-horizontal {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 60px;
      pointer-events: none;
      z-index: 4;
      border-bottom: 1px solid #e2e8f0;
    }

    .time-tick-h {
      position: absolute;
      top: 0;
      height: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: flex-end;
      transform: translateX(-50%);
      gap: 4px;
      padding-bottom: 4px;
    }

    .time-tick-label-h {
      font-size: 0.65rem;
      font-weight: 600;
      color: #64748b;
      white-space: nowrap;
      background: rgba(248,250,252,0.9);
      padding: 1px 4px;
      border-radius: 3px;
      line-height: 1.2;
    }

    .time-tick-line-h {
      width: 1px;
      height: 6px;
      background: #cbd5e1;
      flex-shrink: 0;
    }
`,
];
