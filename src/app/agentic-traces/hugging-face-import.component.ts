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

import { Component, EventEmitter, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { HttpClient, HttpHeaders, HttpErrorResponse } from '@angular/common/http';
import { TraceLoaderService } from './trace-loader.service';
import { DatasetItem } from './trace-loader.service';

@Component({
  selector: 'app-hugging-face-import',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="modal-overlay">
      <div class="modal-card">
        <div class="modal-header">
          <h3>Import from Hugging Face</h3>
          <button class="close-btn" (click)="close.emit()">&times;</button>
        </div>
        <div class="modal-body">
          <p class="modal-desc">
            Paste a Hugging Face repository ID to fetch. Note that the traces MUST be in <a href="https://www.opentraces.ai/" target="_blank" style="color: #818cf8; text-decoration: underline;">OpenTraces</a> format.
          </p>
          <div class="form-group">
            <label for="import-url" class="form-label">Hugging Face Repo ID</label>
            <input 
              id="import-url"
              type="text" 
              placeholder="e.g., OpenTraces/opentraces-runtime" 
              [(ngModel)]="importUrl"
              [disabled]="importLoading"
              class="form-input">
          </div>
          <div class="form-group">
            <label for="import-max-traces" class="form-label">Max Traces to Load</label>
            <input 
              id="import-max-traces"
              type="number" 
              [(ngModel)]="importMaxTraces"
              [disabled]="importLoading"
              min="1"
              max="500"
              class="form-input">
          </div>
          <div class="error-message" *ngIf="importError">
            {{ importError }}
          </div>
        </div>
        <div class="modal-footer">
          <button class="modal-btn btn-secondary" [disabled]="importLoading" (click)="close.emit()">Cancel</button>
          <button class="modal-btn btn-primary" [disabled]="importLoading || !importUrl.trim()" (click)="triggerImport()">
            <span *ngIf="!importLoading">Import</span>
            <span *ngIf="importLoading">Importing...</span>
          </button>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .modal-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(15, 23, 42, 0.6);
      backdrop-filter: blur(4px);
      display: flex;
      justify-content: center;
      align-items: center;
      z-index: 10000;
    }

    .modal-card {
      background: #1e293b;
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 12px;
      width: 100%;
      max-width: 480px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.3), 0 10px 10px -5px rgba(0, 0, 0, 0.2);
      display: flex;
      flex-direction: column;
      overflow: hidden;
      animation: modalFadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1);
    }

    @keyframes modalFadeIn {
      from { opacity: 0; transform: scale(0.95); }
      to { opacity: 1; transform: scale(1); }
    }

    .modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .modal-header h3 {
      margin: 0;
      font-size: 1.2rem;
      color: #f8fafc;
      font-weight: 600;
    }

    .modal-header .close-btn {
      background: none;
      border: none;
      color: rgba(255, 255, 255, 0.4);
      font-size: 1.5rem;
      cursor: pointer;
      line-height: 1;
      padding: 0;
      transition: color 0.15s;
    }

    .modal-header .close-btn:hover {
      color: #f8fafc;
    }

    .modal-body {
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .modal-desc {
      margin: 0 0 4px;
      font-size: 0.85rem;
      color: rgba(255, 255, 255, 0.5);
      line-height: 1.4;
    }

    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 0.8rem;
      font-weight: 500;
      color: rgba(255, 255, 255, 0.7);
    }

    .form-input {
      background: #0f172a;
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 6px;
      padding: 8px 12px;
      color: #f8fafc;
      font-size: 0.875rem;
      outline: none;
      transition: border-color 0.15s, box-shadow 0.15s;
    }

    .form-input:focus {
      border-color: #6366f1;
      box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
    }

    .error-message {
      color: #f87171;
      background: rgba(248, 113, 113, 0.08);
      border: 1.5px solid rgba(248, 113, 113, 0.15);
      border-radius: 6px;
      padding: 10px 12px;
      font-size: 0.8rem;
      line-height: 1.4;
    }

    .modal-footer {
      padding: 14px 20px;
      background: #131d31;
      border-top: 1px solid rgba(255, 255, 255, 0.05);
      display: flex;
      justify-content: flex-end;
      gap: 12px;
    }

    .modal-btn {
      padding: 8px 16px;
      font-size: 0.85rem;
      font-weight: 500;
      border-radius: 6px;
      cursor: pointer;
      border: none;
      transition: background-color 0.15s, opacity 0.15s;
    }

    .modal-btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }

    .btn-primary {
      background: #6366f1;
      color: #ffffff;
    }

    .btn-primary:hover:not(:disabled) {
      background: #4f46e5;
    }

    .btn-secondary {
      background: rgba(255, 255, 255, 0.05);
      color: rgba(255, 255, 255, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.08);
    }

    .btn-secondary:hover:not(:disabled) {
      background: rgba(255, 255, 255, 0.1);
      color: #ffffff;
    }
  `]
})
export class HuggingFaceImportComponent {
  @Output() close = new EventEmitter<void>();
  @Output() import = new EventEmitter<DatasetItem>();

  importUrl = "";
  importMaxTraces = 50;
  importError = "";
  importLoading = false;

  constructor(
    private http: HttpClient,
    private traceLoaderService: TraceLoaderService
  ) {}

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

    this.traceLoaderService.resolveRepositoryUrls(repoId)
      .then((resolveUrls) => {
        this.traceLoaderService.loadRemoteDataset([resolveUrls[0]], 1)
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
