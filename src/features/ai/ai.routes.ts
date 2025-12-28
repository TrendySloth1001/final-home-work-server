/**
 * AI Routes
 * Define AI-powered endpoints
 */

import { Router } from 'express';
import {
  generateTextHandler,
  chatHandler,
  enhanceSyllabusHandler,
  generateSummaryHandler,
  aiHealthHandler,
  getUnifiedJobStatusHandler,
} from './ai.controller';

const router = Router();

/**
 * AI Routes - /api/v1/ai
 * AI-powered features including text generation, chat, and enhancements
 */

// Health check for AI service
router.get('/health', aiHealthHandler);                                     // GET /api/v1/ai/health

// Unified job status endpoint (for all AI job types)
router.get('/jobs/:jobId/status', getUnifiedJobStatusHandler);              // GET /api/v1/ai/jobs/:jobId/status

// General AI endpoints
router.post('/generate', generateTextHandler);                              // POST /api/v1/ai/generate
router.post('/chat', chatHandler);                                          // POST /api/v1/ai/chat

// Syllabus enhancement
router.post('/enhance', enhanceSyllabusHandler);                            // POST /api/v1/ai/enhance
router.post('/enhance/:syllabusId', enhanceSyllabusHandler);                // POST /api/v1/ai/enhance/:syllabusId

// Generate summary
router.post('/summary', generateSummaryHandler);                            // POST /api/v1/ai/summary
router.get('/summary/units/:unitId', generateSummaryHandler);               // GET /api/v1/ai/summary/units/:unitId

export default router;
