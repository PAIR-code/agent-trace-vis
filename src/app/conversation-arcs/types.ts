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
 * @fileoverview Type definitions for the Conversational Arcs visualization.
 */

/** Raw conversation from the WildChat HuggingFace API. */
export interface WildChatConversation {
  conversation_hash: string;
  model: string;
  turn: number;
  conversation: Array<{role: 'user' | 'assistant'; content: string}>;
  language?: string;
}

/** A fully annotated conversation ready for visualization. */
export interface AnnotatedConversation {
  id: string;
  model: string;
  turns: AnnotatedTurn[];
  totalSentences: number;
}

/** A single turn in the conversation with sentence-level annotations. */
export interface AnnotatedTurn {
  turnIndex: number;
  role: 'user' | 'assistant';
  content: string;
  sentences: AnnotatedSentence[];
}

/** A single sentence within a turn. */
export interface AnnotatedSentence {
  sentenceIndex: number;
  globalIndex: number;
  text: string;
  charLength: number;
  references: SentenceReference[];
}

/** A reference from one sentence to another across turns. */
export interface SentenceReference {
  sourceGlobal: number;
  targetGlobal: number;
  type: ReferenceType;
  strength: number;
  artifactId?: string;
}

/** The categorical types of cross-turn references. */
export type ReferenceType =
  | 'response'
  | 'summary'
  | 'artifact'
  | 'refusal';

/** Color palette for reference types. */
export const REFERENCE_COLORS: Record<ReferenceType, string> = {
  response: '#4A90D9',
  summary: '#50C878',
  artifact: '#9B59B6',
  refusal: '#E85858',
};

/** Human-readable labels for reference types. */
export const REFERENCE_LABELS: Record<ReferenceType, string> = {
  response: 'Response',
  summary: 'Summary',
  artifact: 'Artifact',
  refusal: 'Refusal',
};

/** All valid reference type values. */
export const ALL_REFERENCE_TYPES: ReferenceType[] = [
  'response',
  'summary',
  'artifact',
  'refusal',
];
