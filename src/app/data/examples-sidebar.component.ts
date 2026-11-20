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

/**
 * @fileoverview The examples sidebar: one collapsible section per loaded
 * dataset, listing its examples to select (several, across datasets, to
 * compare), rename, or jump to by index; plus an "Add dataset" menu fed by the
 * registered trace sources, whose last entry opens a picker of demo traces.
 * Local trace files can also be dropped on it.
 */

import { CommonModule } from '@angular/common';
import { Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AddMenuGroup, AddMenuItem, DEMO_TRACES_LABEL, buildAddMenu } from './add-menu';
import { LocalFilesSource } from './local-files-source';
import { DatasetInfo, ExampleSummary, SourceAction, TraceSource } from './trace-source';
import { parseIndices } from './dataset-refs';
import { LoadedDataset, WorkspaceService } from './workspace.service';
import { isRowToggleKey } from './row-selection';

@Component({
  selector: 'app-examples-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './examples-sidebar.component.html',
  styleUrls: ['./examples-sidebar.component.css'],
  host: { '(document:keydown.escape)': 'closeDemoPicker()' },
})
export class ExamplesSidebarComponent implements OnDestroy {
  readonly workspace = inject(WorkspaceService);
  private readonly localFiles = inject(LocalFilesSource, { optional: true });

  readonly collapsed = this.workspace.sidebarCollapsed;
  readonly width = signal(300);
  readonly filter = this.workspace.sidebarFilter;
  readonly collapsedSections = signal<Set<string>>(new Set());
  readonly jumpInputs = signal<Record<string, string>>({});
  readonly jumpErrors = signal<Record<string, string>>({});
  readonly menuOpen = signal(false);
  readonly menuGroups = signal<AddMenuGroup[]>([]);
  readonly menuLoading = signal(false);
  readonly demoTracesLabel = DEMO_TRACES_LABEL;
  /** Demo datasets offered by the picker behind the menu's "Demo traces" entry. */
  readonly demos = signal<AddMenuItem[]>([]);
  readonly demoPickerOpen = signal(false);
  readonly addError = signal('');
  /** `<datasetKey>#<index>` of the example being renamed. */
  readonly renaming = signal<string | null>(null);
  renameDraft = '';
  readonly dragOver = signal(false);

  readonly actions = computed(() =>
    this.workspace.sources.flatMap(s => (s.actions ?? []).map(action => ({ source: s, action }))));

  private resizeStartX = 0;
  private resizeStartWidth = 0;
  private onMove?: (e: MouseEvent) => void;
  private onUp?: () => void;

  ngOnDestroy(): void {
    this.stopResize();
  }

  // --- Add dataset menu -----------------------------------------------------

  async toggleMenu(): Promise<void> {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      return;
    }
    this.menuOpen.set(true);
    this.menuLoading.set(true);
    const loaded = new Set(this.workspace.datasets().map(d => d.key));
    const menu = buildAddMenu(await this.workspace.availableDatasets(), loaded);
    this.menuGroups.set(menu.groups);
    this.demos.set(menu.demos);
    this.menuLoading.set(false);
  }

  openDemoPicker(): void {
    this.menuOpen.set(false);
    this.demoPickerOpen.set(true);
  }

  closeDemoPicker(): void {
    this.demoPickerOpen.set(false);
  }

  async addDemo(item: AddMenuItem): Promise<void> {
    if (item.loaded) return;
    this.demoPickerOpen.set(false);
    await this.workspace.addDataset(item.source.id, item.dataset, [0]);
  }

  async addFromMenu(source: TraceSource, ds: DatasetInfo): Promise<void> {
    this.menuOpen.set(false);
    await this.workspace.addDataset(source.id, ds, [0]);
  }

  async runAction(source: TraceSource, action: SourceAction): Promise<void> {
    this.menuOpen.set(false);
    this.addError.set('');
    try {
      const ds = await action.run();
      if (ds) await this.workspace.addDataset(source.id, ds, [0]);
    } catch (err) {
      this.addError.set(err instanceof Error ? err.message : String(err));
    }
  }

  // --- Dropping local files -------------------------------------------------

  onDragOver(event: DragEvent): void {
    if (!this.localFiles || !event.dataTransfer?.types.includes('Files')) return;
    event.preventDefault();
    this.dragOver.set(true);
  }

  onDragLeave(event: DragEvent): void {
    if (event.currentTarget === event.target) this.dragOver.set(false);
  }

  async onDrop(event: DragEvent): Promise<void> {
    this.dragOver.set(false);
    const files = [...(event.dataTransfer?.files ?? [])];
    if (!this.localFiles || files.length === 0) return;
    event.preventDefault();
    this.addError.set('');
    try {
      const ds = await this.localFiles.addFiles(files);
      await this.workspace.addDataset(this.localFiles.id, ds, [0]);
    } catch (err) {
      this.addError.set(err instanceof Error ? err.message : String(err));
    }
  }

  // --- Sections and examples --------------------------------------------------

  isCollapsed(key: string): boolean {
    return this.collapsedSections().has(key);
  }

  toggleSection(key: string): void {
    const next = new Set(this.collapsedSections());
    if (!next.delete(key)) next.add(key);
    this.collapsedSections.set(next);
  }

  remove(ds: LoadedDataset, event: MouseEvent): void {
    event.stopPropagation();
    this.workspace.removeDataset(ds.key);
  }

  countLabel(ds: LoadedDataset): string {
    const loaded = ds.examples.length;
    if (ds.totalCount !== null) return loaded < ds.totalCount ? `${loaded} / ${ds.totalCount}` : `${ds.totalCount}`;
    return ds.hasMore ? `${loaded}+` : `${loaded}`;
  }

  filtered(ds: LoadedDataset): ExampleSummary[] {
    const q = this.filter().trim().toLowerCase();
    if (!q || ds.name.toLowerCase().includes(q)) return ds.examples;
    return ds.examples.filter(ex =>
      `#${ex.index}`.includes(q) ||
      this.workspace.titleOf(ds.key, ex).toLowerCase().includes(q) ||
      (ex.id?.toLowerCase().includes(q) ?? false));
  }

  /**
   * Hover text for an example row. The row hides the index and ID to keep the
   * list compact, but both still work in the filter box, so expose them here.
   */
  rowTooltip(ds: LoadedDataset, ex: ExampleSummary): string {
    const title = this.workspace.titleOf(ds.key, ex);
    const id = ex.id && ex.id !== title ? `\n${ex.id}` : '';
    return `#${ex.index} ${title}${id}`;
  }

  isSelected(ds: LoadedDataset, ex: ExampleSummary): boolean {
    return ds.selected.includes(ex.index);
  }

  onRowClick(ds: LoadedDataset, ex: ExampleSummary): void {
    if (this.renaming()) return;
    void this.workspace.toggle(ds.key, ex.index);
  }

  /** Enter or Space on a focused row toggles it, like a click. */
  onRowKeydown(ds: LoadedDataset, ex: ExampleSummary, event: KeyboardEvent): void {
    if (!isRowToggleKey(event)) return;
    event.preventDefault();  // Space would otherwise scroll the list.
    this.onRowClick(ds, ex);
  }

  selectOnly(ds: LoadedDataset, ex: ExampleSummary, event: MouseEvent): void {
    event.stopPropagation();
    void this.workspace.selectOnly(ds.key, ex.index);
  }

  jumpInput(key: string): string {
    return this.jumpInputs()[key] ?? '';
  }

  setJumpInput(key: string, value: string): void {
    this.jumpInputs.update(m => ({ ...m, [key]: value }));
  }

  jumpError(key: string): string {
    return this.jumpErrors()[key] ?? '';
  }

  /** Adds the indices typed in the jump box ("42", "10-15", "1,4") to the selection. */
  async jump(ds: LoadedDataset): Promise<void> {
    const raw = this.jumpInput(ds.key).trim();
    if (!raw) return;
    const indices = parseIndices(raw);
    if (!indices || indices.length === 0) {
      this.jumpErrors.update(m => ({ ...m, [ds.key]: `Use indices like 42, 1,4 or 10-15.` }));
      return;
    }
    if (ds.totalCount !== null && indices.some(i => i >= ds.totalCount!)) {
      this.jumpErrors.update(m => ({ ...m, [ds.key]: `This dataset has ${ds.totalCount} examples (0-${ds.totalCount! - 1}).` }));
      return;
    }
    this.jumpErrors.update(m => ({ ...m, [ds.key]: '' }));
    this.setJumpInput(ds.key, '');
    await this.workspace.setSelected(ds.key, [...ds.selected, ...indices], indices[indices.length - 1]);
  }

  // --- Renaming ---------------------------------------------------------------

  startRename(ds: LoadedDataset, ex: ExampleSummary, event: MouseEvent): void {
    event.stopPropagation();
    this.renameDraft = this.workspace.titleOf(ds.key, ex);
    this.renaming.set(`${ds.key}#${ex.index}`);
  }

  isRenaming(ds: LoadedDataset, ex: ExampleSummary): boolean {
    return this.renaming() === `${ds.key}#${ex.index}`;
  }

  async finishRename(ds: LoadedDataset, ex: ExampleSummary): Promise<void> {
    if (!this.isRenaming(ds, ex)) return;
    this.renaming.set(null);
    const title = this.renameDraft.trim();
    if (!title) return;
    // Renaming needs the parsed trace, so load it if it isn't selected yet.
    if (!ds.selected.includes(ex.index)) await this.workspace.setSelected(ds.key, [...ds.selected, ex.index]);
    const entry = this.workspace.selectedEntries().find(e => {
      const origin = this.workspace.originOf(e.id);
      return origin?.key === ds.key && origin.index === ex.index;
    });
    if (entry) this.workspace.rename(entry.id, title);
  }

  cancelRename(): void {
    this.renaming.set(null);
  }

  formatDate(iso?: string): string {
    if (!iso) return '';
    const d = new Date(iso);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }

  formatReward(reward: number): string {
    return Number.isInteger(reward) ? String(reward) : reward.toFixed(2);
  }

  trackByKey = (_: number, ds: LoadedDataset) => ds.key;
  trackByIndex = (_: number, ex: ExampleSummary) => ex.index;

  // --- Resizing -----------------------------------------------------------------

  startResize(event: MouseEvent): void {
    event.preventDefault();
    this.resizeStartX = event.clientX;
    this.resizeStartWidth = this.width();
    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';
    this.onMove = (e: MouseEvent) =>
      this.width.set(Math.max(220, Math.min(560, this.resizeStartWidth + e.clientX - this.resizeStartX)));
    this.onUp = () => this.stopResize();
    window.addEventListener('mousemove', this.onMove);
    window.addEventListener('mouseup', this.onUp);
  }

  private stopResize(): void {
    // Nothing to undo unless a resize is in progress.
    if (!this.onMove && !this.onUp) return;
    if (this.onMove) window.removeEventListener('mousemove', this.onMove);
    if (this.onUp) window.removeEventListener('mouseup', this.onUp);
    this.onMove = this.onUp = undefined;
    document.body.style.userSelect = '';
    document.body.style.cursor = '';
  }
}
