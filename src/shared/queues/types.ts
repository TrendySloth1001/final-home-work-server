/**
 * Job Queue Types
 * Define all job types and their data structures
 */

export interface AIGenerationJobData {
  type: 'question' | 'questions-batch' | 'summary' | 'enhancement' | 'syllabus-generation';
  teacherId: string;
  topicId?: string;
  unitId?: string;
  syllabusId?: string;
  
  // For question generation
  questionCount?: number;
  questionType?: string;
  difficulty?: string;
  
  // For enhancements
  enhancementType?: string;
  
  // For syllabus generation
  syllabusData?: {
    subjectName: string;
    className: string;
    board?: string;
    term?: string;
    academicYear?: string;
    description?: string;
  };
  
  // Metadata
  requestId?: string;
  priority?: number;
}

export interface AIGenerationJobResult {
  success: boolean;
  data?: any;
  error?: string;
  tokensUsed?: number;
  duration?: number;
  cost?: number;
}

export const JobTypes = {
  AI_GENERATION: 'ai-generation',
  QUESTION_GENERATION: 'question-generation',
  BATCH_QUESTION_GENERATION: 'batch-question-generation',
  SYLLABUS_ENHANCEMENT: 'syllabus-enhancement',
  CONTENT_SUMMARY: 'content-summary',
} as const;

export const JobPriority = {
  LOW: 1,
  NORMAL: 5,
  HIGH: 10,
  CRITICAL: 15,
} as const;
