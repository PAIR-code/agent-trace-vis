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
 * @fileoverview Top-level route definitions for agentic and unstructured trace views.
 */

import { Routes } from '@angular/router';
import { HomeComponent } from './home/home';
import { AgenticTracesComponent } from './agentic-traces/agentic-traces';
import { UnstructuredReasoningGraphComponent } from './unstructured-traces/unstructured-reasoning-graph/unstructured-reasoning-graph';
import { UnstructuredReasoningLinearComponent } from './unstructured-traces/unstructured-reasoning-linear/unstructured-reasoning-linear';
import { ConversationArcsComponent } from './conversation-arcs/conversation-arcs';

export const routes: Routes = [
  { path: '', component: HomeComponent },
  { path: 'agentic-traces/:id', component: AgenticTracesComponent },
  { path: 'unstructured-reasoning-graph', component: UnstructuredReasoningGraphComponent },
  { path: 'unstructured-reasoning-linear', component: UnstructuredReasoningLinearComponent },
  { path: 'conversation-arcs', component: ConversationArcsComponent },
];

