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
 * @fileoverview Angular component wrapping a single force-directed graph
 * visualization of reasoning trace chunks.
 */

import {
  Component, Input, Output, EventEmitter, ElementRef, ViewChild, OnChanges,
  SimpleChanges, OnDestroy, ChangeDetectorRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { segmentReasoningTrace, tokenize } from '../../tokenizer';
import { EmbeddingService } from './embedding.service';
import { buildForceGraph, DEFAULT_CONFIG, ForceConfig } from './force-graph';
import { buildForceGraph3D } from './force-graph-3d';

@Component({
  selector: 'app-single-graph-vis',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './single-graph-vis.html',
  styleUrls: ['./single-graph-vis.css'],
})
export class SingleGraphVisComponent implements OnChanges, OnDestroy {
  @Input() data: any;
  /** Optional color override for backbone/nodes in compare mode */
  @Input() traceColor: string | null = null;
  @Input() dataItems: any[] = [];
  @Input() traceColors: string[] = [];
  /** When true, hides the controls panel (parent provides shared controls) */
  @Input() hideControls = false;
  @Input() simpleMode = true;
  @Input() chunkBy: 'steps' | 'paragraphs' | 'word' | 'sentence' | 'word_context' = 'steps';
  @Output() chunkHover = new EventEmitter<number | null>();
  @Output() traceClick = new EventEmitter<{ chunkIndex: number; traceIndex?: number }>();

  @ViewChild('graphContainer', { static: true })
  graphContainerRef!: ElementRef<HTMLElement>;

  /** Current status message for the loading indicator */
  status = '';
  isLoading = false;

  /** Chunks derived from the input data */
  chunks: string[] = [];

  /** Similarity matrix for display / debug */
  similarityMatrix: number[][] = [];
  private traceRanges: Array<{ start: number, end: number }> = [];

  /** Exposed config for the controls panel */
  config: ForceConfig = { ...DEFAULT_CONFIG };

  showInternalStructure = false;
  /** EXPERIMENTAL: toggle between 2D (SVG/d3) and 3D (WebGL/three.js) */
  @Input() use3D = false;
  @Input() similarityMethod: 'semantic' | 'lexical' = 'semantic';

  /** Handle returned by buildForceGraph */
  private graphHandle: { destroy: () => void; updateConfig: (c: Partial<ForceConfig>) => void } | null = null;

  constructor(
    private embeddingService: EmbeddingService,
    private cdr: ChangeDetectorRef,
  ) { }

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['data'] || changes['dataItems'] || changes['traceColors'] || changes['chunkBy'] || changes['use3D']) && (this.data || this.dataItems.length > 0)) {
      this.rebuild();
    }
  }

  ngOnDestroy() {
    this.destroyGraph();
  }

  /** Full pipeline: segment → embed → similarity → render */
  private async rebuild() {
    this.destroyGraph();

    const items = this.dataItems && this.dataItems.length > 0 ? this.dataItems : [this.data];
    const validItems = items.filter(Boolean);
    if (validItems.length === 0) {
      this.status = 'No reasoning trace available.';
      this.cdr.detectChanges();
      return;
    }

    this.isLoading = true;
    this.status = 'Segmenting traces…';
    this.cdr.detectChanges();

    this.chunks = [];
    const allAugmentedChunks: string[] = [];
    this.traceRanges = [];
    let currentOffset = 0;

    for (const item of validItems) {
      const rawText = item.code || item.solution || '';
      
      let chunks: string[] = [];
      let textsToEmbed: string[] = [];

      if (this.chunkBy === 'steps') {
        chunks = segmentReasoningTrace(rawText, this.simpleMode);
        textsToEmbed = this.simpleMode ? chunks : chunks.map((chunk, i) => {
          const prev = i > 0 ? chunks[i - 1] : '';
          const next = i < chunks.length - 1 ? chunks[i + 1] : '';
          return [prev, chunk, next].filter(Boolean).join(' ');
        });
      } else if (this.chunkBy === 'paragraphs') {
        chunks = rawText.split('\n').map((s: string) => s.trim()).filter(Boolean);
        textsToEmbed = chunks;
      } else if (this.chunkBy === 'word') {
        chunks = tokenize(rawText, 'word');
        textsToEmbed = chunks;
      } else if (this.chunkBy === 'sentence') {
        chunks = tokenize(rawText, 'sentence');
        textsToEmbed = chunks;
      } else if (this.chunkBy === 'word_context') {
        chunks = tokenize(rawText, 'word_context');
        textsToEmbed = chunks;
      }
      
      this.chunks.push(...chunks);
      allAugmentedChunks.push(...textsToEmbed);
      this.traceRanges.push({ start: currentOffset, end: currentOffset + chunks.length });
      currentOffset += chunks.length;
    }

    if (this.chunks.length === 0) {
      this.status = 'Segmentation produced no chunks.';
      this.isLoading = false;
      this.cdr.detectChanges();
      return;
    }

    try {
      if (this.similarityMethod === 'semantic') {
        this.status = 'Loading model…';
        this.cdr.detectChanges();
        await new Promise(r => setTimeout(r, 50));
        
        await this.embeddingService.ensureLoaded();

        this.status = `Embedding ${this.chunks.length} chunks…`;
        this.cdr.detectChanges();
        await new Promise(r => setTimeout(r, 50));

        const embeddings = await this.embeddingService.embed(allAugmentedChunks);

        this.status = 'Computing similarity matrix…';
        this.cdr.detectChanges();
        await new Promise(r => setTimeout(r, 50));
        this.similarityMatrix = this.embeddingService.cosineSimilarityMatrix(embeddings);
      } else {
        this.status = 'Computing Jaccard similarity…';
        this.cdr.detectChanges();
        await new Promise(r => setTimeout(r, 10));
        this.similarityMatrix = this.embeddingService.jaccardSimilarityMatrix(allAugmentedChunks);
      }

      // 4. Render force graph
      this.status = '';
      this.isLoading = false;
      this.cdr.detectChanges();

      // Wait for DOM to settle
      await new Promise(r => setTimeout(r, 50));

      const builder = this.use3D ? buildForceGraph3D : buildForceGraph;
      this.graphHandle = builder(
        this.graphContainerRef.nativeElement,
        this.chunks,
        this.similarityMatrix,
        this.config,
        (index) => {
          let traceIndex = 0;
          let localIndex = index;
          if (this.traceRanges) {
            for (let i = 0; i < this.traceRanges.length; i++) {
              if (index >= this.traceRanges[i].start && index < this.traceRanges[i].end) {
                traceIndex = i;
                localIndex = index - this.traceRanges[i].start;
                break;
              }
            }
          }
          this.traceClick.emit({ chunkIndex: localIndex, traceIndex });
          this.cdr.detectChanges();
        },
        (hoverIndex) => {
          this.chunkHover.emit(hoverIndex);
        },
        this.traceColor ?? undefined,
        this.traceRanges,
        this.traceColors,
      );
    } catch (err) {
      console.error('Embedding error:', err);
      this.status = 'Embedding failed — see console for details.';
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  /** Called from the controls panel when a slider changes */
  onConfigChange() {
    if (this.graphHandle) {
      this.graphHandle.updateConfig(this.config);
    }
  }

  /** Rebuild with a new similarity threshold (needs full re-render) */
  onThresholdChange() {
    // Threshold changes require a full rebuild because the link set changes
    if (this.chunks.length > 0 && this.similarityMatrix.length > 0) {
      this.destroyGraph();
      // Wait for DOM to settle
      setTimeout(() => {
        const builder = this.use3D ? buildForceGraph3D : buildForceGraph;
        this.graphHandle = builder(
          this.graphContainerRef.nativeElement,
          this.chunks,
          this.similarityMatrix,
          this.config,
          (index) => {
            let traceIndex = 0;
            let localIndex = index;
            if (this.traceRanges) {
              for (let i = 0; i < this.traceRanges.length; i++) {
                if (index >= this.traceRanges[i].start && index < this.traceRanges[i].end) {
                  traceIndex = i;
                  localIndex = index - this.traceRanges[i].start;
                  break;
                }
              }
            }
            this.traceClick.emit({ chunkIndex: localIndex, traceIndex });
            this.cdr.detectChanges();
          },
          (hoverIndex) => {
            this.chunkHover.emit(hoverIndex);
          },
          this.traceColor ?? undefined,
          this.traceRanges,
          this.traceColors,
        );
      }, 50);
    }
  }

  onShowInternalStructureChange(show: boolean) {
    this.config = {
      ...this.config,
      applyIntraTraceForces: show,
    };
    this.onConfigChange();
  }

  onShowCrossTraceChange(show: boolean) {
    this.config = {
      ...this.config,
      applyCrossTraceForces: show,
    };
    this.onConfigChange();
  }

  onSimilarityMethodChange() {
    this.rebuild();
  }

  /** EXPERIMENTAL: toggle 2D ↔ 3D and rebuild the graph */
  onToggle3D() {
    this.rebuild();
  }

  private destroyGraph() {
    if (this.graphHandle) {
      this.graphHandle.destroy();
      this.graphHandle = null;
    }
  }
}
