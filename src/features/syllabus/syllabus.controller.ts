/**
 * Controller Layer for Syllabus API
 * Handles HTTP requests and responses using async handlers
 */

import { Request, Response, NextFunction } from 'express';
import { asyncHandler } from '../../shared/middleware/errorHandler';
import { ValidationError } from '../../shared/lib/errors';
import { prisma } from '../../shared/lib/prisma';
import { searchSimilarSyllabi, searchSimilarTopics, getCacheStats } from '../../shared/lib/vectorSearch';
import { 
    createSyllabusService,
    updateSyllabusService,
    getAllSyllabusByTeacherIdService, 
    getSingleSyllabusService,
    deleteSyllabusService,
    archiveSyllabusService,
    changeSyllabusStageService,
    calculateSyllabusCompletionService,
    calculateUnitCompletionService,
    queueSyllabusGenerationService,
    getSyllabusGenerationStatusService,
    publishSyllabusService,
    createUnitService,
    getAllUnitsBySyllabusIdService,
    getSingleUnitService,
    updateUnitService,
    deleteUnitService,
    createTopicService,
    createMultipleTopicsService,
    getAllTopicsByUnitIdService,
    getSingleTopicService,
    updateTopicService,
    deleteTopicService,
    getSyllabusVersionsService,
    getSyllabusVersionService,
    compareSyllabusVersionsService,
    setLatestVersionService
} from './syllabus.service';


export const createSyllabusHandler = asyncHandler(async (req: Request, res: Response) => {
    const { teacherId, subjectName, className, board, term, academicYear, overview, objectives, prerequisites, assessmentMethods, resources } = req.body;

    // Validation
    if (!teacherId || !subjectName || !className || !board || !term || !academicYear) {
        throw new ValidationError('Missing required fields: teacherId, subjectName, className, board, term, academicYear');
    }

    const syllabus = await createSyllabusService({
        teacherId,
        subjectName,
        className,
        board,
        term,
        academicYear,
        overview,
        objectives,
        prerequisites,
        assessmentMethods,
        resources,
    });

    res.status(201).json({
        success: true,
        message: 'Syllabus created successfully',
        data: syllabus
    });
});

export const updateSyllabusHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const updateData = req.body;

    if (!id) {
        throw new ValidationError('Syllabus ID is required');
    }

    const syllabus = await updateSyllabusService(id, updateData);

    res.status(200).json({
        success: true,
        message: 'Syllabus updated successfully',
        data: syllabus
    });
});

export const getAllSyllabusByTeacherIdHandler = asyncHandler(async (req: Request, res: Response) => {
    const { teacherId } = req.params;
    const { page, limit, includeUnits, includeTopics } = req.query;
    const teacherIdFromQuery = (req.query.teacherId as string) || teacherId;

    if (!teacherIdFromQuery) {
        throw new ValidationError('Teacher ID is required (provide as URL param or query param)');
    }

    const options = {
        ...(page && { page: parseInt(page as string) }),
        ...(limit && { limit: parseInt(limit as string) }),
        ...(includeUnits !== undefined && { includeUnits: includeUnits === 'true' }),
        ...(includeTopics !== undefined && { includeTopics: includeTopics === 'true' })
    };

    const syllabuses = await getAllSyllabusByTeacherIdService(teacherIdFromQuery, options);

    res.status(200).json({
        success: true,
        message: 'Syllabuses retrieved successfully',
        count: syllabuses.length,
        data: syllabuses
    });
});

export const getSingleSyllabusHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Syllabus ID is required');
    }

    const syllabus = await getSingleSyllabusService(id);

    res.status(200).json({
        success: true,
        message: 'Syllabus retrieved successfully',
        data: syllabus
    });
});

export const deleteSyllabusHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Syllabus ID is required');
    }

    const result = await deleteSyllabusService(id);

    res.status(200).json({
        success: true,
        ...result
    });
});


export const createUnitHandler = asyncHandler(async (req: Request, res: Response) => {
    const { syllabusId, teacherId, title, description, teachingHours } = req.body;

    if (!syllabusId || !teacherId || !title) {
        throw new ValidationError('Missing required fields: syllabusId, teacherId, title');
    }

    const unit = await createUnitService({
        syllabusId,
        teacherId,
        title,
        description,
        teachingHours
    });

    res.status(201).json({
        success: true,
        message: 'Unit created successfully',
        data: unit
    });
});

export const getAllUnitsBySyllabusIdHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Syllabus ID is required');
    }

    const units = await getAllUnitsBySyllabusIdService(id);

    res.status(200).json({
        success: true,
        message: 'Units retrieved successfully',
        count: units.length,
        data: units
    });
});

export const getSingleUnitHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Unit ID is required');
    }

    const unit = await getSingleUnitService(id);

    res.status(200).json({
        success: true,
        message: 'Unit retrieved successfully',
        data: unit
    });
});

export const updateUnitHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { title, description, teachingHours } = req.body;

    if (!id) {
        throw new ValidationError('Unit ID is required');
    }

    const unit = await updateUnitService(id, {
        title,
        description,
        teachingHours
    });

    res.status(200).json({
        success: true,
        message: 'Unit updated successfully',
        data: unit
    });
});

export const deleteUnitHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Unit ID is required');
    }

    const result = await deleteUnitService(id);

    res.status(200).json({
        success: true,
        ...result
    });
});


export const createTopicHandler = asyncHandler(async (req: Request, res: Response) => {
    const { unitId, teacherId, topicName } = req.body;

    if (!unitId || !teacherId || !topicName) {
        throw new ValidationError('Missing required fields: unitId, teacherId, topicName');
    }

    const topic = await createTopicService({
        unitId,
        teacherId,
        topicName
    });

    res.status(201).json({
        success: true,
        message: 'Topic created successfully',
        data: topic
    });
});

export const createMultipleTopicsHandler = asyncHandler(async (req: Request, res: Response) => {
    const { unitId, teacherId, topics, topicNames } = req.body;

    // Support both 'topics' (array of objects) and 'topicNames' (array of strings) for backward compatibility
    const topicsArray = topics || topicNames;

    if (!unitId || !teacherId || !topicsArray || !Array.isArray(topicsArray)) {
        throw new ValidationError('unitId, teacherId, and topics (array) are required');
    }

    const createdTopics = await createMultipleTopicsService(unitId, teacherId, topicsArray);

    res.status(201).json({
        success: true,
        message: `${createdTopics.length} topics created successfully`,
        data: createdTopics
    });
});

export const getAllTopicsByUnitIdHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Unit ID is required');
    }

    const topics = await getAllTopicsByUnitIdService(id);

    res.status(200).json({
        success: true,
        message: 'Topics retrieved successfully',
        count: topics.length,
        data: topics
    });
});

export const getSingleTopicHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Topic ID is required');
    }

    const topic = await getSingleTopicService(id);

    res.status(200).json({
        success: true,
        message: 'Topic retrieved successfully',
        data: topic
    });
});

export const updateTopicHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { topicName, description } = req.body;

    if (!id) {
        throw new ValidationError('Topic ID is required');
    }

    if (!topicName && description === undefined) {
        throw new ValidationError('At least one field (topicName or description) is required');
    }

    const topic = await updateTopicService(id, { topicName, description });

    res.status(200).json({
        success: true,
        message: 'Topic updated successfully',
        data: topic
    });
});

export const deleteTopicHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Topic ID is required');
    }

    const result = await deleteTopicService(id);

    res.status(200).json({
        success: true,
        ...result
    });
});


export const archiveSyllabusHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { teacherId, archive = true } = req.body;

    if (!id || !teacherId) {
        throw new ValidationError('Syllabus ID and teacherId are required');
    }

    const syllabus = await archiveSyllabusService(id, teacherId, archive);

    res.status(200).json({
        success: true,
        message: archive ? 'Syllabus archived successfully' : 'Syllabus unarchived successfully',
        data: syllabus
    });
});


export const changeSyllabusStageHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { teacherId, stage } = req.body;

    if (!id || !teacherId || !stage) {
        throw new ValidationError('Syllabus ID, teacherId, and stage are required');
    }

    if (!['draft', 'published', 'archived'].includes(stage)) {
        throw new ValidationError('Stage must be one of: draft, published, archived');
    }

    const syllabus = await changeSyllabusStageService(id, teacherId, stage);

    res.status(200).json({
        success: true,
        message: `Syllabus stage changed to ${stage}`,
        data: syllabus
    });
});


export const calculateSyllabusCompletionHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Syllabus ID is required');
    }

    const syllabus = await calculateSyllabusCompletionService(id);

    res.status(200).json({
        success: true,
        message: 'Completion percentage calculated',
        data: {
            syllabusId: syllabus.id,
            completionStage: syllabus.completionStage
        }
    });
});


export const calculateUnitCompletionHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Unit ID is required');
    }

    const unit = await calculateUnitCompletionService(id);

    res.status(200).json({
        success: true,
        message: 'Unit completion percentage calculated',
        data: {
            unitId: unit.id,
            completionStage: unit.completionStage
        }
    });
});


export const generateSyllabusHandler = asyncHandler(async (req: Request, res: Response) => {
    const { teacherId, subjectName, className, board, term, academicYear, description } = req.body;

    // Validation
    if (!teacherId || !subjectName || !className) {
        throw new ValidationError('teacherId, subjectName, and className are required');
    }

    const result = await queueSyllabusGenerationService({
        teacherId,
        subjectName,
        className,
        board,
        term,
        academicYear,
        description
    });

    res.status(202).json({
        success: true,
        message: 'Syllabus generation started',
        data: {
            jobId: result.jobId,
            estimatedTime: '30-60 seconds'
        }
    });
});


export const getSyllabusGenerationStatusHandler = asyncHandler(async (req: Request, res: Response) => {
    const { jobId } = req.params;

    if (!jobId) {
        throw new ValidationError('Job ID is required');
    }

    const status = await getSyllabusGenerationStatusService(jobId);

    res.status(200).json({
        success: true,
        message: 'Job status retrieved',
        data: status
    });
});


export const publishSyllabusHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { teacherId } = req.body;

    if (!id) {
        throw new ValidationError('Syllabus ID is required');
    }

    if (!teacherId) {
        throw new ValidationError('teacherId is required');
    }

    const syllabus = await publishSyllabusService(id, teacherId);

    res.status(200).json({
        success: true,
        message: 'Syllabus published successfully',
        data: syllabus
    });
});


export const getTopicResourcesHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;

    if (!id) {
        throw new ValidationError('Topic ID is required');
    }

    const resources = await prisma.topicResource.findMany({
        where: { topicId: id },
        orderBy: [
            { relevance: 'desc' },
            { createdAt: 'desc' }
        ],
    });

    res.status(200).json({
        success: true,
        message: `Found ${resources.length} resources for topic`,
        data: resources,
        count: resources.length,
    });
});


export const getSimilarSyllabiHandler = asyncHandler(async (req: Request, res: Response) => {
    const { subject, className, board, limit } = req.query;

    if (!subject || !className) {
        throw new ValidationError('subject and className are required query parameters');
    }

    const results = await searchSimilarSyllabi({
        subject: subject as string,
        className: className as string,
        board: board as string,
        limit: limit ? parseInt(limit as string) : 5,
    });

    res.status(200).json({
        success: true,
        message: `Found ${results.length} similar syllabi`,
        data: results,
        count: results.length,
    });
});


export const getSimilarTopicsHandler = asyncHandler(async (req: Request, res: Response) => {
    const { id } = req.params;
    const { limit } = req.query;

    if (!id) {
        throw new ValidationError('Topic ID is required');
    }

    // Get the topic details first
    const topic = await prisma.topic.findUnique({
        where: { id },
        select: { topicName: true, description: true, keywords: true },
    });

    if (!topic) {
        throw new ValidationError('Topic not found');
    }

    // Search for similar topics
    const searchText = `${topic.topicName} ${topic.description || ''} ${topic.keywords || ''}`;
    const results = await searchSimilarTopics(
        searchText,
        limit ? parseInt(limit as string) : 10
    );

    res.status(200).json({
        success: true,
        message: `Found ${results.length} similar topics`,
        data: results,
        count: results.length,
    });
});


export const getCacheStatsHandler = asyncHandler(async (req: Request, res: Response) => {
    const stats = await getCacheStats();

    res.status(200).json({
        success: true,
        message: 'Cache statistics retrieved',
        data: {
            vectorDB: stats,
            webSearchCache: await prisma.webSearchCache.count(),
            topicResources: await prisma.topicResource.count(),
        },
    });
});

/**
 * Get all versions of a syllabus
 * GET /api/syllabus/versions?teacherId=xxx&subjectName=xxx&className=xxx&board=xxx&term=xxx&academicYear=xxx
 */
export const getSyllabusVersionsHandler = asyncHandler(async (req: Request, res: Response) => {
    const { teacherId, subjectName, className, board, term, academicYear } = req.query;

    if (!teacherId || !subjectName || !className || !board || !term || !academicYear) {
        throw new ValidationError('Missing required query parameters: teacherId, subjectName, className, board, term, academicYear');
    }

    const versions = await getSyllabusVersionsService(
        teacherId as string,
        subjectName as string,
        className as string,
        board as string,
        term as string,
        academicYear as string
    );

    res.status(200).json({
        success: true,
        message: `Found ${versions.length} version(s)`,
        data: versions,
        count: versions.length
    });
});

/**
 * Get a specific version with full details
 * GET /api/syllabus/version/:syllabusId?teacherId=xxx
 */
export const getSyllabusVersionHandler = asyncHandler(async (req: Request, res: Response) => {
    const { versionId } = req.params;
    const { teacherId } = req.query;

    if (!versionId || !teacherId) {
        throw new ValidationError('versionId and teacherId are required');
    }

    const version = await getSyllabusVersionService(versionId, teacherId as string);

    res.status(200).json({
        success: true,
        message: 'Syllabus version retrieved successfully',
        data: version
    });
});

/**
 * Compare two versions of a syllabus
 * GET /api/syllabus/compare?version1=xxx&version2=xxx&teacherId=xxx
 */
export const compareSyllabusVersionsHandler = asyncHandler(async (req: Request, res: Response) => {
    const { version1, version2, teacherId } = req.query;

    if (!version1 || !version2 || !teacherId) {
        throw new ValidationError('version1, version2, and teacherId are required');
    }

    const comparison = await compareSyllabusVersionsService(
        version1 as string,
        version2 as string,
        teacherId as string
    );

    res.status(200).json({
        success: true,
        message: 'Version comparison completed',
        data: comparison
    });
});

/**
 * Mark a version as the latest/active one
 * PATCH /api/syllabus/:syllabusId/set-latest?teacherId=xxx
 */
export const setLatestVersionHandler = asyncHandler(async (req: Request, res: Response) => {
    const { versionId } = req.params;
    const { teacherId } = req.query;

    if (!versionId || !teacherId) {
        throw new ValidationError('versionId and teacherId are required');
    }

    const updated = await setLatestVersionService(versionId, teacherId as string);

    res.status(200).json({
        success: true,
        message: 'Version marked as latest successfully',
        data: updated
    });
});