import { Router } from 'express';
import { 
    createSyllabusHandler,
    updateSyllabusHandler, 
    getAllSyllabusByTeacherIdHandler, 
    getSingleSyllabusHandler,
    deleteSyllabusHandler,
    archiveSyllabusHandler,
    changeSyllabusStageHandler,
    calculateSyllabusCompletionHandler,
    publishSyllabusHandler,
    getSimilarSyllabiHandler,
    getSyllabusVersionsHandler,
    getSyllabusVersionHandler,
    compareSyllabusVersionsHandler,
    setLatestVersionHandler
} from '../syllabus.controller';

const router = Router();

/**
 * Syllabus Routes - /api/v1/syllabi
 * RESTful resource endpoints for syllabus management
 */

// Collection routes (order matters - specific routes before parameterized ones)
router.get('/teacher/:teacherId', getAllSyllabusByTeacherIdHandler);        // GET /api/v1/syllabi/teacher/:teacherId
router.get('/similar', getSimilarSyllabiHandler);                           // GET /api/v1/syllabi/similar

// CRUD operations
router.post('/', createSyllabusHandler);                                    // POST /api/v1/syllabi
router.get('/', getAllSyllabusByTeacherIdHandler);                          // GET /api/v1/syllabi?teacherId=xxx
router.get('/:id', getSingleSyllabusHandler);                               // GET /api/v1/syllabi/:id
router.patch('/:id', updateSyllabusHandler);                                // PATCH /api/v1/syllabi/:id
router.delete('/:id', deleteSyllabusHandler);                               // DELETE /api/v1/syllabi/:id

// Syllabus management actions
router.patch('/:id/archive', archiveSyllabusHandler);                       // PATCH /api/v1/syllabi/:id/archive
router.patch('/:id/stage', changeSyllabusStageHandler);                     // PATCH /api/v1/syllabi/:id/stage
router.patch('/:id/publish', publishSyllabusHandler);                       // PATCH /api/v1/syllabi/:id/publish
router.post('/:id/completion', calculateSyllabusCompletionHandler);         // POST /api/v1/syllabi/:id/completion

export default router;
