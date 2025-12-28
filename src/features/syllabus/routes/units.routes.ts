import { Router } from 'express';
import {
    createUnitHandler,
    getAllUnitsBySyllabusIdHandler,
    getSingleUnitHandler,
    updateUnitHandler,
    deleteUnitHandler,
    calculateUnitCompletionHandler
} from '../syllabus.controller';

const router = Router();

/**
 * Unit Routes
 * Can be accessed both as nested resource and directly
 */

// Nested routes (mounted under /api/v1/syllabi/:syllabusId/units)
router.post('/', createUnitHandler);                                        // POST /api/v1/syllabi/:syllabusId/units
router.get('/', getAllUnitsBySyllabusIdHandler);                            // GET /api/v1/syllabi/:syllabusId/units

// Direct unit access (mounted under /api/v1/units)
router.get('/:id', getSingleUnitHandler);                                   // GET /api/v1/units/:id
router.patch('/:id', updateUnitHandler);                                    // PATCH /api/v1/units/:id
router.delete('/:id', deleteUnitHandler);                                   // DELETE /api/v1/units/:id
router.post('/:id/completion', calculateUnitCompletionHandler);             // POST /api/v1/units/:id/completion

export default router;
