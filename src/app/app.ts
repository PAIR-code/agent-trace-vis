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
 * @fileoverview Root AppComponent. Renders the top-level header and router outlet.
 */

import { Component } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, RouterLink],
  template: `
    <header>
      <h1 routerLink="/" style="cursor: pointer;">
        Agentic Trace
      </h1>
    </header>

    <main>
      <router-outlet></router-outlet>
    </main>
  `,
  styles: [`
    header {
      background: #3a506b;
      color: white;
      height: 64px;
      display: flex;
      align-items: center;
      box-shadow: 0 2px 5px 0 rgba(0, 0, 0, 0.16), 0 2px 10px 0 rgba(0, 0, 0, 0.12);
    }

    h1 {
      margin: 0;
      padding: 0 24px;
      font-size: 1.2rem;
      font-weight: 500;
      color: #fff;
    }

    main {
    }
  `]
})
export class AppComponent {
}
