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

@Component({
  selector: 'app-conversation-arcs',
  standalone: true,
  imports: [CommonModule, FormsModule, ConversationViewerComponent],
  templateUrl: './conversation-arcs.html',
  styleUrls: ['./conversation-arcs.css']
})
export class ConversationArcsComponent implements OnInit {
  @ViewChild('arcSvgContainer') arcSvgContainer!: ElementRef<HTMLDivElement>;

  // Dropdown options
  conversations: WildChatConversation[] = [];
  selectedConversationHash = '';
  
  // Active conversation state
  annotatedConversation: AnnotatedConversation | null = null;
  messages: ConversationMessage[] = [];
  references: SentenceReference[] = [];
  
  // Interactive states
  hoveredSentenceGlobalIndex: number | null = null;
  selectedSentenceGlobalIndex: number | null = null;
  selectedReferenceType: ReferenceType | null = null;
  
  // Controls
  minStrength = 1;
  maxArcRadius = 100;
  isLoading = false;
  loadingPhase = '';

  // Reference visual settings
  referenceColors = REFERENCE_COLORS;
  referenceLabels = REFERENCE_LABELS;
  allReferenceTypes = ALL_REFERENCE_TYPES;

  // Layout properties for rendering
  svgHeight = 600;
  readonly COL_LEFT = 290;
  readonly COL_WIDTH = 60;
  turnLabels: Array<{ text: string; x: number; y: number; align: string }> = [];
  sentenceLayouts = new Map<number, { role: string; segments: Array<{ x: number; y: number; w: number; h: number }> }>();
  sentenceArcIntervals = new Map<number, { yMin: number; yMax: number }>();

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
      if (this.conversations.length > 0) {
        this.selectedConversationHash = this.conversations[0].conversation_hash;
        await this.onConversationChange();
      }
    } catch (e) {
      console.error('Failed to load conversations:', e);
      alert('Failed to load conversations from Hugging Face.');
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  async onConversationChange() {
    const raw = this.conversations.find(c => c.conversation_hash === this.selectedConversationHash);
    if (!raw) return;

    this.isLoading = true;
    this.loadingPhase = 'Preprocessing conversation...';
    
    // Reset states
    this.annotatedConversation = null;
    this.messages = [];
    this.references = [];
    this.hoveredSentenceGlobalIndex = null;
    this.selectedSentenceGlobalIndex = null;
    this.selectedReferenceType = null;
    this.turnLabels = [];
    this.sentenceLayouts.clear();
    this.sentenceArcIntervals.clear();

    try {
      // Step 1: Preprocess conversation
      const annotated = this.referenceService.preprocessConversation(raw);
      this.annotatedConversation = annotated;

      // Map turns to messages for ConversationViewerComponent
      this.messages = annotated.turns.map(turn => ({
        id: `turn-${turn.turnIndex}`,
        speaker: turn.role === 'user' ? 'User' : 'Assistant',
        text: turn.content,
        data: turn // Attach full turn data for sentence rendering
      }));

      // Calculate coordinates for sentence lines
      this.calculateLayout(annotated);

      // Auto-run reference analysis ONLY if API key is already stored in localStorage
      if (this.hasStoredApiKey()) {
        await this.executeReferenceAnalysis();
      }

    } catch (e) {
      console.error('Preprocessing failed:', e);
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  hasStoredApiKey(): boolean {
    return !!localStorage.getItem('reasoning_vis_api_key');
  }

  async runReferenceAnalysis() {
    this.isLoading = true;
    try {
      const apiKey = this.referenceService.getApiKey();
      if (!apiKey) {
        alert('API Key is required to run reference analysis.');
        return;
      }
      await this.executeReferenceAnalysis();
    } catch (e) {
      console.error('Analysis failed:', e);
      alert('Analysis failed. Check console for details.');
    } finally {
      this.isLoading = false;
      this.cdr.detectChanges();
    }
  }

  private async executeReferenceAnalysis() {
    if (!this.annotatedConversation) return;
    
    this.loadingPhase = 'Analyzing references using Gemini...';
    const apiKey = localStorage.getItem('reasoning_vis_api_key') || '';
    if (!apiKey) return;

    const refs = await this.referenceService.analyzeReferences(this.annotatedConversation, apiKey);
    this.references = refs;

    // Associate references back to sentences for easy rendering
    this.mapReferencesToSentences(this.annotatedConversation, refs);

    // Calculate adjacent intervals for active reference endpoints
    this.calculateArcIntervals();
  }

  /**
   * Precalculates layout coordinates for sentence lines.
   */
  private calculateLayout(conversation: AnnotatedConversation) {
    let currentY = 30; // top padding
    
    for (const turn of conversation.turns) {
      // Add turn label position
      this.turnLabels.push({
        text: turn.role === 'user' ? 'User' : 'Assistant',
        x: turn.role === 'user' ? this.COL_LEFT : this.COL_LEFT + this.COL_WIDTH,
        y: currentY + 10,
        align: turn.role === 'user' ? 'start' : 'end'
      });
      currentY += 18; // space for turn label

      for (const sentence of turn.sentences) {
        let remaining = Math.max(20, sentence.charLength * 1.5);
        const segments: Array<{ x: number; y: number; w: number; h: number }> = [];
        const h = 3;
        
        while (remaining > 0) {
          const w = Math.min(remaining, this.COL_WIDTH);
          const x = turn.role === 'user' ? this.COL_LEFT : this.COL_LEFT + this.COL_WIDTH - w;
          
          segments.push({
            x,
            y: currentY,
            w,
            h
          });
          
          currentY += h + 2; // segment height + small spacing within the same sentence
          remaining -= w;
          if (remaining < 1) break;
        }
        
        currentY += 4; // gap between sentences in the same turn
        
        this.sentenceLayouts.set(sentence.globalIndex, {
          role: turn.role,
          segments
        });
      }
      
      currentY += 12; // gap between turns
    }
    
    this.svgHeight = currentY + 40; // bottom padding

    // Calculate adjacent intervals for highlight boxes (aligned with sentences, no vertical shift)
    const sentences = this.getAllSentences();
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const box = this.getSentenceBoundingBox(s.globalIndex);
      
      let yMin = box.y - 1;
      let yMax = box.y + box.h + 1;
      
      if (i > 0) {
        const prevBox = this.getSentenceBoundingBox(sentences[i - 1].globalIndex);
        yMin = (prevBox.y + prevBox.h + box.y) / 2;
      }
      
      if (i < sentences.length - 1) {
        const nextBox = this.getSentenceBoundingBox(sentences[i + 1].globalIndex);
        yMax = (box.y + box.h + nextBox.y) / 2;
      }
      
      this.sentenceArcIntervals.set(s.globalIndex, { yMin, yMax });
    }
  }

  getSentenceLayout(globalIndex: number) {
    return this.sentenceLayouts.get(globalIndex) || { role: '', segments: [] };
  }

  /**
   * Generates a closed SVG path for a semicircular arc with variable thickness.
   */
  getArcPath(ref: SentenceReference): string {
    const boxSource = this.getSentenceBoundingBox(ref.sourceGlobal);
    const boxTarget = this.getSentenceBoundingBox(ref.targetGlobal);
    if (boxSource.w === 0 || boxTarget.w === 0) return '';

    const intervalSource = this.sentenceArcIntervals.get(ref.sourceGlobal);
    const intervalTarget = this.sentenceArcIntervals.get(ref.targetGlobal);
    if (!intervalSource || !intervalTarget) return '';

    const ySource = (intervalSource.yMin + intervalSource.yMax) / 2;
    const yTarget = (intervalTarget.yMin + intervalTarget.yMax) / 2;

    const yTop = Math.min(ySource, yTarget);
    const yBottom = Math.max(ySource, yTarget);
    const R = (yBottom - yTop) / 2;

    const isRhs = ref.type === 'summary' || ref.type === 'artifact';
    const anchorX = isRhs ? this.COL_LEFT + this.COL_WIDTH : this.COL_LEFT;

    // Arc thickness matches the contiguous stacked interval height
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

    // Outer arc: sweep=1 for rhs, sweep=0 for lhs.
    // Inner arc: sweep=0 for rhs, sweep=1 for lhs.
    const sweepOuter = isRhs ? 1 : 0;
    const sweepInner = isRhs ? 0 : 1;

    return `M ${anchorX} ${yTop - tTop/2} 
            A ${rxOuter} ${ryOuter} 0 0 ${sweepOuter} ${anchorX} ${yBottom + tBottom/2} 
            L ${anchorX} ${yBottom - tBottom/2} 
            A ${rxInner} ${ryInner} 0 0 ${sweepInner} ${anchorX} ${yTop + tTop/2} Z`;
  }

  getArcOpacity(ref: SentenceReference): number {
    return 0.08 + (ref.strength - 1) * 0.08;
  }


  isArcDimmed(ref: SentenceReference): boolean {
    const activeIndex = this.hoveredSentenceGlobalIndex ?? this.selectedSentenceGlobalIndex;
    if (activeIndex === null) return false;
    return ref.sourceGlobal !== activeIndex && ref.targetGlobal !== activeIndex;
  }

  isArcHighlighted(ref: SentenceReference): boolean {
    const activeIndex = this.hoveredSentenceGlobalIndex ?? this.selectedSentenceGlobalIndex;
    if (activeIndex === null) return false;
    return ref.sourceGlobal === activeIndex || ref.targetGlobal === activeIndex;
  }

  private mapReferencesToSentences(conversation: AnnotatedConversation, refs: SentenceReference[]) {

    // Clear existing references
    for (const turn of conversation.turns) {
      for (const sentence of turn.sentences) {
        sentence.references = [];
      }
    }

    // Map new references
    const sentenceMap = new Map<number, AnnotatedSentence>();
    for (const turn of conversation.turns) {
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

  getSentenceStyle(globalIndex: number): string {
    const refs = this.getFilteredReferences().filter(ref => ref.targetGlobal === globalIndex);
    if (refs.length === 0) {
      const isActive = globalIndex === this.hoveredSentenceGlobalIndex || globalIndex === this.selectedSentenceGlobalIndex;
      if (isActive) {
        return 'background-color: rgba(15, 23, 42, 0.06);';
      }
      return '';
    }

    const gradients = refs.map(ref => {
      const color = this.referenceColors[ref.type];
      const isDimmed = this.isArcDimmed(ref);
      const alpha = isDimmed ? '03' : '26'; // 03 is ~1% opacity, 26 is ~15% opacity
      return `linear-gradient(0deg, ${color}${alpha}, ${color}${alpha})`;
    });

    let style = `background: ${gradients.join(', ')};`;
    
    const isActive = globalIndex === this.hoveredSentenceGlobalIndex || globalIndex === this.selectedSentenceGlobalIndex;
    if (isActive) {
      style += ' border-bottom: 2px solid #0f172a; font-weight: 500;';
    }
    return style;
  }

  getActiveSentenceSegments(): Array<{ x: number; y: number; w: number; h: number }> {
    const idx = this.hoveredSentenceGlobalIndex ?? this.selectedSentenceGlobalIndex;
    if (idx === null) return [];
    return this.getSentenceLayout(idx).segments;
  }

  /**
   * Safe HTML sentence renderer with highlighting wrappers.
   * Passed to ConversationViewerComponent.
   */
  getHighlightedText = (msg: ConversationMessage): SafeHtml => {
    const turn = msg.data;
    if (!turn || !turn.sentences) return msg.text;

    const html = turn.sentences.map((s: AnnotatedSentence) => {
      const isHovered = s.globalIndex === this.hoveredSentenceGlobalIndex;
      const isSelected = s.globalIndex === this.selectedSentenceGlobalIndex;
      
      let classes = 'chat-sentence';
      if (isSelected) classes += ' selected';
      else if (isHovered) classes += ' hovered';

      const style = this.getSentenceStyle(s.globalIndex);

      return `<span id="chat-sentence-${s.globalIndex}" class="${classes}" style="${style}" 
                    (click)="selectSentence(${s.globalIndex})">${s.text}</span>`;
    }).join(' ');

    return this.sanitizer.bypassSecurityTrustHtml(html);
  };

  /**
   * Speaker color mappings for chat bubble.
   */
  getSpeakerColor = (msg: ConversationMessage): string => {
    return '#0f172a'; // Clean black titles for both User and Assistant
  };

  getSpeakerBgColor = (msg: ConversationMessage): string => {
    return msg.speaker === 'User' ? 'rgba(74, 144, 217, 0.05)' : 'rgba(16, 185, 129, 0.05)';
  };

  getSpeakerBorder = (msg: ConversationMessage): string => {
    return msg.speaker === 'User' ? '1px solid rgba(74, 144, 217, 0.15)' : '1px solid rgba(16, 185, 129, 0.15)';
  };

  // ─── Interaction Handlers ───────────────────────────────────────────

  hoverSentence(globalIndex: number | null) {
    if (globalIndex !== null && this.hoveredSentenceGlobalIndex !== globalIndex) {
      // Scroll to sentence in chat view on hover
      setTimeout(() => {
        const el = document.getElementById(`chat-sentence-${globalIndex}`);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }, 50);
    }
    this.hoveredSentenceGlobalIndex = globalIndex;
  }

  selectSentence(globalIndex: number) {
    this.selectedSentenceGlobalIndex = globalIndex;
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    // If clicking outside SVG container, reset selections
    if (this.arcSvgContainer && !this.arcSvgContainer.nativeElement.contains(event.target as Node)) {
      // Check if clicking inside chat, if so don't clear (let selectSentence handle it)
      const chatPanel = document.querySelector('.chat-panel');
      if (chatPanel && chatPanel.contains(event.target as Node)) {
        // Find if they clicked a chat sentence
        const target = event.target as HTMLElement;
        if (target.classList.contains('chat-sentence')) {
          const idStr = target.id.replace('chat-sentence-', '');
          const idx = parseInt(idStr, 10);
          if (!isNaN(idx)) {
            this.selectSentence(idx);
            return;
          }
        }
      } else {
        this.selectedSentenceGlobalIndex = null;
      }
    }
  }

  // ─── Reference Helper Methods ──────────────────────────────────────

  getStrengthFilteredReferences(): SentenceReference[] {
    return this.references.filter(ref => ref.strength >= this.minStrength);
  }

  getFilteredReferences(): SentenceReference[] {
    return this.getStrengthFilteredReferences().filter(ref => 
      this.selectedReferenceType === null || ref.type === this.selectedReferenceType
    );
  }

  /**
   * Returns only reference types that are actively present in the strength-filtered references.
   */
  getUsedReferenceTypes(): ReferenceType[] {
    if (this.references.length === 0) return [];
    const activeTypes = new Set<ReferenceType>();
    for (const ref of this.getStrengthFilteredReferences()) {
      activeTypes.add(ref.type);
    }
    return this.allReferenceTypes.filter(type => activeTypes.has(type));
  }

  toggleReferenceTypeFilter(type: ReferenceType) {
    if (this.selectedReferenceType === type) {
      this.selectedReferenceType = null; // Toggle off (show all)
    } else {
      this.selectedReferenceType = type; // Toggle on (filter to this type)
    }
    this.calculateArcIntervals();
  }

  /**
   * Determines if a sentence is the source or target of an active/hovered reference.
   */
  isSentenceConnectedToActive(globalIndex: number): boolean {
    const activeIndex = this.hoveredSentenceGlobalIndex ?? this.selectedSentenceGlobalIndex;
    if (activeIndex === null) return false;
    if (activeIndex === globalIndex) return true;

    return this.getFilteredReferences().some(ref => 
      (ref.sourceGlobal === activeIndex && ref.targetGlobal === globalIndex) ||
      (ref.targetGlobal === activeIndex && ref.sourceGlobal === globalIndex)
    );
  }

  /**
   * Gets the active reference that connects to this sentence.
   */
  getActiveReferenceForSentence(globalIndex: number): SentenceReference | null {
    const activeIndex = this.hoveredSentenceGlobalIndex ?? this.selectedSentenceGlobalIndex;
    if (activeIndex === null) return null;

    return this.getFilteredReferences().find(ref => 
      (ref.sourceGlobal === activeIndex && ref.targetGlobal === globalIndex) ||
      (ref.targetGlobal === activeIndex && ref.sourceGlobal === globalIndex) ||
      (activeIndex === globalIndex && (ref.sourceGlobal === globalIndex || ref.targetGlobal === globalIndex))
    ) || null;
  }


  /**
   * Gets reference description text for tooltip/legend.
   */
  getReferenceDescription(ref: SentenceReference): string {
    if (!this.annotatedConversation) return '';
    const sentences = this.getAllSentences();
    const sourceText = sentences.find(s => s.globalIndex === ref.sourceGlobal)?.text || '';
    const targetText = sentences.find(s => s.globalIndex === ref.targetGlobal)?.text || '';
    return `[S${ref.sourceGlobal}] references [S${ref.targetGlobal}] (${this.referenceLabels[ref.type]} - Strength ${ref.strength})`;
  }

  getSentenceBoundingBox(globalIndex: number): { x: number; y: number; w: number; h: number } {
    const layout = this.sentenceLayouts.get(globalIndex);
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

  getSentenceHighlightBox(globalIndex: number): { x: number; y: number; w: number; h: number } {
    const box = this.getSentenceBoundingBox(globalIndex);
    if (box.w === 0) return { x: 0, y: 0, w: 0, h: 0 };
    
    const interval = this.sentenceArcIntervals.get(globalIndex);
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


  getActiveSentenceBoundingBox(): { x: number; y: number; w: number; h: number } {
    const idx = this.hoveredSentenceGlobalIndex ?? this.selectedSentenceGlobalIndex;
    if (idx === null) return { x: 0, y: 0, w: 0, h: 0 };
    return this.getSentenceBoundingBox(idx);
  }

  getAllSentences(): AnnotatedSentence[] {
    if (!this.annotatedConversation) return [];
    return this.annotatedConversation.turns.flatMap(t => t.sentences);
  }

  calculateArcIntervals() {
    this.sentenceArcIntervals.clear();

    const activeRefs = this.getFilteredReferences();
    const activeSentenceIndices = new Set<number>();
    for (const ref of activeRefs) {
      activeSentenceIndices.add(ref.sourceGlobal);
      activeSentenceIndices.add(ref.targetGlobal);
    }

    if (!this.annotatedConversation) return;

    for (const turn of this.annotatedConversation.turns) {
      // Find active sentences in this turn
      const activeSentences = turn.sentences.filter(s => activeSentenceIndices.has(s.globalIndex));

      // For inactive sentences, just map to actual box
      for (const s of turn.sentences) {
        if (!activeSentenceIndices.has(s.globalIndex)) {
          const box = this.getSentenceBoundingBox(s.globalIndex);
          this.sentenceArcIntervals.set(s.globalIndex, {
            yMin: box.y - 1,
            yMax: box.y + box.h + 1
          });
        }
      }

      if (activeSentences.length > 0) {
        // Calculate total stack height for active sentences
        let totalStackHeight = 0;
        const thicknesses: number[] = [];
        for (const s of activeSentences) {
          const box = this.getSentenceBoundingBox(s.globalIndex);
          const t = box.h + 2;
          thicknesses.push(t);
          totalStackHeight += t;
        }

        // Find actual vertical range of active sentences to center the stack
        const firstBox = this.getSentenceBoundingBox(activeSentences[0].globalIndex);
        const lastBox = this.getSentenceBoundingBox(activeSentences[activeSentences.length - 1].globalIndex);
        const actualCenter = (firstBox.y + lastBox.y + lastBox.h) / 2;

        let yCursor = actualCenter - totalStackHeight / 2;

        for (let i = 0; i < activeSentences.length; i++) {
          const s = activeSentences[i];
          const t = thicknesses[i];
          this.sentenceArcIntervals.set(s.globalIndex, {
            yMin: yCursor,
            yMax: yCursor + t
          });
          yCursor += t;
        }
      }
    }
  }
}
