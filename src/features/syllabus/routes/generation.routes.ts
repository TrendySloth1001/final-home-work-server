import { Router } from 'express';
import {
    generateSyllabusHandler,
    getSyllabusGenerationStatusHandler
} from '../syllabus.controller';

const router = Router();

/**
 * AI Generation Routes - /api/v1/syllabi/:id/generate
 * Handles AI-powered syllabus generation and status tracking
 */

// AI generation for specific syllabus (mounted under /api/v1/syllabi/:id)
router.post('/', generateSyllabusHandler);                                  // POST /api/v1/syllabi/:id/generate
router.get('/status/:jobId', getSyllabusGenerationStatusHandler);           // GET /api/v1/syllabi/:id/generate/status/:jobId

export default router;
