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
    calculateUnitCompletionHandler,
    generateSyllabusHandler,
    getSyllabusGenerationStatusHandler,
    publishSyllabusHandler,
    createUnitHandler,
    getAllUnitsBySyllabusIdHandler,
    getSingleUnitHandler,
    updateUnitHandler,
    deleteUnitHandler,
    createTopicHandler,
    createMultipleTopicsHandler,
    getAllTopicsByUnitIdHandler,
    getSingleTopicHandler,
    updateTopicHandler,
    deleteTopicHandler,
    getTopicResourcesHandler,
    getSimilarSyllabiHandler,
    getSimilarTopicsHandler,
    getCacheStatsHandler,
    getSyllabusVersionsHandler,
    getSyllabusVersionHandler,
    compareSyllabusVersionsHandler,
    setLatestVersionHandler
} from './syllabus.controller';

const router = Router();

// AI Syllabus Generation routes
router.post('/syllabus/generate', generateSyllabusHandler);
router.get('/syllabus/generate/:jobId/status', getSyllabusGenerationStatusHandler);

// Syllabus routes
router.post('/syllabus', createSyllabusHandler);
router.get('/syllabus', getAllSyllabusByTeacherIdHandler); // Query param: ?teacherId=xxx
router.get('/syllabus/teacher/:teacherId', getAllSyllabusByTeacherIdHandler);
router.get('/syllabus/:syllabusId', getSingleSyllabusHandler);
router.patch('/syllabus/:syllabusId', updateSyllabusHandler);
router.delete('/syllabus/:syllabusId', deleteSyllabusHandler);

// Syllabus management
router.patch('/syllabus/:id/archive', archiveSyllabusHandler);
router.patch('/syllabus/:id/stage', changeSyllabusStageHandler);
router.patch('/syllabus/:id/publish', publishSyllabusHandler);
router.post('/syllabus/:id/calculate-completion', calculateSyllabusCompletionHandler);

// Nested route: Get units by syllabus
router.get('/syllabus/:syllabusId/units', getAllUnitsBySyllabusIdHandler);

// Unit routes
router.post('/syllabus/unit', createUnitHandler);
router.get('/unit/syllabus/:syllabusId', getAllUnitsBySyllabusIdHandler);
router.get('/unit/:unitId', getSingleUnitHandler);
router.patch('/syllabus/unit/:unitId', updateUnitHandler);
router.delete('/syllabus/unit/:unitId', deleteUnitHandler);
router.post('/unit/:id/calculate-completion', calculateUnitCompletionHandler);

// Nested route: Get topics by unit
router.get('/syllabus/unit/:unitId/topics', getAllTopicsByUnitIdHandler);

// Topic routes
router.post('/syllabus/topic', createTopicHandler);
router.post('/syllabus/topic/bulk', createMultipleTopicsHandler);
router.get('/topic/unit/:unitId', getAllTopicsByUnitIdHandler);
router.get('/topic/:topicId', getSingleTopicHandler);
router.patch('/syllabus/topic/:topicId', updateTopicHandler);
router.delete('/syllabus/topic/:topicId', deleteTopicHandler);

// Topic resources (web search results)
router.get('/topic/:topicId/resources', getTopicResourcesHandler);

// Vector search endpoints
router.get('/syllabus/similar', getSimilarSyllabiHandler);
router.get('/topic/:topicId/similar', getSimilarTopicsHandler);
router.get('/cache/stats', getCacheStatsHandler);

// Version management routes
router.get('/syllabus/versions', getSyllabusVersionsHandler); // Get all versions
router.get('/syllabus/version/:syllabusId', getSyllabusVersionHandler); // Get specific version
router.get('/syllabus/compare', compareSyllabusVersionsHandler); // Compare two versions
router.patch('/syllabus/:syllabusId/set-latest', setLatestVersionHandler); // Mark as latest

export default router;