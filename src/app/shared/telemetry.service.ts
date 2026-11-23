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
 * @fileoverview Optional telemetry extension point.
 *
 * The open-source application intentionally leaves `TELEMETRY_TRACKER`
 * unprovided so open-source builds perform zero tracking, storage, or
 * network requests. Host deployments may bind an implementation via Angular DI.
 */

import {InjectionToken} from '@angular/core';

/** Primitive event attributes accepted by a telemetry tracker. */
export type TelemetryParams = Record<string, string | number | boolean>;

/** Optional interface for host-provided usage telemetry. */
export interface TelemetryTracker {
  trackPageView?(pagePath?: string): void;
  trackEvent(eventName: string, params?: TelemetryParams): void;
}

/**
 * Multi-deployment extension token for optional telemetry.
 * Unprovided (null) in the open-source entrypoint.
 */
export const TELEMETRY_TRACKER = new InjectionToken<TelemetryTracker>('TELEMETRY_TRACKER');
