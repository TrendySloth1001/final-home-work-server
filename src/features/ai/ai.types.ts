/**
 * AI Feature Types
 */

export interface GenerateTextRequest {
  prompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface ChatRequest {
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  temperature?: number;
}

export interface EnhanceSyllabusRequest {
  syllabusId?: string;
  topicId?: string;
  enhancementType: 'objectives' | 'overview' | 'teaching-strategies' | 'content';
  teacherId?: string;
  focusAreas?: string[];
}

export interface GenerateQuestionsRequest {
  topicId: string;
  questionType: 'mcq' | 'short-answer' | 'essay';
  difficulty: 'easy' | 'medium' | 'hard';
  count: number;
}
