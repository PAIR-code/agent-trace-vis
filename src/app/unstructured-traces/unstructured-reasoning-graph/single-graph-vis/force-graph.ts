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
 * @fileoverview D3 force-directed graph layout for reasoning trace chunks,
 * with sequential backbone links and similarity-based edges.
 */

import * as d3 from 'd3';
import { renderMarkdownWithLatex } from '../../helpers';

/* ────────────────────────────────────────────────────────────
 * Types
 * ──────────────────────────────────────────────────────────── */

export interface ChunkNode extends d3.SimulationNodeDatum {
  id: number;
  text: string;
  /** Short preview label for the node */
  label: string;
  /** 0 = first step, n-1 = last step */
  stepIndex: number;
  /** Total number of steps */
  totalSteps: number;
  /** Index of the trace this node belongs to */
  traceIndex?: number;
}

export interface ChunkLink extends d3.SimulationLinkDatum<ChunkNode> {
  source: number | ChunkNode;
  target: number | ChunkNode;
  /** Similarity weight in [0, 1] */
  weight: number;
  /** 'sequential' for backbone links, 'similarity' for embedding links */
  type: 'sequential' | 'similarity';
  /** Whether this link connects nodes from different traces */
  isCrossTrace?: boolean;
}

/* ────────────────────────────────────────────────────────────
 * Tunable parameters  (easy to expose via UI sliders)
 * ──────────────────────────────────────────────────────────── */

export interface ForceConfig {
  /** Strength of sequential (backbone) links. */
  sequentialStrength: number;
  /** Ideal distance for sequential links. */
  sequentialDistance: number;
  /** Exponent for intra-trace similarity forces and opacity. */
  intraTraceExponent: number;
  /** Exponent for inter-trace similarity forces and opacity. */
  interTraceExponent: number;
  /** Node collision radius. */
  collisionRadius: number;
  /** Node visual radius. */
  nodeRadius: number;
  /** Whether internal structure lines exhibit forces. */
  applyIntraTraceForces: boolean;
  /** Whether orange lines (cross-trace similarity) exhibit forces. */
  applyCrossTraceForces: boolean;
}

export const DEFAULT_CONFIG: ForceConfig = {
  sequentialStrength: 1,
  sequentialDistance: 10,
  intraTraceExponent: 2,
  interTraceExponent: 50,
  collisionRadius: 5,
  nodeRadius: 6,
  applyIntraTraceForces: false,
  applyCrossTraceForces: false,
};

/* ────────────────────────────────────────────────────────────
 * Colour helpers
 * ──────────────────────────────────────────────────────────── */




/* ────────────────────────────────────────────────────────────
 * Builder
 * ──────────────────────────────────────────────────────────── */

export function buildForceGraph(
  container: HTMLElement,
  chunks: string[],
  similarityMatrix: number[][],
  config: ForceConfig = DEFAULT_CONFIG,
  onNodeClick?: (index: number) => void,
  onHover?: (index: number | null) => void,
  traceColor?: string,
  traceRanges?: Array<{ start: number, end: number }>,
  traceColors?: string[],
): { destroy: () => void; updateConfig: (c: Partial<ForceConfig>) => void } {

  // ── 1. Build nodes ───────────────────────────────────────
  const nodes: ChunkNode[] = chunks.map((text, i) => {
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
    return {
      id: i,
      text,
      label: truncateLabel(text, 32),
      stepIndex: localStepIndex,
      totalSteps: traceRanges ? traceRanges[traceIndex].end - traceRanges[traceIndex].start : chunks.length,
      traceIndex,
    };
  });

  // ── 2. Build links ──────────────────────────────────────
  const links: ChunkLink[] = [];

  // Sequential backbone links
  if (traceRanges) {
    for (const range of traceRanges) {
      for (let i = range.start; i < range.end - 1; i++) {
        links.push({ source: i, target: i + 1, weight: 1, type: 'sequential' });
      }
    }
  } else {
    for (let i = 0; i < nodes.length - 1; i++) {
      links.push({ source: i, target: i + 1, weight: 1, type: 'sequential' });
    }
  }

  // Similarity links (skip adjacent pairs since backbone handles them)
  const intraLinks: ChunkLink[] = [];
  const interLinks: ChunkLink[] = [];

  for (let i = 0; i < similarityMatrix.length; i++) {
    for (let j = i + 1; j < similarityMatrix[i].length; j++) {
      const nodeI = nodes[i];
      const nodeJ = nodes[j];
      
      let areAdjacent = false;
      let sameTrace = false;
      
      if (nodeI.traceIndex === nodeJ.traceIndex) {
        sameTrace = true;
        if (Math.abs(nodeI.stepIndex - nodeJ.stepIndex) === 1) {
          areAdjacent = true;
        }
      }

      if (areAdjacent) continue;

      const sim = similarityMatrix[i][j];
      const link: ChunkLink = { 
        source: i, 
        target: j, 
        weight: sim, 
        type: 'similarity',
        isCrossTrace: !sameTrace
      };

      if (sameTrace) {
        intraLinks.push(link);
      } else {
        interLinks.push(link);
      }
    }
  }

  // Keep top 50% for each category
  intraLinks.sort((a, b) => b.weight - a.weight);
  interLinks.sort((a, b) => b.weight - a.weight);

  const topIntraCount = Math.ceil(intraLinks.length * 0.5);
  const topInterCount = Math.ceil(interLinks.length * 0.5);

  const slicedIntra = intraLinks.slice(0, topIntraCount);
  for (const l of slicedIntra) {
    links.push(l);
  }

  const slicedInter = interLinks.slice(0, topInterCount);
  for (const l of slicedInter) {
    links.push(l);
  }

  // Resolve indices to node objects for all links
  links.forEach(l => {
    if (typeof l.source === 'number') l.source = nodes[l.source];
    if (typeof l.target === 'number') l.target = nodes[l.target];
  });

  // ── 3. Dimensions ──────────────────────────────────────
  const rect = container.getBoundingClientRect();
  const width = rect.width || 800;
  const height = rect.height || 600;
  const margin = 20;

  // ── 4. SVG setup ───────────────────────────────────────
  // Clean up any existing SVGs to prevent duplicate graphs
  d3.select(container).selectAll('svg').remove();

  const svg = d3.select(container)
    .append('svg')
    .attr('width', '100%')
    .attr('height', '100%')
    .attr('viewBox', `0 0 ${width} ${height}`)
    .attr('preserveAspectRatio', 'xMidYMid meet');

  // Defs for glow filter & arrowheads
  const defs = svg.append('defs');

  // Glow filter for nodes
  const filter = defs.append('filter')
    .attr('id', 'node-glow')
    .attr('x', '-50%').attr('y', '-50%')
    .attr('width', '200%').attr('height', '200%');
  filter.append('feGaussianBlur').attr('stdDeviation', '3').attr('result', 'blur');
  filter.append('feMerge')
    .selectAll('feMergeNode')
    .data(['blur', 'SourceGraphic'])
    .enter()
    .append('feMergeNode')
    .attr('in', d => d);

  // Arrow marker for sequential links
  defs.append('marker')
    .attr('id', 'arrow-seq')
    .attr('viewBox', '0 -5 10 10')
    .attr('refX', config.nodeRadius + 10)
    .attr('refY', 0)
    .attr('markerWidth', 6)
    .attr('markerHeight', 6)
    .attr('orient', 'auto')
    .append('path')
    .attr('d', 'M0,-5L10,0L0,5')
    .attr('fill', traceColor || 'rgba(0, 0, 0, 0.7)');

  // Root <g> for zoom/pan
  const g = svg.append('g');

  // Zoom behaviour
  const zoom = d3.zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.2, 5])
    .on('zoom', (event) => g.attr('transform', event.transform));
  svg.call(zoom);

  // ── 5. Draw links ─────────────────────────────────────
  const linkGroup = g.append('g').attr('class', 'links');

  // 1. Similarity links as straight lines (Drawn FIRST to be under)
  const similarityLinks = links.filter(l => l.type === 'similarity');
  const simLinkSel = linkGroup.selectAll<SVGLineElement, ChunkLink>('line')
    .data(similarityLinks)
    .enter()
    .append('line')
    .attr('stroke', d => {
      if (d.isCrossTrace) {
        return config.applyCrossTraceForces ? `rgba(255, 165, 0, ${Math.pow(d.weight, config.interTraceExponent)})` : 'rgba(0,0,0,0)';
      } else {
        return config.applyIntraTraceForces ? `rgba(150, 150, 150, ${Math.pow(d.weight, config.intraTraceExponent)})` : 'rgba(0,0,0,0)';
      }
    })
    .attr('stroke-width', d => Math.max(0.5, d.weight * 2));

  // 2. Sequential backbone as curved paths
  const backboneLineGen = d3.line<ChunkNode>()
    .x(d => d.x!)
    .y(d => d.y!)
    .curve(d3.curveCardinal.tension(0.1));

  if (traceRanges) {
    traceRanges.forEach((range, idx) => {
      const traceNodes = nodes.slice(range.start, range.end);
      const color = traceColors && traceColors[idx] ? traceColors[idx] : 'rgba(0, 0, 0, 0.7)';
      
      // White outline
      linkGroup.append('path')
        .datum(traceNodes)
        .attr('class', 'backbone-path-outline')
        .attr('fill', 'none')
        .attr('stroke', 'white')
        .attr('stroke-width', 12)
        .attr('d', backboneLineGen);

      linkGroup.append('path')
        .datum(traceNodes)
        .attr('class', 'backbone-path')
        .attr('fill', 'none')
        .attr('stroke', color)
        .attr('stroke-width', 6)
        .attr('d', backboneLineGen);
    });
  } else {
    const backboneColor = traceColor || 'rgba(0, 0, 0, 0.7)';
    
    // White outline
    linkGroup.append('path')
      .datum(nodes)
      .attr('class', 'backbone-path-outline')
      .attr('fill', 'none')
      .attr('stroke', 'white')
      .attr('stroke-width', 12)
      .attr('d', backboneLineGen);

    linkGroup.append('path')
      .datum(nodes)
      .attr('class', 'backbone-path')
      .attr('fill', 'none')
      .attr('stroke', backboneColor)
      .attr('stroke-width', 6)
      .attr('d', backboneLineGen);
  }

  // Invisible hit areas for backbone edges
  const sequentialLinks = links.filter(l => l.type === 'sequential');
  const backboneHitAreas = linkGroup.selectAll<SVGLineElement, ChunkLink>('.backbone-hit')
    .data(sequentialLinks)
    .enter()
    .append('line')
    .attr('class', 'backbone-hit')
    .attr('stroke', 'transparent')
    .attr('stroke-width', 15)
    .attr('pointer-events', 'stroke')
    .attr('cursor', 'pointer');

  // ── 6. Draw nodes ─────────────────────────────────────
  const nodeGroup = g.append('g').attr('class', 'nodes');

  const nodeSel = nodeGroup.selectAll<SVGGElement, ChunkNode>('g')
    .data(nodes)
    .enter()
    .append('g')
    .attr('cursor', 'pointer')
    .call(
      d3.drag<SVGGElement, ChunkNode>()
        .on('start', dragStarted)
        .on('drag', dragged)
        .on('end', dragEnded)
    )
    .on('click', (_event, d) => onNodeClick?.(d.id));

  // Node circles
  nodeSel.append('circle')
    .attr('r', config.nodeRadius)
    .attr('fill', d => {
      const idx = d.traceIndex ?? 0;
      return traceColors && traceColors[idx] ? traceColors[idx] : 'rgba(0, 0, 0, 0.7)';
    });



  // Tooltip on hover — shows chunk preview
  const tooltip = d3.select(container)
    .append('div')
    .attr('class', 'force-tooltip rendered-md')
    .style('position', 'absolute')
    .style('pointer-events', 'none')
    .style('opacity', 0)
    .style('background', 'rgba(20, 20, 30, 0.95)')
    .style('color', '#e0e0e0')
    .style('padding', '10px 14px')
    .style('border-radius', '8px')
    .style('font-size', '12px')
    .style('max-width', '320px')
    .style('line-height', '1.45')
    .style('box-shadow', '0 4px 20px rgba(0,0,0,0.5)')
    .style('border', '1px solid rgba(255,255,255,0.1)')
    .style('z-index', '1000')
    .style('backdrop-filter', 'blur(8px)');

  nodeSel
    .on('mouseenter', (event, d) => {
      tooltip
        .html(renderMarkdownWithLatex(d.text))
        .style('opacity', 1);
      onHover?.(d.stepIndex);
    })
    .on('mousemove', (event) => {
      const containerRect = container.getBoundingClientRect();
      tooltip
        .style('left', `${event.clientX - containerRect.left + 14}px`)
        .style('top', `${event.clientY - containerRect.top - 10}px`);
    })
    .on('mouseleave', () => {
      tooltip.style('opacity', 0);
      onHover?.(null);
    });

  // Backbone edge hover behavior: show tooltip and notify hover
  backboneHitAreas
    .on('mouseenter', function(event, d) {
      const sourceNode = d.source as ChunkNode;
      tooltip
        .html(renderMarkdownWithLatex(sourceNode.text))
        .style('opacity', 1);
      onHover?.(sourceNode.stepIndex);
    })
    .on('mousemove', function(event) {
      const containerRect = container.getBoundingClientRect();
      tooltip
        .style('left', `${event.clientX - containerRect.left + 14}px`)
        .style('top', `${event.clientY - containerRect.top - 10}px`);
    })
    .on('mouseleave', function() {
      tooltip.style('opacity', 0);
      onHover?.(null);
    })
    .on('click', function(event, d) {
      const sourceNode = d.source as ChunkNode;
      onNodeClick?.(sourceNode.id);
    });

  // ── 7. Force simulation ────────────────────────────────
  const simulation = d3.forceSimulation<ChunkNode>(nodes)
    .force('link-seq', d3.forceLink<ChunkNode, ChunkLink>(
      links.filter(l => l.type === 'sequential'))
      .id(d => d.id)
      .distance(config.sequentialDistance)
      .strength(config.sequentialStrength))
    .force('link-sim', d3.forceLink<ChunkNode, ChunkLink>(
      links.filter(l => l.type === 'similarity'))
      .id(d => d.id)
      .distance(d => 120 * (1 - (d as ChunkLink).weight))
      .strength(d => {
        const link = d as ChunkLink;
        if (link.isCrossTrace) {
          return config.applyCrossTraceForces ? Math.pow(link.weight, config.interTraceExponent) : 0;
        } else {
          return config.applyIntraTraceForces ? Math.pow(link.weight, config.intraTraceExponent) : 0;
        }
      }))
    .force('collision', config.collisionRadius > 0 ? d3.forceCollide<ChunkNode>(config.collisionRadius) : null)
    .force('x', d3.forceX<ChunkNode>()
      .x(d => {
        const numTraces = traceRanges ? traceRanges.length : 1;
        return width * ((d.traceIndex ?? 0) + 0.5) / numTraces;
      })
      .strength(0.1))
    .alphaDecay(0.02)
    .on('tick', ticked);

  // Initialize positions in columns to give the simulation a head start
  const numTraces = traceRanges ? traceRanges.length : 1;
  nodes.forEach((n, i) => {
    const colX = width * ((n.traceIndex ?? 0) + 0.5) / numTraces;
    n.x = colX + (Math.random() - 0.5) * 40;
    n.y = margin + (n.stepIndex / Math.max(1, n.totalSteps - 1)) * (height - 2 * margin);
    
    // Pin first and last steps
    if (n.stepIndex === 0 || n.stepIndex === n.totalSteps - 1) {
      n.fx = config.applyCrossTraceForces ? null : colX;
      n.fy = n.stepIndex === 0 ? margin : height - margin;
    }
  });
  simulation.alpha(1).restart();

  function ticked() {
    // Update backbone hit areas
    backboneHitAreas
      .attr('x1', d => (d.source as ChunkNode).x!)
      .attr('y1', d => (d.source as ChunkNode).y!)
      .attr('x2', d => (d.target as ChunkNode).x!)
      .attr('y2', d => (d.target as ChunkNode).y!);

    // Update similarity links
    simLinkSel
      .attr('x1', d => (d.source as ChunkNode).x!)
      .attr('y1', d => (d.source as ChunkNode).y!)
      .attr('x2', d => (d.target as ChunkNode).x!)
      .attr('y2', d => (d.target as ChunkNode).y!);

    // Update backbone path
    linkGroup.selectAll<SVGPathElement, ChunkNode[]>('.backbone-path-outline').attr('d', d => backboneLineGen(d));
    linkGroup.selectAll<SVGPathElement, ChunkNode[]>('.backbone-path').attr('d', d => backboneLineGen(d));

    nodeSel.attr('transform', d => `translate(${d.x},${d.y})`);
  }

  // ── 8. Drag handlers ──────────────────────────────────
  function dragStarted(event: d3.D3DragEvent<SVGGElement, ChunkNode, ChunkNode>, d: ChunkNode) {
    if (!event.active) simulation.alphaTarget(0.3).restart();
    d.fx = d.x;
    d.fy = d.y;
  }
  function dragged(event: d3.D3DragEvent<SVGGElement, ChunkNode, ChunkNode>, d: ChunkNode) {
    d.fx = event.x;
    d.fy = event.y;
  }
  function dragEnded(event: d3.D3DragEvent<SVGGElement, ChunkNode, ChunkNode>, d: ChunkNode) {
    if (!event.active) simulation.alphaTarget(0);
    if (d.stepIndex === 0 || d.stepIndex === d.totalSteps - 1) {
      const colX = width * ((d.traceIndex ?? 0) + 0.5) / numTraces;
      d.fx = config.applyCrossTraceForces ? null : colX;
      d.fy = d.stepIndex === 0 ? margin : height - margin;
    } else {
      d.fx = null;
      d.fy = null;
    }
  }

  // ── 9. Public API: live config update ──────────────────
  function updateConfig(patch: Partial<ForceConfig>) {
    // Ensure numeric values from range inputs
    if (patch.sequentialStrength !== undefined) patch.sequentialStrength = +patch.sequentialStrength;
    if (patch.sequentialDistance !== undefined) patch.sequentialDistance = +patch.sequentialDistance;
    if (patch.intraTraceExponent !== undefined) patch.intraTraceExponent = +patch.intraTraceExponent;
    if (patch.interTraceExponent !== undefined) patch.interTraceExponent = +patch.interTraceExponent;
    if (patch.collisionRadius !== undefined) patch.collisionRadius = +patch.collisionRadius;
    if (patch.nodeRadius !== undefined) patch.nodeRadius = +patch.nodeRadius;

    Object.assign(config, patch);

    // Update pinned status of nodes based on cross-trace flag
    nodes.forEach(n => {
      if (n.stepIndex === 0 || n.stepIndex === n.totalSteps - 1) {
        const colX = width * ((n.traceIndex ?? 0) + 0.5) / numTraces;
        n.fx = config.applyCrossTraceForces ? null : colX;
      }
    });

    // Update link opacity
    simLinkSel.attr('stroke', d => {
      if (d.isCrossTrace) {
        return config.applyCrossTraceForces ? `rgba(255, 165, 0, ${Math.pow(d.weight, config.interTraceExponent)})` : 'rgba(0,0,0,0)';
      } else {
        return config.applyIntraTraceForces ? `rgba(150, 150, 150, ${Math.pow(d.weight, config.intraTraceExponent)})` : 'rgba(0,0,0,0)';
      }
    });

    if (config.collisionRadius > 0) {
      simulation.force('collision', d3.forceCollide<ChunkNode>(config.collisionRadius));
    } else {
      simulation.force('collision', null);
    }

    const seqForce = simulation.force('link-seq') as d3.ForceLink<ChunkNode, ChunkLink>;
    if (seqForce) {
      seqForce.distance(config.sequentialDistance).strength(config.sequentialStrength);
    }
    const simForce = simulation.force('link-sim') as d3.ForceLink<ChunkNode, ChunkLink>;
    if (simForce) {
      simForce.strength(d => {
        const link = d as ChunkLink;
        if (link.isCrossTrace) {
          return config.applyCrossTraceForces ? Math.pow(link.weight, config.interTraceExponent) : 0;
        } else {
          return config.applyIntraTraceForces ? Math.pow(link.weight, config.intraTraceExponent) : 0;
        }
      });
    }

    simulation.alpha(0.5).restart();
  }

  function destroy() {
    simulation.stop();
    svg.remove();
    tooltip.remove();
  }

  return { destroy, updateConfig };
}

/* ────────────────────────────────────────────────────────────
 * Helpers
 * ──────────────────────────────────────────────────────────── */

function truncateLabel(text: string, max: number): string {
  const clean = text.replace(/\n/g, ' ').trim();
  return clean.length > max ? clean.slice(0, max) + '…' : clean;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
