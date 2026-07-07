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

export const AGENTIC_TRACES_STYLES: string[] = [
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

    .vis-node.layer-dim {
      filter: grayscale(100%);
      opacity: 0.35;
      transition: filter 0.3s, opacity 0.3s;
    }

    .lines-layer.layer-active {
      filter: grayscale(100%);
      opacity: 0.3;
      transition: filter 0.3s, opacity 0.3s;
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
      padding-right: 32px;
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
      background: rgba(255,255,255,0.9);
      backdrop-filter: blur(8px);
      box-shadow: 0 1px 4px rgba(0,0,0,0.08);
      border: 1px solid #e2e8f0;
      flex-direction: column;
      align-items: flex-start;
      gap: 8px;
      padding: 12px;
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
      padding: 0 8px;
      box-sizing: border-box;
      transition: left 0.3s ease;
    }

    .trace-title {
      font-size: 0.75rem;
      font-weight: 700;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
      white-space: normal;
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
      display: flex;
      width: 140px;
      margin-right: 20px;
      height: 100%;
      flex-shrink: 0;
      align-items: flex-start;
    }

    .trace-background:last-child {
      margin-right: 0;
    }

    .col-lane {
      flex: 1;
      position: relative;
    }

    .lane-user {
      background: #e4e8ee;
    }

    .lane-tools {
      background: #ffffff;
    }

    .lane-agent {
      background: #f0f2f5;
    }



    .vis-content {
      position: relative;
    }

    .vis-node {
      position: absolute;
      cursor: pointer;
      z-index: 10;
      border-radius: 6px;
      transition: all 0.3s ease;
    }

    .vis-node.hidden {
      display: none;
    }



    .vis-node:hover, .vis-node.is-hovered {
      z-index: 20;
      filter: brightness(0.9);
    }

    .vis-node.selected {
      box-shadow: 0 0 0 3px #3b82f6;
    }

    /* ── Filled types ── */
    .vis-node.user_input { background: ${COLORS.USER_BG}; border: 1.5px solid ${COLORS.USER_BORDER}; border-bottom-left-radius: 0; }
    .vis-node.response { background: ${COLORS.AGENT}; border-bottom-right-radius: 0; }
    .vis-node.thinking { background: ${COLORS.THINKING}; border-top-left-radius: 0; border-bottom-left-radius: 0; transform-origin: left center; }
    .vis-node.thinking.is-waiting { background: ${COLORS.THINKING_WAITING}; }
    .vis-node.error { background: ${COLORS.ERROR_LIGHT}; }

    /* ── Units classes for area encoding ── */
    .vis-node.units-1 { border-radius: 50%; }
    .vis-node.units-2 { border-radius: 6px; }
    .vis-node.units-4 { border-radius: 6px; }

    .vis-node.units-3 {
      border-radius: 6px;
      position: relative;
    }
    .vis-node.units-3::after {
      content: '';
      position: absolute;
      top: 12px;
      left: 0;
      width: 12px;
      height: 12px;
      background: inherit;
      border-radius: 50%;
    }

    /* Override for thinking nodes to have flat left edge */
    .vis-node.thinking {
      border-radius: 0 !important;
      background: transparent !important;
      border: none !important;
    }

    /* ── Hollow types ── */
    .vis-node.tool_call { background: ${COLORS.USER_BG}; border: 1.5px solid ${COLORS.TOOL_LINE}; }
    .vis-node.tool_data { background: ${COLORS.USER_BG}; border: 1.5px solid ${COLORS.TOOL_LINE}; }
    .vis-node.system { background: ${COLORS.USER_BG}; border: 1.5px solid ${COLORS.TOOL_LINE}; border-radius: 0; transform: rotate(45deg); }
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
    
    /* Apply 0.5 opacity to all tool icons */
    .vis-node.diff, .vis-node.view, .vis-node.search, .vis-node.command, .vis-node.external-search {
      opacity: 0.5;
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

    .lines-layer {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      pointer-events: none;
    }

    .lines-layer path {
      transition: d 0.3s ease;
    }


    .panel-wrapper {
      width: 400px !important;
      flex: 0 0 400px !important;
      background: white;
      border-left: 1px solid #e5e7eb;
      position: relative;
      display: flex;
      flex-direction: column;
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
      padding: 16px 20px !important;
    }

    ::ng-deep .panel-static-header h3 {
      color: #0f172a !important;
      font-size: 1rem !important;
    }

    ::ng-deep .panel-static-header p {
      color: #64748b !important;
      font-size: 0.8rem !important;
    }

    ::ng-deep .message-card {
      color: #1e293b !important;
      padding: 12px 16px !important;
    }

    ::ng-deep .message-card:hover {
      background: #f1f5f9 !important;
    }

    ::ng-deep .message-card.is-active {
      background: #ffffff !important;
      border-color: #3b82f6 !important;
      box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.2) !important;
    }

    ::ng-deep .message-card.search-match {
      z-index: 10;
    }



    ::ng-deep .message-body {
      color: #334155 !important;
      font-size: 0.85rem !important;
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
    }

    ::ng-deep .child-msg.is-active {
      background: #f8fafc !important;
      border-color: #3b82f6 !important;
    }

    ::ng-deep .child-msg:hover, ::ng-deep .child-msg.is-hovered {
      background: #f1f5f9 !important;
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

    /* Row mode: trace title positioned above each row */
    .row-trace-title {
      position: absolute;
      left: 8px;
      z-index: 20;
    }

    .row-trace-title-text {
      font-size: 0.7rem;
      font-weight: 700;
      color: #1e293b;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      max-width: 300px;
      display: inline-block;
    }

    /* Row mode: subtle channel labels on first trace */
    .row-channel-label {
      position: absolute;
      left: 8px;
      z-index: 20;
      font-size: 0.55rem;
      font-weight: 500;
      color: #94a3b8;
      letter-spacing: 0.02em;
      pointer-events: none;
      white-space: nowrap;
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
      display: flex;
      flex-direction: column;
      height: 140px;
      margin-bottom: 20px;
      flex-shrink: 0;
    }

    .trace-background-row:last-child {
      margin-bottom: 0;
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
