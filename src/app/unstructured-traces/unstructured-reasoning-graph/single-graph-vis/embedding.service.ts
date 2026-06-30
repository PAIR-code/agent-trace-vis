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
 * @fileoverview Browser-side text embedding service using Transformers.js
 * (all-MiniLM-L6-v2) with localStorage caching and similarity computation.
 */

import { Injectable } from '@angular/core';
import {
  jaccardSimilarityMatrix as sharedJaccardMatrix,
} from '../../../shared/jaccard';

/**
 * Embedding service using Transformers.js with all-MiniLM-L6-v2.
 * Runs entirely in the browser via ONNX/WASM – no API key needed.
 * Model is ~22 MB and cached after first download.
 */
@Injectable({ providedIn: 'root' })
export class EmbeddingService {
  private pipeline: any = null;
  private loading = false;
  private loadPromise: Promise<void> | null = null;

  /** Lazily load the feature-extraction pipeline. */
  async ensureLoaded(): Promise<void> {
    if (this.pipeline) return;
    if (this.loadPromise) return this.loadPromise;

    this.loading = true;
    this.loadPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers');
      this.pipeline = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { dtype: 'q8' },
      );
      this.loading = false;
    })();
    return this.loadPromise;
  }

  get isLoading(): boolean {
    return this.loading;
  }

  private async hashText(text: string): Promise<string> {
    const encoder = new TextEncoder();
    const data = encoder.encode(text);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  private async getFromCache(text: string): Promise<Float32Array | null> {
    const hash = await this.hashText(text);
    const key = `emb_20_${hash}`;
    const cached = localStorage.getItem(key);
    if (cached) {
      try {
        const arr = JSON.parse(cached);
        return new Float32Array(arr);
      } catch (e) {
        console.error('Failed to parse cached embedding', e);
        return null;
      }
    }
    return null;
  }

  private async saveToCache(text: string, embedding: Float32Array) {
    const hash = await this.hashText(text);
    const key = `emb_20_${hash}`;
    const arr = Array.from(embedding);
    try {
      localStorage.setItem(key, JSON.stringify(arr));
    } catch (e) {
      console.warn('Failed to save to localStorage', e);
    }
  }

  /** Embed a list of texts. Returns an array of Float32Array vectors (truncated to 20 dims). */
  async embed(texts: string[]): Promise<Float32Array[]> {
    await this.ensureLoaded();
    const results: Float32Array[] = new Array(texts.length);
    const uncachedIndices: number[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cached = await this.getFromCache(texts[i]);
      if (cached) {
        results[i] = cached;
      } else {
        uncachedIndices.push(i);
      }
    }

    if (uncachedIndices.length > 0) {
      const uncachedTexts = uncachedIndices.map(i => texts[i]);
      const BATCH = 32;
      for (let i = 0; i < uncachedTexts.length; i += BATCH) {
        const batch = uncachedTexts.slice(i, i + BATCH);
        const output = await this.pipeline(batch, {
          pooling: 'mean',
          normalize: true,
        });
        for (let j = 0; j < batch.length; j++) {
          const fullEmbedding = output[j].data;
          const truncated = fullEmbedding.slice(0, 20);

          // Re-normalize
          let norm = 0;
          for (let k = 0; k < 20; k++) {
            norm += truncated[k] * truncated[k];
          }
          norm = Math.sqrt(norm);
          const normalized = new Float32Array(20);
          if (norm > 0) {
            for (let k = 0; k < 20; k++) {
              normalized[k] = truncated[k] / norm;
            }
          }

          const origIndex = uncachedIndices[i + j];
          results[origIndex] = normalized;
          await this.saveToCache(batch[j], normalized);
        }
      }
    }
    return results;
  }

  /** Compute the full cosine similarity matrix. Vectors must be L2-normalized. */
  cosineSimilarityMatrix(embeddings: Float32Array[]): number[][] {
    const n = embeddings.length;
    const matrix: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      matrix[i][i] = 1;
      for (let j = i + 1; j < n; j++) {
        let dot = 0;
        for (let k = 0; k < embeddings[i].length; k++) {
          dot += embeddings[i][k] * embeddings[j][k];
        }
        matrix[i][j] = dot;
        matrix[j][i] = dot;
      }
    }
    return matrix;
  }

  /** Compute the Jaccard similarity matrix. Super fast. */
  jaccardSimilarityMatrix(texts: string[]): number[][] {
    return sharedJaccardMatrix(texts);
  }
}
