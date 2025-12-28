/**
 * Question Types
 */

export interface CreateQuestionInput {
  topicId: string;
  teacherId: string;
  questionText: string;
  questionType: 'mcq' | 'short-answer' | 'essay' | 'true-false';
  difficulty: 'easy' | 'medium' | 'hard';
  points?: number;
  options?: string[]; // For MCQ
  correctAnswer?: string;
  explanation?: string;
}

export interface UpdateQuestionInput {
  questionText?: string;
  questionType?: 'mcq' | 'short-answer' | 'essay' | 'true-false';
  difficulty?: 'easy' | 'medium' | 'hard';
  points?: number;
  options?: string[];
  correctAnswer?: string;
  explanation?: string;
}

export interface GenerateQuestionsInput {
  topicId: string;
  teacherId: string;
  count: number;
  questionType?: 'mcq' | 'short-answer' | 'essay' | 'true-false';
  difficulty?: 'easy' | 'medium' | 'hard';
  useQueue?: boolean; // If true, process in background
}

export interface QuestionFilters {
  topicId?: string;
  teacherId?: string;
  questionType?: string;
  difficulty?: string;
  generatedBy?: 'ai' | 'manual';
}

export interface QuestionQueryOptions {
  page?: number;
  limit?: number;
  filters?: QuestionFilters;
}
