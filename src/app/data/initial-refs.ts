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
 * @fileoverview Hook for deployments to add datasets to the initial workspace,
 * e.g. by translating their own older URL formats into dataset refs.
 */

import { InjectionToken } from '@angular/core';
import { DatasetRef } from './dataset-refs';

/** Returns extra datasets (and selections) to load when the app opens. */
export const INITIAL_DATASET_REFS = new InjectionToken<() => DatasetRef[]>('INITIAL_DATASET_REFS');
