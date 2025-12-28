import { Router } from 'express';
import {
    getSyllabusVersionsHandler,
    getSyllabusVersionHandler,
    compareSyllabusVersionsHandler,
    setLatestVersionHandler
} from '../syllabus.controller';

const router = Router();

/**
 * Version Management Routes - /api/v1/syllabi/:id/versions
 * Handles syllabus versioning, comparison, and version control
 */

// Version routes (mounted under /api/v1/syllabi/:id)
router.get('/', getSyllabusVersionsHandler);                                // GET /api/v1/syllabi/:id/versions
router.get('/compare', compareSyllabusVersionsHandler);                     // GET /api/v1/syllabi/:id/versions/compare?v1=x&v2=y
router.get('/:versionId', getSyllabusVersionHandler);                       // GET /api/v1/syllabi/:id/versions/:versionId
router.patch('/:versionId/set-latest', setLatestVersionHandler);            // PATCH /api/v1/syllabi/:id/versions/:versionId/set-latest

export default router;
