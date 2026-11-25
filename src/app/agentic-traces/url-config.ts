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
 * @fileoverview Pure URL serialization and deserialization for all timeline,
 * analysis layer, selection, and panel UI configuration settings.
 */

import {getParamFromMap, getParamValuesFromMap} from '../shared/url-params';

import {ANALYSIS_PRESETS} from './analysis-layers.types';
import {AxisMode} from './layout-types';

/** Token usage metric identifiers accepted in the `tokens` URL parameter. */
export const VALID_TOKEN_METRICS = [
  'input_tokens',
  'output_tokens',
  'cache_read_tokens',
  'cache_write_tokens',
] as const;

/** Default token metrics shown on the Tokens X-axis when `tokens` is omitted. */
export const DEFAULT_TOKEN_METRICS: readonly string[] = ['output_tokens'];

/** UI configuration URL parameter keys managed by `serializeUrlUiConfig`. */
export const MANAGED_URL_PARAM_KEYS: readonly string[] = [
  'embed',
  'header',
  'toolbar',
  'panel',
  'axis',
  'wait',
  'fill',
  'tools',
  'subagents',
  'colorBy',
  'sortBy',
  'sortDir',
  // Legacy: chapters are always on now. Kept managed so old ?chapters= links get cleaned up.
  'chapters',
  'tokens',
  'expand',
  'preset',
  'q',
  'searchMode',
  'active',
  'mark',
  'legend',
  'sidebar',
  'filter',
];

/** Legacy alias query parameter keys accepted on read and stripped after migration. */
export const LEGACY_CONFIG_PARAM_ALIASES: readonly string[] = [
  'xAxis',
  'x_axis',
  'showUserWait',
  'show_user_wait',
  'stretch',
  'expandAll',
  'presets',
  'layers',
  'search',
  'search_mode',
];

/** Custom search layer parsed from a `q` URL parameter. */
export interface CustomSearchSpec {
  mode: 'fuzzy' | 'semantic';
  query: string;
}

/** Complete set of URL-backed UI configuration settings for `AgenticTracesComponent`. */
export interface UrlUiConfig {
  embed: boolean;
  headerVisible: boolean;
  toolbarVisible: boolean;
  panelVisible: boolean;
  sidebarHidden: boolean;
  legendHidden: boolean;
  axis: AxisMode;
  wait: boolean;
  fill: boolean;
  /** Tool marks show a glyph per kind of tool (`tools=dots` turns them into plain dots). */
  toolIcons: boolean;
  /** Subagents drawn inline in their parent's row (`subagents=inline`). */
  subagentsInline: boolean;
  /** Metadata field whole traces are colored by (`colorBy=<field>`), or null for agent colors. */
  colorBy: string | null;
  /** Key rows are sorted by (`sortBy=<key>`, see trace-sort.ts), or null for selection order. */
  sortBy: string | null;
  /** Sort largest first (`sortDir=desc`). */
  sortDesc: boolean;
  tokens: string[];
  expandAll: boolean;
  presets: string[];
  searches: CustomSearchSpec[];
  searchMode: 'fuzzy' | 'semantic';
  activeIndex: number | null;
  markId: string | null;
  legendCollapsed: boolean;
  sidebarCollapsed: boolean;
  /** The trace conversation panel on the right is minimized. */
  panelCollapsed: boolean;
  sidebarFilter: string;
}

/** Returns the default UI configuration matching an unadorned app load (or embed route). */
export function defaultUrlUiConfig(embed = false): UrlUiConfig {
  return {
    embed,
    headerVisible: !embed,
    toolbarVisible: !embed,
    panelVisible: !embed,
    sidebarHidden: embed,
    legendHidden: false,
    axis: 'time',
    wait: false,
    fill: false,
    toolIcons: true,
    subagentsInline: false,
    colorBy: null,
    sortBy: null,
    sortDesc: false,
    tokens: [...DEFAULT_TOKEN_METRICS],
    expandAll: true,
    presets: [],
    searches: [],
    searchMode: 'semantic',
    activeIndex: null,
    markId: null,
    legendCollapsed: embed,
    sidebarCollapsed: false,
    panelCollapsed: false,
    sidebarFilter: '',
  };
}

/** Returns true when `href` or Angular `routePath` targets the `/embed` view. */
export function isEmbedLocation(href: string, routePath?: string): boolean {
  if (routePath === 'embed') return true;
  if (!href) return false;
  try {
    const url = new URL(href, 'https://example.com');
    const cleanPath = url.pathname.replace(/\/+$/, '');
    if (cleanPath === '/embed' || cleanPath.endsWith('/embed')) {
      return true;
    }
    const hashPath = url.hash.startsWith('#') ? url.hash.slice(1).split('?')[0].replace(/\/+$/, '') : '';
    return hashPath === '/embed';
  } catch {
    return false;
  }
}

function parseBoolFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on') return true;
  if (v === '0' || v === 'false' || v === 'no' || v === 'off') return false;
  return fallback;
}

function parseVisibilityFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  const v = raw.trim().toLowerCase();
  if (v === '1' || v === 'true' || v === 'yes' || v === 'on' || v === 'open' || v === 'expanded' || v === 'shown') {
    return true;
  }
  if (v === '0' || v === 'false' || v === 'no' || v === 'off' || v === 'hidden' || v === 'none') {
    return false;
  }
  return fallback;
}

function parseAxisMode(raw: string | undefined): AxisMode {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'tokens') return 'tokens';
  if (v === 'steps' || v === 'sequence') return 'sequence';
  return 'time';
}

function parseTokenMetrics(rawValues: readonly string[]): string[] {
  if (rawValues.length === 0) return [...DEFAULT_TOKEN_METRICS];
  const requested = new Set(
    rawValues
      .flatMap(v => v.split(','))
      .map(s => s.trim().toLowerCase())
      .filter(Boolean),
  );
  if (requested.size === 0) return [...DEFAULT_TOKEN_METRICS];
  const valid = VALID_TOKEN_METRICS.filter(m => requested.has(m));
  if (valid.length > 0) return [...valid];
  if (requested.has('none')) return [];
  return [...DEFAULT_TOKEN_METRICS];
}

function parseExpandAll(raw: string | undefined): boolean {
  if (raw === undefined) return true;
  const v = raw.trim().toLowerCase();
  if (v === 'none' || v === '0' || v === 'false' || v === 'collapsed') {
    return false;
  }
  if (v === 'all' || v === '1' || v === 'true' || v === 'expanded') {
    return true;
  }
  return true;
}

function parseTriStateChrome(
  raw: string | undefined,
  collapseOnHide: boolean,
  defaultHidden: boolean,
  defaultCollapsed: boolean,
): { hidden: boolean; collapsed: boolean } {
  if (raw === undefined) {
    return { hidden: defaultHidden, collapsed: defaultCollapsed };
  }
  const v = raw.trim().toLowerCase();
  if (v === 'hidden' || v === '0' || v === 'false' || v === 'off' || v === 'none') {
    return { hidden: true, collapsed: collapseOnHide };
  }
  if (v === 'collapsed') {
    return { hidden: false, collapsed: true };
  }
  if (v === '1' || v === 'true' || v === 'on' || v === 'open' || v === 'expanded' || v === 'shown') {
    return { hidden: false, collapsed: false };
  }
  return { hidden: defaultHidden, collapsed: defaultCollapsed };
}

function parseSidebarState(
  raw: string | undefined,
  embedDefaultHidden: boolean,
): { sidebarHidden: boolean; sidebarCollapsed: boolean } {
  const { hidden, collapsed } = parseTriStateChrome(raw, false, embedDefaultHidden, false);
  return { sidebarHidden: hidden, sidebarCollapsed: collapsed };
}

function parsePanelState(
  raw: string | undefined,
  embedDefaultHidden: boolean,
): { panelVisible: boolean; panelCollapsed: boolean } {
  const { hidden, collapsed } = parseTriStateChrome(raw, false, embedDefaultHidden, false);
  return { panelVisible: !hidden, panelCollapsed: collapsed };
}

function parseLegendState(
  raw: string | undefined,
  embedDefaultCollapsed: boolean,
): { legendHidden: boolean; legendCollapsed: boolean } {
  const { hidden, collapsed } = parseTriStateChrome(raw, true, false, embedDefaultCollapsed);
  return { legendHidden: hidden, legendCollapsed: collapsed };
}

function parseSearchMode(raw: string | undefined): 'fuzzy' | 'semantic' {
  const v = (raw ?? '').trim().toLowerCase();
  if (v === 'fuzzy' || v === 'text') return 'fuzzy';
  return 'semantic';
}

function parsePresets(rawValues: readonly string[]): string[] {
  if (rawValues.length === 0) return [];
  const canonicalByLower = new Map(
    ANALYSIS_PRESETS.map(p => [p.name.toLowerCase(), p.name]),
  );
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of rawValues) {
    for (const token of raw.split(',')) {
      const canonical = canonicalByLower.get(token.trim().toLowerCase());
      if (canonical && !seen.has(canonical)) {
        seen.add(canonical);
        out.push(canonical);
      }
    }
  }
  return out;
}

function parseCustomSearches(
  rawValues: readonly string[],
  defaultMode: 'fuzzy' | 'semantic',
): CustomSearchSpec[] {
  const out: CustomSearchSpec[] = [];
  const seen = new Set<string>();
  for (const raw of rawValues) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    let mode: 'fuzzy' | 'semantic' = defaultMode;
    let query = trimmed;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx > 0) {
      const prefix = trimmed.slice(0, colonIdx).trim().toLowerCase();
      const rest = trimmed.slice(colonIdx + 1).trim();
      if (prefix === 'fuzzy' || prefix === 'text') {
        mode = 'fuzzy';
        query = rest;
      } else if (prefix === 'semantic' || prefix === 'ai') {
        mode = 'semantic';
        query = rest;
      }
    }
    if (!query) continue;
    const key = `${mode}\0${query}`;
    if (!seen.has(key)) {
      seen.add(key);
      out.push({ mode, query });
    }
  }
  return out;
}

/** Parses all UI configuration parameters from a merged query parameter map. */
export function parseUrlUiConfig(
  params: ReadonlyMap<string, readonly string[]>,
  isEmbedRoute = false,
): UrlUiConfig {
  const embed = isEmbedRoute || parseBoolFlag(getParamFromMap(params, ['embed']), false);
  const defaultChromeVisible = !embed;
  const sidebarState = parseSidebarState(getParamFromMap(params, ['sidebar']), embed);
  const panelState = parsePanelState(getParamFromMap(params, ['panel']), embed);
  const legendState = parseLegendState(getParamFromMap(params, ['legend']), embed);
  const searchMode = parseSearchMode(
    getParamFromMap(params, ['searchMode', 'search_mode']),
  );
  const rawActive = getParamFromMap(params, ['active']);
  let activeIndex: number | null = null;
  if (rawActive !== undefined && /^\d+$/.test(rawActive.trim())) {
    activeIndex = Number(rawActive.trim());
  }
  const rawMark = getParamFromMap(params, ['mark'])?.trim();

  return {
    embed,
    headerVisible: parseVisibilityFlag(
      getParamFromMap(params, ['header']),
      defaultChromeVisible,
    ),
    toolbarVisible: parseVisibilityFlag(
      getParamFromMap(params, ['toolbar']),
      defaultChromeVisible,
    ),
    panelVisible: panelState.panelVisible,
    sidebarHidden: sidebarState.sidebarHidden,
    legendHidden: legendState.legendHidden,
    axis: parseAxisMode(getParamFromMap(params, ['axis', 'xAxis', 'x_axis'])),
    wait: parseBoolFlag(
      getParamFromMap(params, ['wait', 'showUserWait', 'show_user_wait']),
      false,
    ),
    fill: parseBoolFlag(getParamFromMap(params, ['fill', 'stretch']), false),
    toolIcons: (getParamFromMap(params, ['tools']) ?? '').trim().toLowerCase() !== 'dots',
    subagentsInline: (getParamFromMap(params, ['subagents']) ?? '').trim().toLowerCase() === 'inline',
    colorBy: (getParamFromMap(params, ['colorBy']) ?? '').trim() || null,
    sortBy: (getParamFromMap(params, ['sortBy']) ?? '').trim() || null,
    sortDesc: (getParamFromMap(params, ['sortDir']) ?? '').trim().toLowerCase() === 'desc',
    tokens: parseTokenMetrics(getParamValuesFromMap(params, ['tokens'])),
    expandAll: parseExpandAll(
      getParamFromMap(params, ['expand', 'expandAll']),
    ),
    presets: parsePresets(
      getParamValuesFromMap(params, ['preset', 'presets', 'layers']),
    ),
    searches: parseCustomSearches(
      getParamValuesFromMap(params, ['q', 'search']),
      searchMode,
    ),
    searchMode,
    activeIndex,
    markId: rawMark ? rawMark : null,
    legendCollapsed: legendState.legendCollapsed,
    sidebarCollapsed: sidebarState.sidebarCollapsed,
    panelCollapsed: panelState.panelCollapsed,
    sidebarFilter: getParamFromMap(params, ['filter']) ?? '',
  };
}

/**
 * Serializes UI config state into query params, omitting defaults (set to `null`)
 * so reverting a setting removes it from the shareable URL.
 */
export function serializeUrlUiConfig(
  config: UrlUiConfig,
  isEmbedRoute = false,
): Record<string, string | string[] | null> {
  const canonicalTokens = VALID_TOKEN_METRICS.filter(m =>
    config.tokens.includes(m),
  );
  const isDefaultTokens =
    canonicalTokens.length === DEFAULT_TOKEN_METRICS.length &&
    canonicalTokens.every((t, i) => t === DEFAULT_TOKEN_METRICS[i]);
  const defaultVisible = !config.embed;

  let sidebarParam: string | null;
  if (!config.embed) {
    sidebarParam = config.sidebarHidden ? 'hidden' : config.sidebarCollapsed ? 'collapsed' : null;
  } else {
    sidebarParam = config.sidebarHidden ? null : config.sidebarCollapsed ? 'collapsed' : '1';
  }

  let panelParam: string | null;
  if (!config.embed) {
    panelParam = !config.panelVisible ? '0' : config.panelCollapsed ? 'collapsed' : null;
  } else {
    panelParam = !config.panelVisible ? null : config.panelCollapsed ? 'collapsed' : '1';
  }

  let legendParam: string | null;
  if (config.legendHidden) {
    legendParam = 'hidden';
  } else if (!config.embed) {
    legendParam = config.legendCollapsed ? 'collapsed' : null;
  } else {
    legendParam = config.legendCollapsed ? null : 'open';
  }

  return {
    embed: config.embed && !isEmbedRoute ? '1' : null,
    header:
      config.headerVisible === defaultVisible
        ? null
        : config.headerVisible
          ? '1'
          : '0',
    toolbar:
      config.toolbarVisible === defaultVisible
        ? null
        : config.toolbarVisible
          ? '1'
          : '0',
    axis:
      config.axis === 'time'
        ? null
        : config.axis === 'sequence'
          ? 'steps'
          : config.axis,
    wait: config.wait ? '1' : null,
    fill: config.fill ? '1' : null,
    tools: config.toolIcons ? null : 'dots',
    subagents: config.subagentsInline ? 'inline' : null,
    colorBy: config.colorBy || null,
    sortBy: config.sortBy || null,
    sortDir: config.sortBy && config.sortDesc ? 'desc' : null,
    chapters: null,
    tokens: isDefaultTokens
      ? null
      : canonicalTokens.length === 0
        ? 'none'
        : canonicalTokens.join(','),
    expand: config.expandAll ? null : 'none',
    preset: config.presets.length > 0 ? config.presets : null,
    q:
      config.searches.length > 0
        ? config.searches.map(s => `${s.mode}:${s.query}`)
        : null,
    searchMode: config.searchMode === 'semantic' ? null : config.searchMode,
    active:
      config.activeIndex !== null && config.activeIndex > 0
        ? String(config.activeIndex)
        : null,
    mark: config.markId ? config.markId : null,
    legend: legendParam,
    sidebar: sidebarParam,
    panel: panelParam,
    filter: config.sidebarFilter.trim() ? config.sidebarFilter.trim() : null,
  };
}

const COLAB_PORT_PROXY_HOST_RE =
  /^.+-([1-9]\d{0,4})-colab(?:\.corp)?\.googleusercontent\.com$/i;

/**
 * Rewrites ephemeral Colab kernel `proxyPort` iframe origins back to
 * `http://localhost:<port>` so "Open in Agent Trace Vis" links open a working
 * standalone tab outside Colab's service-worker sandbox.
 */
function resolveColabProxyPort(hostname: string): number | null {
  const match = COLAB_PORT_PROXY_HOST_RE.exec(hostname);
  if (!match) return null;
  const port = Number(match[1]);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? port : null;
}

/** Builds a full-viewer URL from an embed URL by leaving `/embed` and stripping chrome-hiding flags. */
export function buildFullAppUrl(href: string): string {
  if (!href) return '/';
  try {
    const url = new URL(href, 'https://example.com');
    const colabPort = resolveColabProxyPort(url.hostname);
    if (colabPort !== null) {
      url.protocol = 'http:';
      url.hostname = 'localhost';
      url.port = String(colabPort);
    }
    if (url.pathname.replace(/\/+$/, '') === '/embed') {
      url.pathname = '/';
    } else if (url.pathname.replace(/\/+$/, '').endsWith('/embed')) {
      url.pathname = url.pathname.replace(/\/embed\/?$/, '/');
    }

    const embedKeys = ['embed', 'header', 'toolbar', 'panel', 'sidebar', 'legend'];
    for (const key of embedKeys) {
      url.searchParams.delete(key);
    }

    if (url.hash) {
      const qIdx = url.hash.indexOf('?');
      const hashPath = (qIdx >= 0 ? url.hash.slice(0, qIdx) : url.hash).replace(
        /^#\/embed(?=\/|$)/,
        '#/agentic-traces',
      );
      if (qIdx >= 0) {
        const hashParams = new URLSearchParams(url.hash.slice(qIdx + 1));
        for (const key of embedKeys) {
          hashParams.delete(key);
        }
        const qs = hashParams.toString();
        url.hash = qs ? `${hashPath}?${qs}` : hashPath === '#/' ? '' : hashPath;
      } else {
        url.hash = hashPath === '#/' ? '' : hashPath;
      }
    }

    return url.toString();
  } catch {
    return '/';
  }
}

/** Input to `resolvePendingUrlSelection`. */
export interface PendingUrlSelectionInput<T extends { id: string; traceId: string }> {
  pendingActiveIndex: number | null;
  pendingMarkId: string | null;
  entryIds: readonly string[];
  marks: readonly T[];
  fallbackActiveTraceId?: string;
  initializing: boolean;
}

/** Output from `resolvePendingUrlSelection`. */
export interface PendingUrlSelectionResult<T> {
  activeTraceId: string | null;
  mark: T | null;
  nextPendingActiveIndex: number | null;
  nextPendingMarkId: string | null;
}

/**
 * Resolves URL-restored `active` trace index and `mark` id once initial
 * workspace datasets finish loading, so async multi-dataset loads cannot
 * discard pending targets while earlier datasets are still in flight.
 */
export function resolvePendingUrlSelection<T extends { id: string; traceId: string }>(
  input: PendingUrlSelectionInput<T>,
): PendingUrlSelectionResult<T> {
  const { pendingActiveIndex, pendingMarkId, entryIds, marks, initializing } = input;
  if (initializing) {
    return {
      activeTraceId: null,
      mark: null,
      nextPendingActiveIndex: pendingActiveIndex,
      nextPendingMarkId: pendingMarkId,
    };
  }

  let activeTraceId: string | null = null;
  if (pendingActiveIndex !== null && entryIds.length > 0) {
    activeTraceId = entryIds[pendingActiveIndex] ?? null;
  }

  let mark: T | null = null;
  if (pendingMarkId !== null && marks.length > 0) {
    const preferredId = activeTraceId ?? input.fallbackActiveTraceId;
    mark =
      (preferredId
        ? marks.find(m => m.traceId === preferredId && m.id === pendingMarkId)
        : undefined)
      ?? marks.find(m => m.id === pendingMarkId)
      ?? null;
  }

  return {
    activeTraceId,
    mark,
    nextPendingActiveIndex: null,
    nextPendingMarkId: null,
  };
}
