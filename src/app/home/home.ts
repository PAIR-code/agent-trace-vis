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
 * @fileoverview Landing page with navigation cards for each visualization mode.
 */

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterLink],
  template: `
    <div class="home-container">
      <div class="hero-section">
        <h2>Making Sense of Agentic Traces</h2>
        <p class="intro-text">
          Agentic reasoning traces are notoriously long and complex. This project provides visual tools to help researchers, engineers, and users understand AI behaviors.
        </p>
        <p class="sub-intro">
          Explore patterns, discover failure modes like looping, and analyze how models budget their time and tokens across many traces.
        </p>
      </div>
      <div class="card-grid">
        <div class="vis-card" routerLink="/agentic-traces/sample">
          <h3>Agentic traces</h3>
          <p>Explore a step-by-step reasoning trace (can include tools).</p>
        </div>
        <div class="vis-card" routerLink="/unstructured-reasoning-graph">
          <h3>Unstructured Reasoning (Graph)</h3>
          <p>View multiple rollouts of unstructured reasoning.</p>
        </div>
        <div class="vis-card" routerLink="/unstructured-reasoning-linear">
          <h3>Unstructured Reasoning (Linear)</h3>
          <p>View multiple rollouts of unstructured reasoning.</p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      padding: 24px;
    }

    .home-container {
      max-width: 1000px;
      margin: 0 auto;
    }

    .hero-section {
      margin-bottom: 40px;
      padding: 24px 0;
      border-bottom: 1px solid #eaeaea;
    }

    .hero-section h2 {
      font-size: 2rem;
      color: #3a506b;
      margin-top: 0;
      margin-bottom: 16px;
    }

    .intro-text {
      font-size: 1.2rem;
      line-height: 1.6;
      color: #444;
      margin-bottom: 16px;
    }

    .sub-intro {
      font-size: 1.05rem;
      line-height: 1.5;
      color: #666;
    }

    .card-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 24px;
      margin-top: 32px;
    }

    .vis-card {
      background: white;
      border-radius: 12px;
      padding: 24px;
      border: 1px solid #eee;
      box-shadow: 0 4px 6px rgba(0,0,0,0.05);
      transition: transform 0.2s, box-shadow 0.2s;
      cursor: pointer;
      height: 100%;
    }

    .vis-card:hover {
      transform: translateY(-4px);
      box-shadow: 0 8px 15px rgba(0,0,0,0.1);
      border-color: #3a506b;
    }

    .vis-card h3 {
      margin-top: 0;
      color: #3a506b;
    }

    .vis-card p {
      color: #666;
      line-height: 1.5;
    }
  `]
})
export class HomeComponent { }
