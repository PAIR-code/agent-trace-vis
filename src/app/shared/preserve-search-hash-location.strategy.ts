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

import {APP_BASE_HREF, HashLocationStrategy, PlatformLocation} from '@angular/common';
import {Inject, Injectable, Optional} from '@angular/core';

/**
 * Preserves pre-hash `window.location.search` query parameters when Angular
 * Router updates the hash fragment via `HashLocationStrategy`.
 *
 * Default `HashLocationStrategy` passes `#/...` to `history.replaceState`,
 * which resolves against `<base href="/">` (or `./`) and strips pre-hash
 * query parameters during initial router navigation before components can read
 * and migrate them.
 */
@Injectable()
export class PreserveSearchHashLocationStrategy extends HashLocationStrategy {
  constructor(
    private readonly platformLocation: PlatformLocation,
    @Optional() @Inject(APP_BASE_HREF) baseHref?: string,
  ) {
    super(platformLocation, baseHref);
  }

  override prepareExternalUrl(internal: string): string {
    const hashUrl = super.prepareExternalUrl(internal);
    const rawSearch = this.platformLocation.search || '';
    if (!rawSearch) return hashUrl;
    const search = rawSearch.startsWith('?') ? rawSearch : `?${rawSearch}`;
    return hashUrl ? `${search}${hashUrl}` : search;
  }
}
