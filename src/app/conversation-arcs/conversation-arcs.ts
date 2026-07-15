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
 * @fileoverview Main component for the Conversational Arcs visualization.
 */

import { Component, OnInit, ElementRef, ViewChild, HostListener, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';

import { WildChatService } from './wildchat.service';
import { ReferenceService } from './reference-service';
import {
  WildChatConversation,
  AnnotatedConversation,
  AnnotatedSentence,
  SentenceReference,
  REFERENCE_COLORS,
  REFERENCE_LABELS,
  ALL_REFERENCE_TYPES,
  ReferenceType
} from './types';
import { ConversationViewerComponent, ConversationMessage } from '../shared/conversation-viewer.component';
import { MultiSelectDropdownComponent, DropdownItem } from '../shared/multi-select-dropdown.component';

export interface ConversationColumnState {
  conversationHash: string;
  raw: WildChatConversation;
  annotated: AnnotatedConversation | null;
  messages: ConversationMessage[];
  references: SentenceReference[];
  hoveredSentenceGlobalIndex: number | null;
  selectedSentenceGlobalIndex: number | null;
  selectedReferenceType: ReferenceType | null;
  svgHeight: number;
  turnLabels: Array<{ text: string; x: number; y: number; align: string }>;
  sentenceLayouts: Map<number, { role: string; segments: Array<{ x: number; y: number; w: number; h: number }> }>;
  sentenceArcIntervals: Map<number, { yMin: number; yMax: number }>;
  getHighlightedTextFn?: (msg: ConversationMessage) => SafeHtml;
}

@Component({
  selector: 'app-conversation-arcs',
  standalone: true,
  imports: [CommonModule, FormsModule, ConversationViewerComponent, MultiSelectDropdownComponent],
  templateUrl: './conversation-arcs.html',
  styleUrls: ['./conversation-arcs.css']
})
export class ConversationArcsComponent implements OnInit {
  @ViewChild('arcSvgContainer') arcSvgContainer!: ElementRef<HTMLDivElement>;

  // Dropdown options
  conversations: WildChatConversation[] = [];
  dropdownItems: DropdownItem[] = [];
  selectedConversationHashes: Set<string> = new Set();
  
  // Side-by-side columns
  columns: ConversationColumnState[] = [];

  // Active column for the single conversation viewer
  activeColumn: ConversationColumnState | null = null;

  // Controls
  minStrength = 1;
  maxArcRadius = 75;
  isLoading = false;
  loadingPhase = '';

  // Reference visual settings
  referenceColors = REFERENCE_COLORS;
  referenceLabels = REFERENCE_LABELS;
  allReferenceTypes = ALL_REFERENCE_TYPES;

  // Layout properties for rendering
  readonly COL_LEFT = 95;
  readonly COL_WIDTH = 60;

  constructor(
    private wildChatService: WildChatService,
    private referenceService: ReferenceService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {
    const clearFn = () => {
      let count = 0;
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith('conv_arcs_refs_')) {
          localStorage.removeItem(key);
          count++;
        }
      }
      console.log(`Cleared ${count} cached conversation analyses. Reload the page to re-analyze.`);
    };
    (window as any).clearCache = clearFn;
    (window as any).clearcache = clearFn;
  }

  ngOnInit() {
    this.loadConversations();
  }

  async loadConversations() {
    this.isLoading = true;
    this.loadingPhase = 'Loading WildChat conversations...';
    try {
      this.conversations = await this.wildChatService.fetchConversations();
      this.dropdownItems = this.conversations.map(c => ({
        id: c.conversation_hash,
        title: `[${c.turn} turns] ${c.conversation[0]?.content?.slice(0, 60) || ''}...`
      }));

      if (this.conversations.length > 0) {
        const defaultHash = this.conversations[0].conversation_hash;
        this.selectedConversationHashes = new Set([defaultHash]);
        await this.updateColumns();
      }
    } catch (e) {
      console.error('Failed to load conversations:', e);
      alert('Failed to load conversations from Hugging Face.');
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async onSelectionChange(newSelection: Set<string>) {
    this.selectedConversationHashes = newSelection;
    await this.updateColumns();
  }

  async updateColumns() {
    this.isLoading = true;
    this.loadingPhase = 'Updating columns...';

    const currentHashes = new Set(this.columns.map(c => c.conversationHash));

    // Remove columns that are no longer selected
    this.columns = this.columns.filter(c => this.selectedConversationHashes.has(c.conversationHash));

    // Add new columns
    for (const hash of this.selectedConversationHashes) {
      if (!currentHashes.has(hash)) {
        const raw = this.conversations.find(c => c.conversation_hash === hash);
        if (raw) {
          const colState: ConversationColumnState = {
            conversationHash: hash,
            raw,
            annotated: null,
            messages: [],
            references: [],
            hoveredSentenceGlobalIndex: null,
            selectedSentenceGlobalIndex: null,
            selectedReferenceType: null,
            svgHeight: 600,
            turnLabels: [],
            sentenceLayouts: new Map(),
            sentenceArcIntervals: new Map()
          };

          this.preprocessColumn(colState);
          this.columns.push(colState);

          await this.executeReferenceAnalysisForColumn(colState);
        }
      }
    }

    // Set activeColumn to first column if current is invalid
    if (!this.activeColumn || !this.columns.includes(this.activeColumn)) {
      this.activeColumn = this.columns[0] || null;
    }

    this.isLoading = false;
    this.cdr.detectChanges();
  }

  preprocessColumn(col: ConversationColumnState) {
    const annotated = this.referenceService.preprocessConversation(col.raw);
    col.annotated = annotated;

    col.messages = annotated.turns.map(turn => ({
      id: `turn-${turn.turnIndex}`,
      speaker: turn.role === 'user' ? 'User' : 'Assistant',
      text: turn.content,
      data: turn
    }));

    this.calculateLayoutForColumn(col);
  }

  private async executeReferenceAnalysisForColumn(col: ConversationColumnState) {
    if (!col.annotated) return;
    
    const apiKey = this.referenceService.getApiKey();
    if (!apiKey) return;

    try {
      const refs = await this.referenceService.analyzeReferences(col.annotated, apiKey);
      col.references = refs;

      this.mapReferencesToSentencesForColumn(col, refs);
      this.calculateArcIntervalsForColumn(col);
    } catch (e) {
      console.error(`Analysis failed for ${col.conversationHash}:`, e);
    }
  }

  private calculateLayoutForColumn(col: ConversationColumnState) {
    if (!col.annotated) return;
    let currentY = 30; // top padding
    col.turnLabels = [];
    col.sentenceLayouts.clear();
    col.sentenceArcIntervals.clear();
    
    for (const turn of col.annotated.turns) {
      col.turnLabels.push({
        text: turn.role === 'user' ? 'User' : 'Assistant',
        x: turn.role === 'user' ? this.COL_LEFT : this.COL_LEFT + this.COL_WIDTH,
        y: currentY + 10,
        align: turn.role === 'user' ? 'start' : 'end'
      });
      currentY += 18;

      for (const sentence of turn.sentences) {
        let remaining = Math.max(20, sentence.charLength * 1.5);
        const segments: Array<{ x: number; y: number; w: number; h: number }> = [];
        const h = 3;
        
        while (remaining > 0) {
          const w = Math.min(remaining, this.COL_WIDTH);
          const x = turn.role === 'user' ? this.COL_LEFT : this.COL_LEFT + this.COL_WIDTH - w;
          
          segments.push({ x, y: currentY, w, h });
          
          currentY += h + 2;
          remaining -= w;
          if (remaining < 1) break;
        }
        
        currentY += 4;
        
        col.sentenceLayouts.set(sentence.globalIndex, {
          role: turn.role,
          segments
        });
      }
      
      currentY += 12;
    }
    
    col.svgHeight = currentY + 40;

    const sentences = col.annotated.turns.flatMap(t => t.sentences);
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const box = this.getSentenceBoundingBoxForColumn(col, s.globalIndex);
      
      let yMin = box.y - 1;
      let yMax = box.y + box.h + 1;
      
      if (i > 0) {
        const prevBox = this.getSentenceBoundingBoxForColumn(col, sentences[i - 1].globalIndex);
        yMin = (prevBox.y + prevBox.h + box.y) / 2;
      }
      
      if (i < sentences.length - 1) {
        const nextBox = this.getSentenceBoundingBoxForColumn(col, sentences[i + 1].globalIndex);
        yMax = (box.y + box.h + nextBox.y) / 2;
      }
      
      col.sentenceArcIntervals.set(s.globalIndex, { yMin, yMax });
    }
  }

  getSentenceLayoutForColumn(col: ConversationColumnState, globalIndex: number) {
    return col.sentenceLayouts.get(globalIndex) || { role: '', segments: [] };
  }

  getArcPathForColumn(col: ConversationColumnState, ref: SentenceReference): string {
    const boxSource = this.getSentenceBoundingBoxForColumn(col, ref.sourceGlobal);
    const boxTarget = this.getSentenceBoundingBoxForColumn(col, ref.targetGlobal);
    if (boxSource.w === 0 || boxTarget.w === 0) return '';

    const intervalSource = col.sentenceArcIntervals.get(ref.sourceGlobal);
    const intervalTarget = col.sentenceArcIntervals.get(ref.targetGlobal);
    if (!intervalSource || !intervalTarget) return '';

    const ySource = (intervalSource.yMin + intervalSource.yMax) / 2;
    const yTarget = (intervalTarget.yMin + intervalTarget.yMax) / 2;

    const yTop = Math.min(ySource, yTarget);
    const yBottom = Math.max(ySource, yTarget);
    const R = (yBottom - yTop) / 2;

    const isRhs = ref.type === 'summary' || ref.type === 'artifact';
    const anchorX = isRhs ? this.COL_LEFT + this.COL_WIDTH : this.COL_LEFT;

    const tSource = intervalSource.yMax - intervalSource.yMin;
    const tTarget = intervalTarget.yMax - intervalTarget.yMin;

    const tTop = ySource < yTarget ? tSource : tTarget;
    const tBottom = ySource < yTarget ? tTarget : tSource;

    const rOuter = R + (tTop + tBottom) / 4;
    const rInner = R - (tTop + tBottom) / 4;

    const rxOuter = Math.min(this.maxArcRadius, rOuter);
    const ryOuter = rOuter;

    const rxInner = Math.max(5, Math.min(this.maxArcRadius - (tTop + tBottom) / 2, rInner));
    const ryInner = rInner;

    const sweepOuter = isRhs ? 1 : 0;
    const sweepInner = isRhs ? 0 : 1;

    return `M ${anchorX} ${yTop - tTop/2} 
            A ${rxOuter} ${ryOuter} 0 0 ${sweepOuter} ${anchorX} ${yBottom + tBottom/2} 
            L ${anchorX} ${yBottom - tBottom/2} 
            A ${rxInner} ${ryInner} 0 0 ${sweepInner} ${anchorX} ${yTop + tTop/2} Z`;
  }

  getArcOpacityForColumn(col: ConversationColumnState, ref: SentenceReference): number {
    return 0.03 + (ref.strength - 1) * 0.03;
  }

  isArcDimmedForColumn(col: ConversationColumnState, ref: SentenceReference): boolean {
    const activeIndex = col.hoveredSentenceGlobalIndex ?? col.selectedSentenceGlobalIndex;
    if (activeIndex === null) return false;
    return ref.sourceGlobal !== activeIndex && ref.targetGlobal !== activeIndex;
  }

  isArcHighlightedForColumn(col: ConversationColumnState, ref: SentenceReference): boolean {
    const activeIndex = col.hoveredSentenceGlobalIndex ?? col.selectedSentenceGlobalIndex;
    if (activeIndex === null) return false;
    return ref.sourceGlobal === activeIndex || ref.targetGlobal === activeIndex;
  }

  private mapReferencesToSentencesForColumn(col: ConversationColumnState, refs: SentenceReference[]) {
    if (!col.annotated) return;
    for (const turn of col.annotated.turns) {
      for (const sentence of turn.sentences) {
        sentence.references = [];
      }
    }

    const sentenceMap = new Map<number, AnnotatedSentence>();
    for (const turn of col.annotated.turns) {
      for (const sentence of turn.sentences) {
        sentenceMap.set(sentence.globalIndex, sentence);
      }
    }

    for (const ref of refs) {
      const source = sentenceMap.get(ref.sourceGlobal);
      if (source) {
        source.references.push(ref);
      }
    }
  }

  getSentenceStyleForColumn(col: ConversationColumnState, globalIndex: number): string {
    const refs = this.getFilteredReferencesForColumn(col).filter(ref => ref.targetGlobal === globalIndex);
    if (refs.length === 0) {
      const isActive = globalIndex === col.hoveredSentenceGlobalIndex || globalIndex === col.selectedSentenceGlobalIndex;
      if (isActive) {
        return 'background-color: rgba(15, 23, 42, 0.06);';
      }
      return '';
    }

    const gradients = refs.map(ref => {
      const color = this.referenceColors[ref.type];
      const isDimmed = this.isArcDimmedForColumn(col, ref);
      const alpha = isDimmed ? '03' : '26';
      return `linear-gradient(0deg, ${color}${alpha}, ${color}${alpha})`;
    });

    let style = `background: ${gradients.join(', ')};`;
    
    const isActive = globalIndex === col.hoveredSentenceGlobalIndex || globalIndex === col.selectedSentenceGlobalIndex;
    if (isActive) {
      style += ' border-bottom: 2px solid #0f172a; font-weight: 500;';
    }
    return style;
  }

  getActiveSentenceSegmentsForColumn(col: ConversationColumnState): Array<{ x: number; y: number; w: number; h: number }> {
    const idx = col.hoveredSentenceGlobalIndex ?? col.selectedSentenceGlobalIndex;
    if (idx === null) return [];
    return this.getSentenceLayoutForColumn(col, idx).segments;
  }

  getHighlightedTextForColumn(col: ConversationColumnState) {
    if (!col.getHighlightedTextFn) {
      col.getHighlightedTextFn = (msg: ConversationMessage): SafeHtml => {
        const turn = msg.data;
        if (!turn || !turn.sentences) return msg.text;

        const html = turn.sentences.map((s: AnnotatedSentence) => {
          const isHovered = s.globalIndex === col.hoveredSentenceGlobalIndex;
          const isSelected = s.globalIndex === col.selectedSentenceGlobalIndex;
          
          let classes = 'chat-sentence';
          if (isSelected) classes += ' selected';
          else if (isHovered) classes += ' hovered';

          const style = this.getSentenceStyleForColumn(col, s.globalIndex);

          return `<span id="chat-sentence-${col.conversationHash}-${s.globalIndex}" class="${classes}" style="${style}">${s.text}</span>`;
        }).join(' ');

        return this.sanitizer.bypassSecurityTrustHtml(html);
      };
    }
    return col.getHighlightedTextFn;
  }

  getSpeakerColor = (msg: ConversationMessage): string => {
    return '#0f172a';
  };

  getSpeakerBgColor = (msg: ConversationMessage): string => {
    return msg.speaker === 'User' ? 'rgba(74, 144, 217, 0.05)' : 'rgba(16, 185, 129, 0.05)';
  };

  getSpeakerBorder = (msg: ConversationMessage): string => {
    return msg.speaker === 'User' ? '1px solid rgba(74, 144, 217, 0.15)' : '1px solid rgba(16, 185, 129, 0.15)';
  };

  hoverSentenceForColumn(col: ConversationColumnState, globalIndex: number | null) {
    if (globalIndex !== null) {
      this.activeColumn = col;
    }
    if (globalIndex !== null && col.hoveredSentenceGlobalIndex !== globalIndex) {
      setTimeout(() => {
        const el = document.getElementById(`chat-sentence-${col.conversationHash}-${globalIndex}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
    col.hoveredSentenceGlobalIndex = globalIndex;
  }

  selectSentenceForColumn(col: ConversationColumnState, globalIndex: number) {
    this.activeColumn = col;
    col.selectedSentenceGlobalIndex = globalIndex;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (target && target.classList.contains('chat-sentence')) {
      const idParts = target.id.split('-');
      if (idParts.length >= 4) {
        const hash = idParts[2];
        const idx = parseInt(idParts[3], 10);
        const col = this.columns.find(c => c.conversationHash === hash);
        if (col && !isNaN(idx)) {
          this.selectSentenceForColumn(col, idx);
          return;
        }
      }
    }

    let clickedInsideSvg = false;
    const svgContainers = document.querySelectorAll('.arc-panel');
    for (let i = 0; i < svgContainers.length; i++) {
      if (svgContainers[i].contains(event.target as Node)) {
        clickedInsideSvg = true;
        break;
      }
    }

    if (!clickedInsideSvg) {
      let clickedInsideChat = false;
      const chatPanels = document.querySelectorAll('.chat-panel');
      for (let i = 0; i < chatPanels.length; i++) {
        if (chatPanels[i].contains(event.target as Node)) {
          clickedInsideChat = true;
          break;
        }
      }

      if (!clickedInsideChat) {
        for (const col of this.columns) {
          col.selectedSentenceGlobalIndex = null;
        }
      }
    }
  }

  getStrengthFilteredReferencesForColumn(col: ConversationColumnState): SentenceReference[] {
    return col.references.filter(ref => ref.strength >= this.minStrength);
  }

  getFilteredReferencesForColumn(col: ConversationColumnState): SentenceReference[] {
    return this.getStrengthFilteredReferencesForColumn(col).filter(ref => 
      col.selectedReferenceType === null || ref.type === col.selectedReferenceType
    );
  }

  getUsedReferenceTypesForColumn(col: ConversationColumnState): ReferenceType[] {
    if (col.references.length === 0) return [];
    const activeTypes = new Set<ReferenceType>();
    for (const ref of this.getStrengthFilteredReferencesForColumn(col)) {
      activeTypes.add(ref.type);
    }
    return this.allReferenceTypes.filter(type => activeTypes.has(type));
  }

  toggleReferenceTypeFilterForColumn(col: ConversationColumnState, type: ReferenceType) {
    if (col.selectedReferenceType === type) {
      col.selectedReferenceType = null;
    } else {
      col.selectedReferenceType = type;
    }
    this.calculateArcIntervalsForColumn(col);
  }

  isSentenceConnectedToActiveForColumn(col: ConversationColumnState, globalIndex: number): boolean {
    const activeIndex = col.hoveredSentenceGlobalIndex ?? col.selectedSentenceGlobalIndex;
    if (activeIndex === null) return false;
    if (activeIndex === globalIndex) return true;

    return this.getFilteredReferencesForColumn(col).some(ref => 
      (ref.sourceGlobal === activeIndex && ref.targetGlobal === globalIndex) ||
      (ref.targetGlobal === activeIndex && ref.sourceGlobal === globalIndex)
    );
  }

  getActiveReferenceForSentenceForColumn(col: ConversationColumnState, globalIndex: number): SentenceReference | null {
    const activeIndex = col.hoveredSentenceGlobalIndex ?? col.selectedSentenceGlobalIndex;
    if (activeIndex === null) return null;

    return this.getFilteredReferencesForColumn(col).find(ref => 
      (ref.sourceGlobal === activeIndex && ref.targetGlobal === globalIndex) ||
      (ref.targetGlobal === activeIndex && ref.sourceGlobal === globalIndex) ||
      (activeIndex === globalIndex && (ref.sourceGlobal === globalIndex || ref.targetGlobal === globalIndex))
    ) || null;
  }

  getReferenceDescriptionForColumn(col: ConversationColumnState, ref: SentenceReference): string {
    if (!col.annotated) return '';
    const sentences = this.getAllSentencesForColumn(col);
    const sourceText = sentences.find(s => s.globalIndex === ref.sourceGlobal)?.text || '';
    const targetText = sentences.find(s => s.globalIndex === ref.targetGlobal)?.text || '';
    const artifactStr = ref.artifactId ? ` [${ref.artifactId}]` : '';
    return `[S${ref.sourceGlobal}] references [S${ref.targetGlobal}] (${this.referenceLabels[ref.type]}${artifactStr} - Strength ${ref.strength})`;
  }

  getSentenceBoundingBoxForColumn(col: ConversationColumnState, globalIndex: number): { x: number; y: number; w: number; h: number } {
    const layout = col.sentenceLayouts.get(globalIndex);
    if (!layout || layout.segments.length === 0) return { x: 0, y: 0, w: 0, h: 0 };
    
    const segments = layout.segments;
    const first = segments[0];
    const last = segments[segments.length - 1];
    
    const y = first.y;
    const h = (last.y + last.h) - first.y;
    
    const minX = Math.min(...segments.map(seg => seg.x));
    const maxX = Math.max(...segments.map(seg => seg.x + seg.w));
    const w = maxX - minX;
    
    return {
      x: minX,
      y,
      w,
      h
    };
  }

  getSentenceHighlightBoxForColumn(col: ConversationColumnState, globalIndex: number): { x: number; y: number; w: number; h: number } {
    const box = this.getSentenceBoundingBoxForColumn(col, globalIndex);
    if (box.w === 0) return { x: 0, y: 0, w: 0, h: 0 };
    
    const interval = col.sentenceArcIntervals.get(globalIndex);
    if (!interval) return { x: 0, y: 0, w: 0, h: 0 };

    const x = this.COL_LEFT;
    const w = this.COL_WIDTH;
    
    return {
      x,
      y: interval.yMin,
      w,
      h: interval.yMax - interval.yMin
    };
  }

  getActiveSentenceBoundingBoxForColumn(col: ConversationColumnState): { x: number; y: number; w: number; h: number } {
    const idx = col.hoveredSentenceGlobalIndex ?? col.selectedSentenceGlobalIndex;
    if (idx === null) return { x: 0, y: 0, w: 0, h: 0 };
    return this.getSentenceBoundingBoxForColumn(col, idx);
  }

  getAllSentencesForColumn(col: ConversationColumnState): AnnotatedSentence[] {
    if (!col.annotated) return [];
    return col.annotated.turns.flatMap(t => t.sentences);
  }

  calculateArcIntervalsForColumn(col: ConversationColumnState) {
    col.sentenceArcIntervals.clear();

    const activeRefs = this.getFilteredReferencesForColumn(col);
    const activeSentenceIndices = new Set<number>();
    for (const ref of activeRefs) {
      activeSentenceIndices.add(ref.sourceGlobal);
      activeSentenceIndices.add(ref.targetGlobal);
    }

    if (!col.annotated) return;

    for (const turn of col.annotated.turns) {
      const activeSentences = turn.sentences.filter(s => activeSentenceIndices.has(s.globalIndex));

      for (const s of turn.sentences) {
        if (!activeSentenceIndices.has(s.globalIndex)) {
          const box = this.getSentenceBoundingBoxForColumn(col, s.globalIndex);
          col.sentenceArcIntervals.set(s.globalIndex, {
            yMin: box.y - 1,
            yMax: box.y + box.h + 1
          });
        }
      }

      if (activeSentences.length > 0) {
        let totalStackHeight = 0;
        const thicknesses: number[] = [];
        for (const s of activeSentences) {
          const box = this.getSentenceBoundingBoxForColumn(col, s.globalIndex);
          const t = box.h + 2;
          thicknesses.push(t);
          totalStackHeight += t;
        }

        const firstBox = this.getSentenceBoundingBoxForColumn(col, activeSentences[0].globalIndex);
        const lastBox = this.getSentenceBoundingBoxForColumn(col, activeSentences[activeSentences.length - 1].globalIndex);
        const actualCenter = (firstBox.y + lastBox.y + lastBox.h) / 2;

        let yCursor = actualCenter - totalStackHeight / 2;

        for (let i = 0; i < activeSentences.length; i++) {
          const s = activeSentences[i];
          const t = thicknesses[i];
          col.sentenceArcIntervals.set(s.globalIndex, {
            yMin: yCursor,
            yMax: yCursor + t
          });
          yCursor += t;
        }
      }
    }
  }
}
