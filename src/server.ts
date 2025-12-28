import 'dotenv/config';
import express from 'express';
import path from 'path';
import syllabusRoutes from './features/syllabus/routes/index';
import aiRoutes from './features/ai/ai.routes';
import questionRoutes from './features/questions/questions.routes';
import notificationRoutes from './features/notifications/notifications.routes';
import { errorHandler } from './shared/middleware/errorHandler';
import { config, logConfig } from './shared/config';
import { prisma } from './shared/lib/prisma';
import { embeddingService } from './shared/lib/embeddings';
import { qdrantService } from './shared/lib/qdrant';

const app = express();

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
// app.use(express.static(path.join(__dirname, '../public')));    // Uncomment if you have static assets to serve

/**
 * API Routes
 * RESTful API endpoints
 */
app.use('/api', syllabusRoutes);                                            // Syllabi, Units, Topics
app.use('/api/ai', aiRoutes);                                               // AI-powered features
app.use('/api/questions', questionRoutes);                                  // Question bank
app.use('/api/notifications', notificationRoutes);                          // Notifications




// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is healthy',
    environment: config.nodeEnv,
    timestamp: new Date().toISOString()
  });
});

// Database health check endpoint
app.get('/health/db', async (req, res) => {
  const start = Date.now();

  try {
    await prisma.$queryRaw`SELECT 1`;

    const dbInfo = await prisma.$queryRaw<Array<{ version: string }>>`
      SELECT version()
    `;
    const postgresVersion = dbInfo[0]?.version || 'Unknown';

    const extensions = await prisma.$queryRaw<
      Array<{ extname: string; extversion: string }>
    >`
      SELECT extname, extversion
      FROM pg_extension
      WHERE extname IN ('vector', 'uuid-ossp', 'pg_trgm')
    `;

    const [
      syllabusCount,
      unitCount,
      topicCount,
      questionCount,
      aiGenerationCount,
      notificationCount
    ] = await Promise.all([
      prisma.syllabus.count(),
      prisma.unit.count(),
      prisma.topic.count(),
      prisma.question.count(),
      prisma.aIGeneration.count(),
      prisma.notification.count()
    ]);

    const dbSize = await prisma.$queryRaw<Array<{ size: string }>>`
      SELECT pg_size_pretty(pg_database_size(current_database())) AS size
    `;

    const duration = Date.now() - start;

    res.status(200).json({
      success: true,
      message: 'Database is healthy',
      database: {
        connected: true,
        type: 'PostgreSQL',
        version: postgresVersion.split(' ')[0] + ' ' + postgresVersion.split(' ')[1],
        size: dbSize[0]?.size || 'Unknown',
        responseTime: `${duration}ms`,
        connectionUrl: config.database.url.replace(/:[^:@]+@/, ':***@')
      },
      extensions: extensions.reduce((acc, ext) => {
        acc[ext.extname] = ext.extversion;
        return acc;
      }, {} as Record<string, string>),
      statistics: {
        syllabuses: syllabusCount,
        units: unitCount,
        topics: topicCount,
        questions: questionCount,
        aiGenerations: aiGenerationCount,
        notifications: notificationCount,
        total:
          syllabusCount +
          unitCount +
          topicCount +
          questionCount +
          aiGenerationCount +
          notificationCount
      },
      timestamp: new Date().toISOString()
    });
  } catch (error: any) {
    res.status(503).json({
      success: false,
      message: 'Database health check failed',
      database: {
        connected: false
      },
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

// API Routes

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    success: true,
    message: 'Syllabus Management API',
    version: '1.0.0',
    endpoints: {
      health: '/health',
      databaseHealth: '/health/db',
      databaseInfo: '/api/database/info',
      syllabus: '/api/syllabus',
      units: '/api/unit',
      topics: '/api/topic',
      questions: {
        create: 'POST /api/questions',
        generate: 'POST /api/questions/generate',
        list: 'GET /api/questions',
        get: 'GET /api/questions/:id',
        update: 'PATCH /api/questions/:id',
        delete: 'DELETE /api/questions/:id',
        jobStatus: 'GET /api/questions/job/:jobId'
      },
      ai: {
        health: '/api/ai/health',
        generate: '/api/ai/generate',
        chat: '/api/ai/chat',
        enhanceSyllabus: '/api/ai/enhance-syllabus/:syllabusId',
        summary: '/api/ai/summary/unit/:unitId'
      },
      notifications:{
        create: 'POST /api/notifications',
        list: 'GET /api/notifications',
        get: 'GET /api/notifications/:id',
        markAsRead: 'PATCH /api/notifications/:id/read',
        markAllAsRead: 'PATCH /api/notifications/read-all',
        delete: 'DELETE /api/notifications/:id',
        deleteAll: 'DELETE /api/notifications'
      },

    }
  });
});

// Global error handler (must be last)
app.use(errorHandler);

/**
 * Initialize RAG services on startup
 */
async function initializeServices() {
  console.log('\n:: Initializing RAG services...\n');
  
  try {
    // Initialize Qdrant collections
    await qdrantService.initializeCollections();
    
    // Warmup embedding service (downloads model on first use)
    await embeddingService.warmup();
    
    console.log('\n:: All RAG services initialized successfully\n');
  } catch (error) {
    console.error('\n:: Failed to initialize RAG services:', error);
    console.log(':: Server will continue without RAG features\n');
  }
}

app.listen(config.port, async () => {
  console.log(`\n:: Server is running at http://localhost:${config.port}\n`);
  logConfig();
  
  // Initialize RAG services in background
  initializeServices().catch(err => {
    console.error(':: Background service initialization error:', err);
  });
});

