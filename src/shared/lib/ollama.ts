/**
 * Ollama AI Provider
 * Handles communication with local Ollama instance
 */

import { config } from '../../shared/config';

export interface OllamaGenerateRequest {
  model: string;
  prompt: string;
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    repeat_penalty?: number;
    num_ctx?: number;
  };
}

export interface OllamaGenerateResponse {
  model: string;
  created_at: string;
  response: string;
  done: boolean;
  context?: number[];
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

export interface OllamaChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OllamaChatRequest {
  model: string;
  messages: OllamaChatMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    top_p?: number;
    top_k?: number;
    num_predict?: number;
    repeat_penalty?: number;
    num_ctx?: number;
  };
}

export interface OllamaChatResponse {
  model: string;
  created_at: string;
  message: OllamaChatMessage;
  done: boolean;
  total_duration?: number;
  load_duration?: number;
  prompt_eval_count?: number;
  eval_count?: number;
  eval_duration?: number;
}

class OllamaService {
  private baseUrl: string;
  private model: string;
  private timeout: number;

  // Optimized default options for educational content generation
  private readonly DEFAULT_OPTIONS = {
    temperature: 0.7,      // Balance creativity and consistency
    top_p: 0.9,           // Nucleus sampling for quality
    top_k: 40,            // Limit token choices for coherence
    repeat_penalty: 1.1,  // Reduce repetition
    num_ctx: 4096,        // Context window size
  };

  constructor() {
    this.baseUrl = config.ai.ollama.baseUrl;
    this.model = config.ai.ollama.model;
    this.timeout = config.ai.ollama.timeout;
  }

  /**
   * Get optimized options merged with custom options
   */
  private getOptions(customOptions?: OllamaGenerateRequest['options']): OllamaGenerateRequest['options'] {
    return {
      ...this.DEFAULT_OPTIONS,
      ...customOptions,
    };
  }

  /**
   * Generate text completion using Ollama
   */
  async generate(
    prompt: string,
    options?: OllamaGenerateRequest['options']
  ): Promise<string> {
    const url = `${this.baseUrl}/api/generate`;
    
    const mergedOptions = this.getOptions(options);
    const requestBody: any = {
      model: this.model,
      prompt,
      stream: false,
      // NOTE: format: 'json' removed - causes incomplete/corrupted responses
      // Models will return natural text which is more reliable
      ...(mergedOptions ? { options: mergedOptions } : {}),
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data: OllamaGenerateResponse = await response.json();
      return data.response;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          if (config.isDevelopment) {
            console.error('[Ollama/DEV] ❌ Request timed out!');
            console.error('[Ollama/DEV] Timeout:', this.timeout + 'ms', '(' + (this.timeout/1000) + 's)');
            console.error('[Ollama/DEV] Model:', this.model);
            console.error('[Ollama/DEV] Prompt length:', prompt.length, 'chars');
            console.error('[Ollama/DEV] Suggestion: Increase OLLAMA_TIMEOUT or use a faster model');
          }
          throw new Error(`Ollama request timed out after ${this.timeout}ms`);
        }
        if (config.isDevelopment) {
          console.error('[Ollama/DEV] ❌ Generation failed:', error.message);
        }
        throw new Error(`Failed to generate text: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Chat completion using Ollama
   */
  async chat(
    messages: OllamaChatMessage[],
    options?: OllamaChatRequest['options']
  ): Promise<string> {
    const url = `${this.baseUrl}/api/chat`;
    
    const mergedOptions = this.getOptions(options);
    const requestBody: OllamaChatRequest = {
      model: this.model,
      messages,
      stream: false,
      ...(mergedOptions ? { options: mergedOptions } : {}),
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeout);

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
      }

      const data: OllamaChatResponse = await response.json();
      return data.message.content;
    } catch (error) {
      if (error instanceof Error) {
        if (error.name === 'AbortError') {
          throw new Error(`Ollama request timed out after ${this.timeout}ms`);
        }
        throw new Error(`Failed to generate chat response: ${error.message}`);
      }
      throw error;
    }
  }

  /**
   * Stream text generation (returns async generator)
   */
  async *generateStream(
    prompt: string,
    options?: OllamaGenerateRequest['options']
  ): AsyncGenerator<string, void, unknown> {
    const url = `${this.baseUrl}/api/generate`;
    
    const requestBody: OllamaGenerateRequest = {
      model: this.model,
      prompt,
      stream: true,
      ...(options ? { options } : {}),
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      throw new Error(`Ollama API error: ${response.status} ${response.statusText}`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
      throw new Error('No response body available');
    }

    const decoder = new TextDecoder();
    
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value, { stream: true });
        const lines = chunk.split('\n').filter(line => line.trim());

        for (const line of lines) {
          try {
            const json: OllamaGenerateResponse = JSON.parse(line);
            if (json.response) {
              yield json.response;
            }
          } catch (e) {
            // Skip invalid JSON lines
            continue;
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Check if Ollama is available and the model is loaded
   */
async healthCheck(): Promise<boolean> {
  try {
    const url = `${this.baseUrl}/api/tags`;
    const response = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    const models = data.models || [];

    //  FIX: match base model name (qwen2.5) instead of full tag
    const baseModel = this.model.split(':')[0];

    return models.some(
      (m: any) =>
        m.name === this.model ||
        m.name.startsWith(this.model) ||
        m.name.startsWith(baseModel)
    );
  } catch {
    return false;
  }
}


  /**
   * Get current model info
   */
  getModelInfo() {
    return {
      provider: 'ollama',
      baseUrl: this.baseUrl,
      model: this.model,
      timeout: this.timeout,
    };
  }
}

// Export singleton instance
export const ollamaService = new OllamaService();
