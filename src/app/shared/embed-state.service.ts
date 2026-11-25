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
 * @fileoverview Shared reactive state for iframe embed mode and chrome
 * visibility flags across the root shell and trace viewer.
 */

import {Injectable, signal} from '@angular/core';

import {
  buildFullAppUrl,
  isEmbedLocation,
  parseUrlUiConfig,
  UrlUiConfig,
} from '../agentic-traces/url-config';
import {parseLocationQueryParams} from './url-params';

/**
 * Holds reactive iframe embed mode and UI chrome visibility state parsed from
 * the current route and URL query parameters.
 */
@Injectable({providedIn: 'root'})
export class EmbedStateService {
  readonly embed = signal(false);
  readonly isEmbedRoute = signal(false);
  readonly headerVisible = signal(true);
  readonly toolbarVisible = signal(true);
  readonly panelVisible = signal(true);
  readonly sidebarHidden = signal(false);
  readonly legendHidden = signal(false);
  readonly fullAppUrl = signal('/');

  constructor() {
    if (typeof window !== 'undefined') {
      this.syncFromLocation(window.location.href);
    }
  }

  /** Synchronizes embed chrome signals directly from a URL and optional route path. */
  syncFromLocation(
    href: string,
    routePath?: string,
    routeParams?: Readonly<Record<string, unknown>>,
  ): UrlUiConfig {
    const onEmbedRoute = isEmbedLocation(href, routePath);
    const params = parseLocationQueryParams(href, routeParams);
    const config = parseUrlUiConfig(params, onEmbedRoute);
    this.applyUiConfig(config, href, onEmbedRoute);
    return config;
  }

  /** Applies already-parsed UI config chrome flags and updates the full-viewer link. */
  applyUiConfig(
    config: UrlUiConfig,
    href: string,
    onEmbedRoute = this.isEmbedRoute(),
  ): void {
    this.isEmbedRoute.set(onEmbedRoute);
    this.embed.set(config.embed);
    this.headerVisible.set(config.headerVisible);
    this.toolbarVisible.set(config.toolbarVisible);
    this.panelVisible.set(config.panelVisible);
    this.sidebarHidden.set(config.sidebarHidden);
    this.legendHidden.set(config.legendHidden);
    this.updateFullAppUrl(href);
  }

  /** Refreshes the "open in full viewer" URL from the current browser location. */
  updateFullAppUrl(href: string): void {
    this.fullAppUrl.set(buildFullAppUrl(href));
  }
}
