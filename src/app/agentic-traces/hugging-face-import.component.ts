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

import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpErrorResponse } from '@angular/common/http';
import { DatasetItem, DatasetService } from './dataset.service';

@Component({
  selector: 'app-hugging-face-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './hugging-face-import.component.html',
  styleUrls: ['./hugging-face-import.component.css'],
})
export class HuggingFaceImportComponent {
  @Output() close = new EventEmitter<void>();
  @Output() import = new EventEmitter<DatasetItem>();

  importUrl = "";
  importMaxTraces = 50;
  importError = "";
  importLoading = false;

  constructor(private datasetService: DatasetService) {}

  private parseHuggingFaceRepoId(url: string): string | null {
    const cleanUrl = url.trim().replace(/\/+$/, '');
    
    const webMatch = cleanUrl.match(/huggingface\.co\/datasets\/([^\/]+\/[^\/]+)/);
    if (webMatch) {
      return webMatch[1];
    }
    
    const repoMatch = cleanUrl.match(/^([^\/]+\/[^\/]+)$/);
    if (repoMatch) {
      return repoMatch[1];
    }
    
    return null;
  }

  triggerImport() {
    this.importError = "";
    const repoId = this.parseHuggingFaceRepoId(this.importUrl);
    if (!repoId) {
      this.importError = "Invalid Hugging Face Repo ID. Please enter e.g., 'OpenTraces/opentraces-runtime'.";
      return;
    }

    this.importLoading = true;

    this.datasetService.resolveRepositoryUrls(repoId)
      .then((resolveUrls) => {
        this.datasetService.loadRemoteDataset([resolveUrls[0]], 1)
          .then((parsedRecords) => {
            if (parsedRecords.length === 0) {
              this.importError = "The first file in the dataset is empty or invalid JSONL.";
              this.importLoading = false;
              return;
            }

            const firstRecord = parsedRecords[0];
            const isValidSchema = !!(firstRecord.steps && Array.isArray(firstRecord.steps)) || !!firstRecord.trace_id;
            if (!isValidSchema) {
              this.importError = "Validation failed: Dataset files do not match the OpenTraces schema (missing 'steps' array or 'trace_id').";
              this.importLoading = false;
              return;
            }

            const newDataset: DatasetItem = {
              name: `${repoId} 🤗 [Imported]`,
              file: `hf-imported-${Date.now()}`,
              isRemote: false,
              isImported: true,
              repoId: repoId,
              urls: resolveUrls,
              maxTraces: this.importMaxTraces
            };

            this.import.emit(newDataset);
            this.importLoading = false;
          })
          .catch((err) => {
            console.error('Error validation fetching first dataset file:', err);
            this.importError = "Failed to download and validate the dataset file for verification.";
            this.importLoading = false;
          });
      })
      .catch((err) => {
        console.error('Failed to resolve repository URLs:', err);
        if (err instanceof HttpErrorResponse && err.status === 404) {
          this.importError = `Repository "${repoId}" was not found on Hugging Face. Please check the name and ensure it is public.`;
        } else {
          this.importError = err.message || "Hugging Face dataset not found or private. Make sure the dataset name is correct and public.";
        }
        this.importLoading = false;
      });
  }
}
