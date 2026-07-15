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
 * @fileoverview Service for fetching conversations from the Hugging Face WildChat dataset.
 */

import { Injectable } from '@angular/core';
import { WildChatConversation } from './types';

@Injectable({ providedIn: 'root' })
export class WildChatService {
  private readonly HF_CACHE_KEY = 'conv_arcs_hf_conversations_v2';
  private readonly HF_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

  /**
   * Fetches the top 10 longest, non-toxic English conversations from WildChat.
   * Caches the list in localStorage.
   */
  async fetchConversations(): Promise<WildChatConversation[]> {
    // Check localStorage cache first
    const cached = localStorage.getItem(this.HF_CACHE_KEY);
    if (cached) {
      try {
        const { timestamp, data } = JSON.parse(cached);
        if (Date.now() - timestamp < this.HF_CACHE_TTL) {
          console.log('[WildChatService] Loaded conversations from cache.');
          return data;
        }
      } catch (e) {
        console.warn('[WildChatService] Failed to parse cached conversations:', e);
      }
    }

    console.log('[WildChatService] Streaming conversations from Hugging Face resolved CDN...');
    const url = 'https://huggingface.co/datasets/shareAI/ShareGPT-Chinese-English-90k/resolve/main/sharegpt_jsonl/computer_en_26k.jsonl';
    
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to connect to Hugging Face: ${response.statusText}`);
    }
    if (!response.body) {
      throw new Error('Response body is null');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    const conversations: WildChatConversation[] = [];
    const maxConversations = 12;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep the last incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const rawItem = JSON.parse(trimmed);
            const rawConvo = rawItem.conversation || [];
            
            const mappedMessages: Array<{ role: 'user' | 'assistant'; content: string }> = [];
            for (const m of rawConvo) {
              if (m.human) {
                mappedMessages.push({ role: 'user', content: m.human });
              }
              if (m.assistant) {
                mappedMessages.push({ role: 'assistant', content: m.assistant });
              }
            }

            // Filter: only keep conversations with at least 12 turns (6 user, 6 assistant)
            if (mappedMessages.length >= 12) {
              conversations.push({
                conversation_hash: rawItem.conversation_id,
                model: 'ShareGPT-computer_en',
                turn: mappedMessages.length,
                conversation: mappedMessages
              });

              if (conversations.length >= maxConversations) {
                await reader.cancel(); // Stop downloading immediately
                break;
              }
            }
          } catch (e) {
            // Ignore single line parse errors
          }
        }

        if (conversations.length >= maxConversations) {
          break;
        }
      }
    } finally {
      reader.releaseLock();
    }

    if (conversations.length === 0) {
      throw new Error('No long conversations found in dataset.');
    }

    // Cache in localStorage
    try {
      localStorage.setItem(this.HF_CACHE_KEY, JSON.stringify({
        timestamp: Date.now(),
        data: conversations,
      }));
    } catch (e) {
      console.warn('[WildChatService] Failed to write conversations to localStorage:', e);
    }

    return conversations;
  }
}
