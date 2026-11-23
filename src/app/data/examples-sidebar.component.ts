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
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AddMenuGroup, AddMenuItem, DEMO_TRACES_LABEL, buildAddMenu } from './add-menu';
import { LocalFilesSource } from './local-files-source';
import { DatasetInfo, ExampleSummary, SourceAction, TraceSource } from './trace-source';
import { parseIndices } from './dataset-refs';
import { LoadedDataset, WorkspaceService } from './workspace.service';
import { DatasetCounter, datasetCounter } from './dataset-counter';
import { isRowToggleKey } from './row-selection';
import { PanelSplitterComponent } from '../shared/panel-splitter.component';
import { MAX_CATEGORIES, MetaField, MetaValue, analyzeFields, compareMetaValues, formatMetaValue } from '../agentic-traces/metadata-fields';

/** Group-by option for the examples' titles (their task text), alongside metadata fields. */
const TITLE_FIELD = '__title__';

/** A dataset's listed examples, split into top-level ones and the subagents listed under them. */
interface ListedExamples {
  top: ExampleSummary[];
  /** Example indices of each top-level example's listed subagents (any depth). */
  children: Map<number, number[]>;
  /** Categorical metadata fields of the top-level examples. */
  fields: MetaField[];
}

export interface ExampleGroup {
  /** `<datasetKey>|<value>`, for open/closed state. */
  id: string;
  label: string;
  examples: ExampleSummary[];
  selected: number;
}

@Component({
  selector: 'app-examples-sidebar',
  standalone: true,
  imports: [CommonModule, FormsModule, PanelSplitterComponent],
  templateUrl: './examples-sidebar.component.html',
  styleUrls: ['./examples-sidebar.component.css'],
  host: { '(document:keydown.escape)': 'closeDemoPicker()' },
})
export class ExamplesSidebarComponent {
  readonly workspace = inject(WorkspaceService);
  private readonly localFiles = inject(LocalFilesSource, { optional: true });

  readonly collapsed = this.workspace.sidebarCollapsed;
  readonly width = signal(300);
  readonly filter = this.workspace.sidebarFilter;
  /** Datasets the user opened; all start collapsed so the list stays short. */
  readonly expandedSections = signal<Set<string>>(new Set());
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
  /** The open "Add dataset" menu; it sits below the datasets, so it's scrolled into view. */
  private readonly addMenu = viewChild<ElementRef<HTMLElement>>('addMenu');

  readonly actions = computed(() =>
    this.workspace.sources.flatMap(s => (s.actions ?? []).map(action => ({ source: s, action }))));

  // --- Add dataset menu -----------------------------------------------------

  async toggleMenu(): Promise<void> {
    if (this.menuOpen()) {
      this.menuOpen.set(false);
      return;
    }
    this.menuOpen.set(true);
    this.menuLoading.set(true);
    this.scrollMenuIntoView();
    const loaded = new Set(this.workspace.datasets().map(d => d.key));
    const menu = buildAddMenu(await this.workspace.availableDatasets(), loaded);
    this.menuGroups.set(menu.groups);
    this.demos.set(menu.demos);
    this.menuLoading.set(false);
    this.scrollMenuIntoView();
  }

  /** After the next render, so the menu's final size is known. */
  private scrollMenuIntoView(): void {
    // `scrollIntoView` is missing from server-side DOMs (tests).
    setTimeout(() => this.addMenu()?.nativeElement.scrollIntoView?.({ block: 'nearest' }));
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

  // --- Subagents and grouping ----------------------------------------------------

  /** Group-by field per dataset key; absent means no grouping. */
  readonly groupBy = signal<Record<string, string>>({});
  /** Open groups, by ExampleGroup id; groups start closed. */
  readonly openGroups = signal<Set<string>>(new Set());
  private readonly listedCache = new WeakMap<ExampleSummary[], ListedExamples>();

  /**
   * Splits the listed examples: subagents whose launching trace is listed
   * aren't shown (selecting the parent selects them), only counted.
   */
  listed(ds: LoadedDataset): ListedExamples {
    const cached = this.listedCache.get(ds.examples);
    if (cached) return cached;
    const byId = new Map<string, ExampleSummary>();
    for (const ex of ds.examples) if (ex.id) byId.set(ex.id, ex);
    const rootOf = (ex: ExampleSummary): ExampleSummary => {
      let cur = ex;
      for (let i = 0; i < 20 && cur.parentId && byId.has(cur.parentId); i++) cur = byId.get(cur.parentId)!;
      return cur;
    };
    const top: ExampleSummary[] = [];
    const children = new Map<number, number[]>();
    for (const ex of ds.examples) {
      const root = rootOf(ex);
      if (root === ex) top.push(ex);
      else children.set(root.index, [...(children.get(root.index) ?? []), ex.index]);
    }
    const fields = analyzeFields(top.map(ex => ex.metadata)).filter(f => f.kind === 'categorical');
    // The task text itself, when several examples share it (e.g. one prompt per condition).
    const titles = new Set(top.map(ex => ex.title));
    if (titles.size >= 2 && titles.size <= MAX_CATEGORIES) {
      fields.unshift({ key: TITLE_FIELD, kind: 'categorical', values: [...titles].sort() });
    }
    const out = { top, children, fields };
    this.listedCache.set(ds.examples, out);
    return out;
  }

  subagentCount(ds: LoadedDataset, ex: ExampleSummary): number {
    return this.listed(ds).children.get(ex.index)?.length ?? 0;
  }

  groupFields(ds: LoadedDataset): MetaField[] {
    return this.listed(ds).fields;
  }

  fieldLabel(field: MetaField): string {
    return field.key === TITLE_FIELD ? 'task (title)' : field.key;
  }

  groupField(ds: LoadedDataset): string {
    return this.groupBy()[ds.key] ?? '';
  }

  setGroupField(ds: LoadedDataset, field: string): void {
    this.groupBy.update(m => {
      const next = { ...m };
      if (field) next[ds.key] = field; else delete next[ds.key];
      return next;
    });
    // Grouping needs every example's metadata (summaries only; no traces).
    if (field) void this.workspace.loadAll(ds.key);
  }

  /** The filtered top-level examples, grouped by the dataset's group-by field (values in order, missing last). */
  groups(ds: LoadedDataset): ExampleGroup[] {
    const field = this.groupField(ds);
    const byValue = new Map<MetaValue | undefined, ExampleSummary[]>();
    for (const ex of this.filtered(ds)) {
      const v = field === TITLE_FIELD ? ex.title : ex.metadata?.[field];
      byValue.set(v, [...(byValue.get(v) ?? []), ex]);
    }
    const values = [...byValue.keys()].sort((a, b) =>
      a === undefined ? 1 : b === undefined ? -1 : compareMetaValues(a, b));
    const selected = new Set(ds.selected);
    return values.map(v => {
      const examples = byValue.get(v)!;
      return {
        id: `${ds.key}|${formatMetaValue(v)}`,
        label: formatMetaValue(v),
        examples,
        selected: examples.filter(ex => selected.has(ex.index)).length,
      };
    });
  }

  isGroupOpen(group: ExampleGroup): boolean {
    return !!this.filter().trim() || this.openGroups().has(group.id);
  }

  toggleGroup(group: ExampleGroup): void {
    const next = new Set(this.openGroups());
    if (!next.delete(group.id)) next.add(group.id);
    this.openGroups.set(next);
  }

  /** Selects the group's examples (with their subagents), or deselects them if any are selected. */
  async toggleGroupSelection(ds: LoadedDataset, group: ExampleGroup, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    const { children } = this.listed(ds);
    const indices = group.examples.flatMap(ex => [ex.index, ...(children.get(ex.index) ?? [])]);
    if (group.selected > 0) {
      const drop = new Set(indices);
      await this.workspace.setSelected(ds.key, ds.selected.filter(i => !drop.has(i)));
    } else {
      await this.workspace.setSelected(ds.key, [...ds.selected, ...indices]);
    }
  }

  // --- Sections and examples --------------------------------------------------

  isCollapsed(key: string): boolean {
    // While filtering, open every dataset so matches are visible.
    if (this.filter().trim()) return false;
    return !this.expandedSections().has(key);
  }

  toggleSection(key: string): void {
    const next = new Set(this.expandedSections());
    if (!next.delete(key)) next.add(key);
    this.expandedSections.set(next);
  }

  remove(ds: LoadedDataset, event: MouseEvent): void {
    event.stopPropagation();
    this.workspace.removeDataset(ds.key);
  }

  /** Deselects the dataset's examples if any are selected, else selects every listed one. */
  async toggleSelectAll(ds: LoadedDataset, event: MouseEvent): Promise<void> {
    event.stopPropagation();
    await this.workspace.setSelected(ds.key, ds.selected.length > 0 ? [] : ds.examples.map(e => e.index));
  }

  counter(ds: LoadedDataset): DatasetCounter {
    return datasetCounter(ds.selected.length, ds.examples.length, ds.totalCount, ds.hasMore,
      ds.loadingExamples || ds.loadingMore);
  }

  filtered(ds: LoadedDataset): ExampleSummary[] {
    const top = this.listed(ds).top;
    const q = this.filter().trim().toLowerCase();
    if (!q || ds.name.toLowerCase().includes(q)) return top;
    return top.filter(ex =>
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
  trackByGroup = (_: number, g: ExampleGroup) => g.id;
}
