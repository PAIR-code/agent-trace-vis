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
 * Minimal type declaration for `3d-force-graph`.
 * Only the subset of the API used by force-graph-3d.ts is declared here.
 */
declare module '3d-force-graph' {
  interface ForceGraph3DInstance {
    (element: HTMLElement): ForceGraph3DInstance;

    // Data
    graphData(data: { nodes: any[]; links: any[] }): ForceGraph3DInstance;
    graphData(): { nodes: any[]; links: any[] };

    // Container
    width(w: number): ForceGraph3DInstance;
    width(): number;
    height(h: number): ForceGraph3DInstance;
    height(): number;
    backgroundColor(color: string): ForceGraph3DInstance;

    // Node styling
    nodeVal(val: number | ((node: any) => number)): ForceGraph3DInstance;
    nodeColor(color: string | ((node: any) => string)): ForceGraph3DInstance;
    nodeOpacity(opacity: number): ForceGraph3DInstance;
    nodeLabel(label: string | ((node: any) => string)): ForceGraph3DInstance;

    // Link styling
    linkColor(color: string | ((link: any) => string)): ForceGraph3DInstance;
    linkWidth(width: number | ((link: any) => number)): ForceGraph3DInstance;
    linkOpacity(opacity: number): ForceGraph3DInstance;
    linkDirectionalArrowLength(len: number | ((link: any) => number)): ForceGraph3DInstance;

    // Events
    onNodeClick(callback: (node: any, event: MouseEvent) => void): ForceGraph3DInstance;
    onNodeHover(callback: (node: any | null, prevNode: any | null) => void): ForceGraph3DInstance;
    onLinkClick(callback: (link: any, event: MouseEvent) => void): ForceGraph3DInstance;
    onLinkHover(callback: (link: any | null, prevLink: any | null) => void): ForceGraph3DInstance;

    // Camera
    cameraPosition(position: { x: number; y: number; z: number }, lookAt?: { x: number; y: number; z: number }, transitionMs?: number): ForceGraph3DInstance;
    camera(): any;
    scene(): any;

    // Controls (Three.js OrbitControls / TrackballControls)
    controls(): any;

    // Force engine
    d3Force(forceName: string): any;
    d3Force(forceName: string, force: any): ForceGraph3DInstance;
    d3ReheatSimulation(): ForceGraph3DInstance;

    // Internal cleanup (may not exist on all versions)
    _destructor?: () => void;
  }

  export default function ForceGraph3D(configOptions?: {
    controlType?: 'trackball' | 'orbit' | 'fly';
    rendererConfig?: object;
  }): ForceGraph3DInstance;
}

declare module 'three' {
  const any: any;
  export = any;
}
