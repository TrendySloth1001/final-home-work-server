import { Router } from 'express';
import {
    createTopicHandler,
    createMultipleTopicsHandler,
    getAllTopicsByUnitIdHandler,
    getSingleTopicHandler,
    updateTopicHandler,
    deleteTopicHandler,
    getTopicResourcesHandler,
    getSimilarTopicsHandler
} from '../syllabus.controller';

const router = Router();

/**
 * Topic Routes
 * Can be accessed both as nested resource and directly
 */

// Nested routes (mounted under /api/v1/units/:unitId/topics)
router.post('/', createTopicHandler);                                       // POST /api/v1/units/:unitId/topics
router.post('/bulk', createMultipleTopicsHandler);                          // POST /api/v1/units/:unitId/topics/bulk
router.get('/', getAllTopicsByUnitIdHandler);                               // GET /api/v1/units/:unitId/topics

// Direct topic access (mounted under /api/v1/topics)
router.get('/:id', getSingleTopicHandler);                                  // GET /api/v1/topics/:id
router.patch('/:id', updateTopicHandler);                                   // PATCH /api/v1/topics/:id
router.delete('/:id', deleteTopicHandler);                                  // DELETE /api/v1/topics/:id

// Topic features
router.get('/:id/resources', getTopicResourcesHandler);                     // GET /api/v1/topics/:id/resources
router.get('/:id/similar', getSimilarTopicsHandler);                        // GET /api/v1/topics/:id/similar

export default router;
