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
 * @fileoverview Angular application configuration (routing, HTTP client).
 */

import {LocationStrategy} from '@angular/common';
import {provideHttpClient, withFetch} from '@angular/common/http';
import {ApplicationConfig} from '@angular/core';
import {provideRouter, withHashLocation} from '@angular/router';

import {routes} from './app.routes';
import {BundledSource} from './data/bundled-source';
import {LocalFilesSource} from './data/local-files-source';
import {TRACE_SOURCES} from './data/trace-source';
import {PreserveSearchHashLocationStrategy} from './shared/preserve-search-hash-location.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withHashLocation()),
    { provide: LocationStrategy, useClass: PreserveSearchHashLocationStrategy },
    provideHttpClient(withFetch()),
    // Where datasets come from (see data/trace-source.ts).
    { provide: TRACE_SOURCES, useExisting: BundledSource, multi: true },
    { provide: TRACE_SOURCES, useExisting: LocalFilesSource, multi: true },
  ]
};
