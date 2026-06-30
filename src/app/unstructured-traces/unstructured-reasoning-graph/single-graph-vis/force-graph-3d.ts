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
 * @fileoverview EXPERIMENTAL 3D force-directed graph layout for reasoning
 * trace chunks, using the `3d-force-graph` library (ThreeJS + d3-force-3d).
 *
 * This is a self-contained alternative to `force-graph.ts` (2D). It exposes
 * the same public API so the component can swap between them via a checkbox.
 *
 * NOTE: This file deliberately duplicates some node/link building logic from
 * force-graph.ts to keep the two modules fully independent (the 2D module
 * should remain untouched if this experiment is removed).
 */

import ForceGraph3D from '3d-force-graph';
import * as THREE from 'three';
import { ForceConfig, DEFAULT_CONFIG } from './force-graph';
import { renderMarkdownWithLatex } from '../../helpers';

/* ────────────────────────────────────────────────────────────
 * Internal node / link types  (mirrors force-graph.ts)
 * ──────────────────────────────────────────────────────────── */

interface Node3D {
  id: number;
  text: string;
  label: string;
  stepIndex: number;
  totalSteps: number;
  traceIndex: number;
  color: string;
  // Populated by d3-force-3d:
  x?: number;
  y?: number;
  z?: number;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

interface Link3D {
  source: number | Node3D;
  target: number | Node3D;
  weight: number;
  type: 'sequential' | 'similarity';
  isCrossTrace: boolean;
  color: string;
  width: number;
}

/* ────────────────────────────────────────────────────────────
 * Builder  (matches the signature of buildForceGraph in 2D)
 * ──────────────────────────────────────────────────────────── */

export function buildForceGraph3D(
  container: HTMLElement,
  chunks: string[],
  similarityMatrix: number[][],
  config: ForceConfig = DEFAULT_CONFIG,
  onNodeClick?: (index: number) => void,
  onHover?: (index: number | null) => void,
  traceColor?: string,
  traceRanges?: Array<{ start: number; end: number }>,
  traceColors?: string[],
): { destroy: () => void; updateConfig: (c: Partial<ForceConfig>) => void } {

  // ── 1. Build nodes ───────────────────────────────────────
  const nodes: Node3D[] = chunks.map((text, i) => {
    let traceIndex = 0;
    let localStepIndex = i;
    if (traceRanges) {
      for (let r = 0; r < traceRanges.length; r++) {
        if (i >= traceRanges[r].start && i < traceRanges[r].end) {
          traceIndex = r;
          localStepIndex = i - traceRanges[r].start;
          break;
        }
      }
    }
    const totalSteps = traceRanges
      ? traceRanges[traceIndex].end - traceRanges[traceIndex].start
      : chunks.length;

    return {
      id: i,
      text,
      label: truncateLabel(text, 32),
      stepIndex: localStepIndex,
      totalSteps,
      traceIndex,
      color: traceColors?.[traceIndex] ?? traceColor ?? 'rgba(100, 100, 100, 1)',
    };
  });

  // ── 2. Build links ──────────────────────────────────────
  const links: Link3D[] = [];

  // Sequential backbone
  if (traceRanges) {
    for (const range of traceRanges) {
      for (let i = range.start; i < range.end - 1; i++) {
        const color = traceColors?.[nodes[i].traceIndex] ?? traceColor ?? 'rgba(100,100,100,0.8)';
        links.push({
          source: i, target: i + 1, weight: 1,
          type: 'sequential', isCrossTrace: false,
          color, width: 4,
        });
      }
    }
  } else {
    const color = traceColor ?? 'rgba(100,100,100,0.8)';
    for (let i = 0; i < nodes.length - 1; i++) {
      links.push({
        source: i, target: i + 1, weight: 1,
        type: 'sequential', isCrossTrace: false,
        color, width: 4,
      });
    }
  }

  // Similarity links (same filtering as 2D version)
  const intraLinks: Link3D[] = [];
  const interLinks: Link3D[] = [];

  for (let i = 0; i < similarityMatrix.length; i++) {
    for (let j = i + 1; j < similarityMatrix[i].length; j++) {
      const nI = nodes[i];
      const nJ = nodes[j];
      let areAdjacent = false;
      let sameTrace = false;

      if (nI.traceIndex === nJ.traceIndex) {
        sameTrace = true;
        if (Math.abs(nI.stepIndex - nJ.stepIndex) === 1) areAdjacent = true;
      }
      if (areAdjacent) continue;

      const sim = similarityMatrix[i][j];
      const link: Link3D = {
        source: i, target: j, weight: sim,
        type: 'similarity',
        isCrossTrace: !sameTrace,
        color: 'rgba(0,0,0,0)',  // Set below based on config
        width: Math.max(0.5, sim * 2),
      };

      if (sameTrace) {
        intraLinks.push(link);
      } else {
        interLinks.push(link);
      }
    }
  }

  // Keep top 50 %
  intraLinks.sort((a, b) => b.weight - a.weight);
  interLinks.sort((a, b) => b.weight - a.weight);
  
  const slicedIntra = intraLinks.slice(0, Math.ceil(intraLinks.length * 0.5));
  for (const l of slicedIntra) {
    links.push(l);
  }

  const slicedInter = interLinks.slice(0, Math.ceil(interLinks.length * 0.5));
  for (const l of slicedInter) {
    links.push(l);
  }

  // Apply initial visibility based on config
  applySimilarityLinkColors(links, config);

  // ── 3. Dimensions ───────────────────────────────────────
  const rect = container.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 600;

  // ── 4. Build the 3D graph ───────────────────────────────
  // Clear any previous content (SVG from 2D mode, or previous 3D canvas)
  container.innerHTML = '';

  const graph = ForceGraph3D({ controlType: 'orbit' })(container)
    .width(width)
    .height(height)
    .backgroundColor('rgba(248, 249, 250, 1)')  // Match the 2D background
    .graphData({ nodes, links })

    // --- Node appearance (tiny, colored to match links for seamless connections) ---
    .nodeVal(0.2)
    .nodeColor((node: any) => (node as Node3D).color)
    .nodeOpacity(0.6)
    .nodeLabel(() => '')  // We use a custom tooltip below

    // --- Link appearance ---
    .linkColor((link: any) => (link as Link3D).color)
    .linkWidth((link: any) => (link as Link3D).width)
    .linkOpacity(0.6)

    // --- Node hover ---
    .onNodeHover((node: any) => {
      const n = node as Node3D | null;
      if (n) {
        showTooltip(n);
        onHover?.(n.stepIndex);
      } else {
        hideTooltip();
        onHover?.(null);
      }
    })

    // --- Node click ---
    .onNodeClick((node: any) => {
      onNodeClick?.((node as Node3D).id);
    })

    // --- Physics engine config (d3-force-3d via the .d3Force API) ---
    // Keep the built-in charge force for mild node repulsion, but weaken it
    // so that strong cross-trace links can pull similar nodes together.
    // Remove center force since we use pinned nodes for positioning.
    .d3Force('center', null as any);

  // Baseline repulsion: standard -30 for all node pairs.
  // Cross-trace link strengths are clamped to >= 0 (attraction only),
  // so high-similarity pairs overcome this repulsion and overlap,
  // while low-similarity pairs just feel the baseline repulsion.
  const chargeForce = graph.d3Force('charge');
  if (chargeForce) {
    chargeForce.strength(-30);
  }

  // Configure the built-in link force to handle both sequential and
  // similarity links via per-link distance/strength functions.
  configureForces(graph, config);

  // ── 5. Tooltip (HTML overlay, same style as 2D) ─────────
  const tooltip = document.createElement('div');
  tooltip.className = 'force-tooltip rendered-md';
  Object.assign(tooltip.style, {
    position: 'absolute',
    pointerEvents: 'none',
    opacity: '0',
    background: 'rgba(20, 20, 30, 0.95)',
    color: '#e0e0e0',
    padding: '10px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    maxWidth: '320px',
    lineHeight: '1.45',
    boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    border: '1px solid rgba(255,255,255,0.1)',
    zIndex: '1000',
    backdropFilter: 'blur(8px)',
    transition: 'opacity 0.15s',
  });
  container.appendChild(tooltip);

  // Track mouse for tooltip positioning
  const onMouseMove = (e: MouseEvent) => {
    const cr = container.getBoundingClientRect();
    tooltip.style.left = `${e.clientX - cr.left + 14}px`;
    tooltip.style.top = `${e.clientY - cr.top - 10}px`;
  };
  container.addEventListener('mousemove', onMouseMove);

  function showTooltip(node: Node3D) {
    tooltip.innerHTML = renderMarkdownWithLatex(node.text);
    tooltip.style.opacity = '1';
  }
  function hideTooltip() {
    tooltip.style.opacity = '0';
  }

  // ── 6. Position nodes along y-axis with fixed per-node spacing ──
  // Each node gets a fixed y-slot so longer chains are taller.
  const ySpacingPerNode = 30;  // fixed vertical gap between consecutive nodes
  const numTraces = traceRanges ? traceRanges.length : 1;

  // Find the longest chain first to calculate a global top Y level and camera distance
  let maxChainLen = 1;
  nodes.forEach(n => {
    if (n.totalSteps > maxChainLen) maxChainLen = n.totalSteps;
  });

  // Calculate the global top plane Y position so that the longest chain is
  // centered vertically around y = 0.
  const topY = ((maxChainLen - 1) * ySpacingPerNode) / 2;

  // Initialize node positions to help the simulation converge
  nodes.forEach(n => {
    const xSpacing = 80;

    n.x = (n.traceIndex - (numTraces - 1) / 2) * xSpacing + (Math.random() - 0.5) * 20;
    // All traces start at topY and hang downwards.
    n.y = topY - n.stepIndex * ySpacingPerNode;
    n.z = (Math.random() - 0.5) * 40;

    // Pin every node's y to maintain fixed vertical spacing
    n.fy = n.y;

    if (n.stepIndex === 0 || n.stepIndex === n.totalSteps - 1) {
      if (!config.applyCrossTraceForces) {
        n.fx = (n.traceIndex - (numTraces - 1) / 2) * xSpacing;
      }
    }
  });
  graph.graphData({ nodes, links });  // Push pin + position updates

  // Compute centroid so the camera orbits around the actual center of the graph
  const centroid = { x: 0, y: 0, z: 0 };
  nodes.forEach(n => {
    centroid.x += (n.x ?? 0);
    centroid.y += (n.y ?? 0);
    centroid.z += (n.z ?? 0);
  });
  centroid.x /= nodes.length;
  centroid.y /= nodes.length;
  centroid.z /= nodes.length;

  // Create and add the translucent top plane where the traces start
  const scene = graph.scene();
  if (scene) {
    const planeWidth = Math.max(400, numTraces * 100 + 100);
    const planeHeight = 400; // along Z (depth)
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    geometry.rotateX(-Math.PI / 2); // Make it horizontal on the X-Z plane

    const material = new THREE.MeshBasicMaterial({
      color: 0x94a3b8, // Slate color
      transparent: true,
      opacity: 0.2,
      side: THREE.DoubleSide
    });

    const topPlane = new THREE.Mesh(geometry, material);
    topPlane.position.set(centroid.x, topY, centroid.z);
    scene.add(topPlane);
  }

  // Reset to default Three.js Y-up convention
  const camera = graph.camera();
  if (camera) {
    camera.up.set(0, 1, 0);
  }

  // Position camera along the Z axis (looking from the front/depth)
  const cameraDistance = Math.max(350, maxChainLen * ySpacingPerNode * 1.5);
  graph.cameraPosition(
    { x: centroid.x, y: centroid.y, z: centroid.z + cameraDistance },
    centroid,
  );

  // Lock vertical tilt — turntable rotation only (orbit left/right around Y axis)
  const controls = graph.controls();
  if (controls) {
    controls.minPolarAngle = Math.PI / 2;
    controls.maxPolarAngle = Math.PI / 2;
  }

  // ── 7. Resize observer ────────────────────────────────
  const resizeObserver = new ResizeObserver(() => {
    const r = container.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) {
      graph.width(r.width).height(r.height);
    }
  });
  resizeObserver.observe(container);

  // ── 8. Public API ──────────────────────────────────────
  function updateConfig(patch: Partial<ForceConfig>) {
    if (patch.sequentialStrength !== undefined) patch.sequentialStrength = +patch.sequentialStrength;
    if (patch.sequentialDistance !== undefined) patch.sequentialDistance = +patch.sequentialDistance;
    if (patch.intraTraceExponent !== undefined) patch.intraTraceExponent = +patch.intraTraceExponent;
    if (patch.interTraceExponent !== undefined) patch.interTraceExponent = +patch.interTraceExponent;
    if (patch.collisionRadius !== undefined) patch.collisionRadius = +patch.collisionRadius;
    if (patch.nodeRadius !== undefined) patch.nodeRadius = +patch.nodeRadius;

    Object.assign(config, patch);

    // Update node pins
    nodes.forEach(n => {
      if (n.stepIndex === 0 || n.stepIndex === n.totalSteps - 1) {
        const spacing = 80;
        n.fx = config.applyCrossTraceForces ? null : (n.traceIndex - (numTraces - 1) / 2) * spacing;
      }
    });

    // Update link colors
    applySimilarityLinkColors(links, config);

    // Reconfigure forces
    configureForces(graph, config);

    // Push updates
    graph.graphData({ nodes, links });
    graph.d3ReheatSimulation();
  }

  function destroy() {
    resizeObserver.disconnect();
    container.removeEventListener('mousemove', onMouseMove);
    graph._destructor?.();
    container.innerHTML = '';
  }

  return { destroy, updateConfig };
}

/* ────────────────────────────────────────────────────────────
 * Force configuration helper
 *
 * Uses the graph's built-in `link` force with per-link distance and
 * strength functions to differentiate sequential vs similarity links.
 * ──────────────────────────────────────────────────────────── */

function configureForces(graph: any, config: ForceConfig) {
  // The library exposes the d3-force-3d link force via d3Force('link').
  const linkForce = graph.d3Force('link');
  if (linkForce) {
    linkForce
      .distance((d: Link3D) => {
        if (d.type === 'sequential') return config.sequentialDistance;
        // Cross-trace: distance 0 so high-similarity nodes can fully overlap
        if (d.isCrossTrace) return 0;
        return 120 * (1 - d.weight);
      })
      .strength((d: Link3D) => {
        if (d.type === 'sequential') return config.sequentialStrength;
        if (d.isCrossTrace) {
          if (!config.applyCrossTraceForces) return 0;
          // interTraceExponent (1-100) is used as a similarity cutoff in 3D mode.
          // Below cutoff: 0 (neutral — just baseline -30 charge repulsion).
          // Above cutoff: linear ramp 0 → maxStrength.
          //   maxStrength ~2.0 is enough to overcome -30 charge at close range.
          const cutoff = config.interTraceExponent / 100;
          if (d.weight < cutoff) return 0;
          const maxStrength = 2.0;
          return ((d.weight - cutoff) / Math.max(0.01, 1 - cutoff)) * maxStrength;
        }
        return config.applyIntraTraceForces ? Math.pow(d.weight, config.intraTraceExponent) : 0;
      });
  }
}

/* ────────────────────────────────────────────────────────────
 * Link colour helper
 * ──────────────────────────────────────────────────────────── */

function applySimilarityLinkColors(links: Link3D[], config: ForceConfig) {
  for (const link of links) {
    if (link.type !== 'similarity') continue;

    if (link.isCrossTrace) {
      if (!config.applyCrossTraceForces) {
        link.color = 'rgba(0,0,0,0)';
      } else {
        // Same cutoff logic as the force: invisible below, ramp above
        const cutoff = config.interTraceExponent / 100;
        if (link.weight < cutoff) {
          link.color = 'rgba(0,0,0,0)';
        } else {
          const alpha = (link.weight - cutoff) / Math.max(0.01, 1 - cutoff);
          link.color = `rgba(255, 165, 0, ${alpha.toFixed(3)})`;
        }
      }
    } else {
      link.color = config.applyIntraTraceForces
        ? `rgba(150, 150, 150, ${Math.pow(link.weight, config.intraTraceExponent)})`
        : 'rgba(0,0,0,0)';
    }
  }
}

/* ────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────── */

function truncateLabel(text: string, max: number): string {
  const clean = text.replace(/\n/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}
