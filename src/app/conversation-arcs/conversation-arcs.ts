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
  isLoading = false;
  loadingPhase = '';

  // Reference visual settings
  referenceColors = REFERENCE_COLORS;
  referenceLabels = REFERENCE_LABELS;
  allReferenceTypes = ALL_REFERENCE_TYPES;

  // Layout properties for rendering
  svgHeight = 600;
  turnLabels: Array<{ text: string; x: number; y: number; align: string }> = [];
  sentenceLayouts = new Map<number, { x: number; y: number; w: number; h: number; role: string }>();

  constructor(
    private wildChatService: WildChatService,
    private referenceService: ReferenceService,
    private sanitizer: DomSanitizer,
    private cdr: ChangeDetectorRef
  ) {}

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
  }

  /**
   * Precalculates layout coordinates for sentence lines.
   */
  private calculateLayout(conversation: AnnotatedConversation) {
    let currentY = 30; // top padding
    const centerX = 300; // middle of SVG
    
    for (const turn of conversation.turns) {
      // Add turn label position
      this.turnLabels.push({
        text: turn.role === 'user' ? 'User' : 'Assistant',
        x: turn.role === 'user' ? centerX - 10 : centerX + 10,
        y: currentY + 10,
        align: turn.role === 'user' ? 'end' : 'start'
      });
      currentY += 16; // space for turn label

      for (const sentence of turn.sentences) {
        const w = Math.max(20, Math.min(sentence.charLength * 1.5, 250));
        const h = 3;
        const x = turn.role === 'user' ? centerX - w : centerX;
        
        this.sentenceLayouts.set(sentence.globalIndex, {
          x,
          y: currentY,
          w,
          h,
          role: turn.role
        });
        
        currentY += h + 4; // sentence height + spacer
      }
      
      currentY += 12; // gap between turns
    }
    
    this.svgHeight = currentY + 40; // bottom padding
  }

  getSentenceLayout(globalIndex: number) {
    return this.sentenceLayouts.get(globalIndex) || { x: 0, y: 0, w: 0, h: 0, role: '' };
  }

  /**
   * Generates a closed SVG path for a semicircular arc with variable thickness.
   */
  getArcPath(ref: SentenceReference): string {
    const layoutSource = this.getSentenceLayout(ref.sourceGlobal);
    const layoutTarget = this.getSentenceLayout(ref.targetGlobal);
    if (!layoutSource || !layoutTarget) return '';

    const ySource = layoutSource.y + 1.5;
    const yTarget = layoutTarget.y + 1.5;

    const yTop = Math.min(ySource, yTarget);
    const yBottom = Math.max(ySource, yTarget);
    const R = (yBottom - yTop) / 2;

    const centerX = 300;

    // Source is thicker (based on strength), Target is tapered thin (1px)
    const tSource = Math.max(1.5, ref.strength * 0.8);
    const tTarget = 1.0;

    const tTop = ySource < yTarget ? tSource : tTarget;
    const tBottom = ySource < yTarget ? tTarget : tSource;

    const rOuter = R + (tTop + tBottom) / 4;
    const rInner = R - (tTop + tBottom) / 4;

    // Arcs originate on the side of the SOURCE speaker
    const side = layoutSource.role === 'user' ? 'right' : 'left';

    if (side === 'right') {
      // Outer arc top-to-bottom (sweep=1), Line to inner bottom, Inner arc bottom-to-top (sweep=0), Close
      return `M ${centerX} ${yTop - tTop/2} 
              A ${rOuter} ${rOuter} 0 0 1 ${centerX} ${yBottom + tBottom/2} 
              L ${centerX} ${yBottom - tBottom/2} 
              A ${rInner} ${rInner} 0 0 0 ${centerX} ${yTop + tTop/2} Z`;
    } else {
      // Outer arc top-to-bottom (sweep=0), Line to inner bottom, Inner arc bottom-to-top (sweep=1), Close
      return `M ${centerX} ${yTop - tTop/2} 
              A ${rOuter} ${rOuter} 0 0 0 ${centerX} ${yBottom + tBottom/2} 
              L ${centerX} ${yBottom - tBottom/2} 
              A ${rInner} ${rInner} 0 0 1 ${centerX} ${yTop + tTop/2} Z`;
    }
  }

  getArcOpacity(ref: SentenceReference): number {
    return 0.15 + (ref.strength - 1) * 0.175;
  }

  getActiveReferenceOpacity(globalIndex: number): number {
    const ref = this.getActiveReferenceForSentence(globalIndex);
    return ref ? this.getArcOpacity(ref) * 0.6 : 0;
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
      const isConnected = this.isSentenceConnectedToActive(s.globalIndex);
      
      let classes = 'chat-sentence';
      if (isSelected) classes += ' selected';
      else if (isHovered) classes += ' hovered';
      else if (isConnected) classes += ' connected';

      // Style highlight if connected/active (no underline, clean color highlight background)
      let style = '';
      if (isConnected || isSelected || isHovered) {
        const activeRef = this.getActiveReferenceForSentence(s.globalIndex);
        if (activeRef) {
          const color = this.referenceColors[activeRef.type];
          style = `background-color: ${color}26;`;
        }
      }

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
   * Safe getter for sentence highlight box color.
   */
  getActiveSentenceColor(globalIndex: number): string {
    const ref = this.getActiveReferenceForSentence(globalIndex);
    if (ref) {
      return this.referenceColors[ref.type];
    }
    // Neutral slate highlight color if selected/hovered sentence itself has no active connection
    return '#94a3b8';
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

  getAllSentences(): AnnotatedSentence[] {
    if (!this.annotatedConversation) return [];
    return this.annotatedConversation.turns.flatMap(t => t.sentences);
  }
}
