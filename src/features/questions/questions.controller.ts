/**
 * Question Controller Layer
 * HTTP handlers for question endpoints
 */

import { Request, Response } from 'express';
import { asyncHandler } from '../../shared/middleware/errorHandler';
import { ValidationError } from '../../shared/lib/errors';
import {
  createQuestionService,
  generateQuestionsService,
  getQuestionsService,
  getQuestionService,
  updateQuestionService,
  deleteQuestionService,
  getGenerationJobStatusService,
} from './questions.service';
import { tryCatch } from 'bullmq';

export const createQuestionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { topicId, teacherId, questionText, questionType, difficulty, points, options, correctAnswer, explanation } = req.body;

  if (!topicId || !teacherId || !questionText || !questionType || !difficulty) {
    throw new ValidationError('Missing required fields: topicId, teacherId, questionText, questionType, difficulty');
  }

  const validTypes = ['mcq', 'short-answer', 'essay', 'true-false'];
  if (!validTypes.includes(questionType)) {
    throw new ValidationError(`Invalid questionType. Must be one of: ${validTypes.join(', ')}`);
  }

  const validDifficulties = ['easy', 'medium', 'hard'];
  if (!validDifficulties.includes(difficulty)) {
    throw new ValidationError(`Invalid difficulty. Must be one of: ${validDifficulties.join(', ')}`);
  }

  const question = await createQuestionService({
    topicId,
    teacherId,
    questionText,
    questionType,
    difficulty,
    points,
    options,
    correctAnswer,
    explanation,
  });

  res.status(201).json({
    success: true,
    message: 'Question created successfully',
    data: question,
  });
});

export const generateQuestionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { topicId, teacherId, count, questionType, difficulty, useQueue } = req.body;
  try {

    if (!topicId || !teacherId || !count) {
      throw new ValidationError('Missing required fields: topicId, teacherId, count');
    }

    if (count < 1 || count > 50) {
      throw new ValidationError('Count must be between 1 and 50');
    }

    const result = await generateQuestionsService({
      topicId,
      teacherId,
      count,
      questionType: questionType || 'mcq',
      difficulty: difficulty || 'medium',
      useQueue: useQueue !== undefined ? useQueue : count > 5, // Default to queue if count > 5
    });


    if (result.count !== count) {
      return res.status(500).json({
        success: false,
        message: `Expected to generate ${count} questions`,
        data: result,
      });

    } else {

      const statusCode = result.status === 'queued' ? 202 : 201;

      res.status(statusCode).json({
        success: true,
        message: result.status === 'queued'
          ? `Generating ${count} questions in background`
          : `Generated ${result.count} questions successfully`,
        data: result,
      });

    }
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'An error occurred while generating questions',
      error: error instanceof Error ? error.message : String(error),
    });
  }
});

export const getQuestionsHandler = asyncHandler(async (req: Request, res: Response) => {
  const { page, limit, topicId, teacherId, questionType, difficulty, generatedBy } = req.query;

  const options = {
    page: page ? parseInt(page as string) : 1,
    limit: limit ? parseInt(limit as string) : 20,
    filters: {
      ...(topicId && { topicId: topicId as string }),
      ...(teacherId && { teacherId: teacherId as string }),
      ...(questionType && { questionType: questionType as string }),
      ...(difficulty && { difficulty: difficulty as string }),
      ...(generatedBy && { generatedBy: generatedBy as 'ai' | 'manual' }),
    },
  };

  const result = await getQuestionsService(options);

  res.status(200).json({
    success: true,
    message: 'Questions retrieved successfully',
    ...result,
  });
});

export const getQuestionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;

  if (!questionId) {
    throw new ValidationError('Question ID is required');
  }

  const question = await getQuestionService(questionId);

  res.status(200).json({
    success: true,
    message: 'Question retrieved successfully',
    data: question,
  });
});

export const updateQuestionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;
  const updateData = req.body;

  if (!questionId) {
    throw new ValidationError('Question ID is required');
  }

  const question = await updateQuestionService(questionId, updateData);

  res.status(200).json({
    success: true,
    message: 'Question updated successfully',
    data: question,
  });
});

export const deleteQuestionHandler = asyncHandler(async (req: Request, res: Response) => {
  const { questionId } = req.params;

  if (!questionId) {
    throw new ValidationError('Question ID is required');
  }

  const result = await deleteQuestionService(questionId);

  res.status(200).json({
    success: true,
    ...result,
  });
});

export const getJobStatusHandler = asyncHandler(async (req: Request, res: Response) => {
  const { jobId } = req.params;
  const teacherId = req.query.teacherId as string | undefined;

  if (!jobId) {
    throw new ValidationError('Job ID is required');
  }

  if (!teacherId) {
    throw new ValidationError('Teacher ID is required');
  }
  const status = await getGenerationJobStatusService(jobId, teacherId);

  res.status(200).json({
    success: true,
    message: 'Job status retrieved successfully',
    data: status,
  });
});
