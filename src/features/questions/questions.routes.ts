/**
 * Question Routes
 */

import { Router } from 'express';
import {
  createQuestionHandler,
  generateQuestionsHandler,
  getQuestionsHandler,
  getQuestionHandler,
  updateQuestionHandler,
  deleteQuestionHandler,
  getJobStatusHandler,
} from './questions.controller';

const router = Router();

/**
 * Question Routes - /api/v1/questions
 * RESTful resource endpoints for question bank management
 */

// Specific routes first (before parameterized routes)
router.post('/generate', generateQuestionsHandler);                         // POST /api/v1/questions/generate
router.get('/job/:jobId', getJobStatusHandler);                             // GET /api/v1/questions/job/:jobId

// CRUD operations
router.post('/', createQuestionHandler);                                    // POST /api/v1/questions
router.get('/', getQuestionsHandler);                                       // GET /api/v1/questions
router.get('/:id', getQuestionHandler);                                     // GET /api/v1/questions/:id
router.patch('/:id', updateQuestionHandler);                                // PATCH /api/v1/questions/:id
router.delete('/:id', deleteQuestionHandler);                               // DELETE /api/v1/questions/:id

export default router;
