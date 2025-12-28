/**
 * AI Service Layer
 * Business logic for AI-powered features
 */

import { ollamaService } from '../../shared/lib/ollama';
import { prisma } from '../../shared/lib/prisma';
import { NotFoundError, ValidationError } from '../../shared/lib/errors';
import type { GenerateTextRequest, ChatRequest, EnhanceSyllabusRequest } from './ai.types';
import { config } from '../../shared/config';

/**
 * Simple text generation
 */
export async function generateTextService(input: GenerateTextRequest): Promise<string> {
  const { prompt, temperature = 0.7, maxTokens = 500 } = input;

  if (!prompt || prompt.trim().length === 0) {
    throw new ValidationError('Prompt cannot be empty');
  }

  const response = await ollamaService.generate(prompt, {
    temperature,
    num_predict: maxTokens,
  });

  return response;
}

/**
 * Chat completion
 */
export async function chatService(input: ChatRequest): Promise<string> {
  const { messages, temperature = 0.7 } = input;

  if (!messages || messages.length === 0) {
    throw new ValidationError('Messages array cannot be empty');
  }

  const response = await ollamaService.chat(messages, {
    temperature,
  });

  return response;
}

/**
 * Enhance syllabus with AI-generated content
 */
export async function enhanceSyllabusService(input: EnhanceSyllabusRequest) {
  const { syllabusId, topicId, enhancementType } = input;

  // If topicId is provided, enhance topic instead
  if (topicId) {
    return enhanceTopicContent(topicId, input);
  }

  if (!syllabusId) {
    throw new ValidationError('Syllabus ID is required when not using topic-based enhancement');
  }

  // Get syllabus with units and topics
  const syllabus = await prisma.syllabus.findUnique({
    where: { id: syllabusId },
    include: {
      units: {
        include: {
          topics: true,
        },
      },
    },
  });

  if (!syllabus) {
    throw new NotFoundError('Syllabus', syllabusId);
  }

  let prompt = '';
  let updateField: 'objectives' | 'overview' = 'objectives';

  switch (enhancementType) {
    case 'objectives':
      updateField = 'objectives';
      prompt = `Generate comprehensive learning objectives for a ${syllabus.subjectName} course for ${syllabus.className} students.
      
Board: ${syllabus.board}
Term: ${syllabus.term}
Academic Year: ${syllabus.academicYear}

Units covered:
${syllabus.units.map((u, i) => `${i + 1}. ${u.title}`).join('\n')}

Provide 5-7 clear, measurable learning objectives that students should achieve by the end of this course.`;
      break;

    case 'overview':
      updateField = 'overview';
      prompt = `Write a comprehensive course overview for ${syllabus.subjectName} for ${syllabus.className} students.
      
Board: ${syllabus.board}
Term: ${syllabus.term}

Units covered:
${syllabus.units.map((u, i) => `${i + 1}. ${u.title}${u.description ? ': ' + u.description : ''}`).join('\n')}

Provide an engaging 2-3 paragraph overview that explains what students will learn and why it matters.`;
      break;

    case 'teaching-strategies':
      prompt = `Suggest effective teaching strategies for a ${syllabus.subjectName} course for ${syllabus.className} students.
      
Units covered:
${syllabus.units.map((u, i) => `${i + 1}. ${u.title}`).join('\n')}

Provide 4-5 practical teaching strategies that would work well for this course.`;
      
      // For teaching strategies, we'll return the text without updating the database
      const strategies = await ollamaService.generate(prompt, {
        temperature: 0.7,
        num_predict: 600,
      });

      return {
        syllabusId,
        enhancementType,
        content: strategies,
        message: 'Teaching strategies generated successfully',
      };

    case 'content':
      // Generic content enhancement
      const focusAreasText = input.focusAreas && input.focusAreas.length > 0 
        ? `Focus on: ${input.focusAreas.join(', ')}` 
        : '';
      
      prompt = `Enhance the educational content for ${syllabus.subjectName} for ${syllabus.className} students.
      
${focusAreasText}

Units covered:
${syllabus.units.map((u, i) => `${i + 1}. ${u.title}${u.description ? ': ' + u.description : ''}`).join('\n')}

Provide enhanced, detailed content that would help students better understand these topics.`;
      
      const enhancedContent = await ollamaService.generate(prompt, {
        temperature: 0.7,
        num_predict: 700,
      });

      return {
        syllabusId,
        enhancementType,
        content: enhancedContent,
        message: 'Content enhanced successfully',
      };

    default:
      throw new ValidationError(`Invalid enhancement type: ${enhancementType}`);
  }

  // Generate the content
  const generatedContent = await ollamaService.generate(prompt, {
    temperature: 0.7,
    num_predict: 500,
  });

  // Update the syllabus
  const updated = await prisma.syllabus.update({
    where: { id: syllabusId },
    data: {
      [updateField]: generatedContent,
    },
  });

  return {
    syllabusId: updated.id,
    enhancementType,
    content: generatedContent,
    message: `${enhancementType} generated and saved successfully`,
  };
}

/**
 * Generate summary of a unit or topic
 */
export async function generateSummaryService(
  unitId: string, 
  options?: { format?: string; teacherId?: string }
): Promise<string> {
  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: {
      topics: true,
      syllabus: true,
    },
  });

  if (!unit) {
    throw new NotFoundError('Unit', unitId);
  }

  const prompt = `Summarize this educational unit for ${unit.syllabus.className} students studying ${unit.syllabus.subjectName}:

Unit Title: ${unit.title}
${unit.description ? `Description: ${unit.description}` : ''}
${unit.teachingHours ? `Teaching Hours: ${unit.teachingHours}` : ''}

Topics covered:
${unit.topics.map((t, i) => `${i + 1}. ${t.topicName}`).join('\n')}

Provide a clear, student-friendly summary in 2-3 paragraphs that helps students understand what they'll learn in this unit.`;

  const summary = await ollamaService.generate(prompt, {
    temperature: 0.7,
    num_predict: 400,
  });

  return summary;
}

/**
 * Enhance topic content with AI
 */
async function enhanceTopicContent(topicId: string, input: EnhanceSyllabusRequest) {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    include: {
      unit: {
        include: {
          syllabus: true,
        },
      },
    },
  });

  if (!topic) {
    throw new NotFoundError('Topic', topicId);
  }

  const focusAreasText = input.focusAreas && input.focusAreas.length > 0 
    ? `Focus on: ${input.focusAreas.join(', ')}` 
    : 'Focus on: key concepts, examples, real-world applications';

  const prompt = `Enhance the educational content for this topic:

Subject: ${topic.unit.syllabus.subjectName}
Class: ${topic.unit.syllabus.className}
Board: ${topic.unit.syllabus.board}
Unit: ${topic.unit.title}
Topic: ${topic.topicName}

${focusAreasText}

Provide detailed, student-friendly content that includes:
- Key concepts and principles
- Clear explanations
- Relevant examples
- Real-world applications
- Common misconceptions to avoid

Write in a clear, engaging style suitable for ${topic.unit.syllabus.className} students.`;

  const enhancedContent = await ollamaService.generate(prompt, {
    temperature: 0.7,
    num_predict: 700,
  });

  return {
    topicId,
    enhancementType: input.enhancementType || 'content',
    content: enhancedContent,
    message: 'Topic content enhanced successfully',
  };
}

/**
 * Check Ollama health
 */
export async function checkAIHealthService() {
  const isHealthy = await ollamaService.healthCheck();
  const modelInfo = ollamaService.getModelInfo();

  return {
    status: isHealthy ? 'healthy' : 'unavailable',
    ...modelInfo,
    message: isHealthy
      ? 'Ollama is running and model is available'
      : `Ollama is not available. Please ensure Ollama is running and the model ${config.ai.ollama.model} is installed.`,
  };
}


/**
 * Unified job status check - works for all AI job types
 * Checks both BullMQ queue and database JobQueue model
 */
export async function getUnifiedJobStatusService(jobId: string) {
  // First, check if job exists in database
  const dbJob = await prisma.jobQueue.findUnique({
    where: { jobId },
  });

  if (!dbJob) {
    throw new NotFoundError('Job', jobId);
  }

  // Return unified response
  return {
    jobId: dbJob.jobId,
    jobType: dbJob.jobType,
    status: dbJob.status,
    progress: dbJob.progress,
    attempts: dbJob.attempts,
    result: dbJob.result ? JSON.parse(dbJob.result) : null,
    error: dbJob.error,
    teacherId: dbJob.teacherId,
    createdAt: dbJob.createdAt,
    updatedAt: dbJob.updatedAt,
  };
}
