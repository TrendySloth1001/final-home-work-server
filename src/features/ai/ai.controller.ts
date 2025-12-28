/**
 * AI Controller Layer
 * Handles HTTP requests for AI features
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../../shared/middleware/errorHandler';
import { ValidationError } from '../../shared/lib/errors';
import {
  generateTextService,
  chatService,
  enhanceSyllabusService,
  generateSummaryService,
  checkAIHealthService,
  getUnifiedJobStatusService,
} from './ai.service';

export const generateTextHandler = asyncHandler(async (req: Request, res: Response) => {
  const { prompt, temperature, maxTokens } = req.body;

  if (!prompt) {
    throw new ValidationError('Prompt is required');
  }

  const response = await generateTextService({ prompt, temperature, maxTokens });

  res.status(200).json({
    success: true,
    message: 'Text generated successfully',
    data: {
      prompt,
      response,
    },
  });
});

export const chatHandler = asyncHandler(async (req: Request, res: Response) => {
  const { messages, temperature } = req.body;

  if (!messages || !Array.isArray(messages)) {
    throw new ValidationError('Messages array is required');
  }

  const response = await chatService({ messages, temperature });

  res.status(200).json({
    success: true,
    message: 'Chat response generated successfully',
    data: {
      response,
    },
  });
});

export const enhanceSyllabusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { syllabusId } = req.params;
  const { syllabusId: bodySyllabusId, topicId, teacherId, focusAreas } = req.body;
  
  // Support both old endpoint (syllabusId in URL) and new endpoint (syllabusId/topicId in body)
  const targetSyllabusId = syllabusId || bodySyllabusId;
  const enhancementType = req.body.enhancementType || 'content';

  if (!targetSyllabusId && !topicId) {
    throw new ValidationError('Syllabus ID or Topic ID is required');
  }

  if (!teacherId) {
    throw new ValidationError('Teacher ID is required');
  }

  const result = await enhanceSyllabusService({ 
    syllabusId: targetSyllabusId, 
    topicId,
    enhancementType,
    teacherId,
    focusAreas 
  });

  res.status(200).json({
    success: true,
    message: result.message || 'Content enhanced successfully',
    data: result,
  });
});

export const generateSummaryHandler = asyncHandler(async (req: Request, res: Response) => {
  const { unitId } = req.params;
  const { topicId, unitId: bodyUnitId, teacherId, format } = req.body || {};
  
  // Support both old endpoint (unitId in URL) and new endpoint (unitId/topicId in body)
  const targetUnitId = unitId || bodyUnitId;
  const targetTopicId = topicId;

  if (!targetUnitId && !targetTopicId) {
    throw new ValidationError('Unit ID or Topic ID is required');
  }

  if (!teacherId && (targetTopicId || bodyUnitId)) {
    throw new ValidationError('Teacher ID is required');
  }

  const summary = await generateSummaryService(targetUnitId || targetTopicId, { format, teacherId });

  res.status(200).json({
    success: true,
    message: 'Summary generated successfully',
    data: {
      id: targetUnitId || targetTopicId,
      summary,
    },
  });
});

export const aiHealthHandler = asyncHandler(async (req: Request, res: Response) => {
  const health = await checkAIHealthService();

  res.status(health.status === 'healthy' ? 200 : 503).json({
    success: health.status === 'healthy',
    message: health.message,
    data: health,
  });
});

/**
 * Unified job status endpoint - works for all AI job types
 * GET /api/ai/job/:jobId/status
 */
export const getUnifiedJobStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;

  if (!jobId) {
    throw new ValidationError('Job ID is required');
  }

  const jobStatus = await getUnifiedJobStatusService(jobId);

  res.status(200).json({
    success: true,
    message: 'Job status retrieved successfully',
    data: jobStatus,
  });
});
