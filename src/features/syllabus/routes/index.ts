import { Router } from 'express';
import { getCacheStatsHandler } from '../syllabus.controller';

// Import sub-routers
import syllabusRoutes from './syllabus.routes';
import generationRoutes from './generation.routes';
import versionsRoutes from './versions.routes';
import unitsRoutes from './units.routes';
import topicsRoutes from './topics.routes';

const router = Router();

/**
 * Main Syllabus Module Router
 * Organizes all syllabus-related routes with RESTful structure
 */

// Mount main syllabi routes at /api/v1/syllabi
router.use('/syllabi', syllabusRoutes);

// Mount nested routes for specific syllabus
router.use('/syllabi/generate', generationRoutes);
router.use('/syllabi/:id/versions', versionsRoutes);
router.use('/syllabi/:syllabusId/units', unitsRoutes);

// Mount direct resource routes
router.use('/units', unitsRoutes);
router.use('/units/:unitId/topics', topicsRoutes);
router.use('/topics', topicsRoutes);

// Utility routes
router.get('/cache/stats', getCacheStatsHandler);                           // GET /api/v1/cache/stats

export default router;
