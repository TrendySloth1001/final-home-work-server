# Copilot Instructions - homeWork-server

## Project Overview
Express.js/TypeScript REST API for AI-powered educational platform with syllabus management, question generation, and semantic search. Uses **PostgreSQL** (production) with Prisma ORM, Qdrant vector database for embeddings, Redis for caching/queues, and Ollama for local LLM inference.

## Architecture: Feature-Based Structure

**Directory Layout**:
```
src/
  features/          # Feature modules (domain-driven)
    syllabus/        # Syllabus management (CRUD + AI generation + versioning)
      syllabus.controller.ts  # HTTP handlers (20+ handlers)
      syllabus.service.ts     # Business logic (40+ services)
      syllabus.types.ts       # TypeScript interfaces
      routes/          # Organized route files
        index.ts       # Main router combining all sub-routers
        syllabus.routes.ts    # Core syllabus CRUD
        generation.routes.ts  # AI generation endpoints
        versions.routes.ts    # Version management
        units.routes.ts       # Unit management
        topics.routes.ts      # Topic management
    questions/       # Question bank (AI-generated + manual)
      questions.controller.ts
      questions.service.ts
      questions.routes.ts
      questions.types.ts
    ai/              # AI-powered features
      ai.controller.ts        # AI text generation, chat
      ai.service.ts
      ai.routes.ts
      context.service.ts      # Context builder for AI
    notifications/   # Real-time notifications
      notifications.controller.ts
      notifications.service.ts
      notifications.routes.ts
      
  shared/            # Shared utilities across features
    config/          # Centralized configuration (config.ts)
    lib/             # Core utilities
      prisma.ts      # Database singleton
      errors.ts      # Custom error classes
      ollama.ts      # Local LLM service
      embeddings.ts  # Text → vector conversion
      qdrant.ts      # Vector database client
      vectorSearch.ts # Semantic search
      webSearch.ts   # Tavily web search integration
      cache.ts       # Redis caching layer
      advancedOptimizations.ts # Enterprise algorithms
    middleware/      # Express middleware
      errorHandler.ts # Global error handling
    queues/          # Background jobs
      ai.queue.ts    # AI generation queue (BullMQ)
      types.ts       # Job type definitions
      
  server.ts          # App entry point (Express setup)
```

## Service-Controller-Routes Pattern

Follow the 3-layer pattern in each feature:

- **Routes** (`.routes.ts`): Define endpoints only, no logic
- **Controllers** (`.controller.ts`): Handle HTTP layer (req/res), validation, call services
- **Services** (`.service.ts`): Business logic, Prisma operations, error handling
- **Types** (`.types.ts`): TypeScript interfaces for the feature

**Example**: All handlers use `asyncHandler` wrapper for automatic error catching:
```typescript
export const createSyllabusHandler = asyncHandler(async (req: Request, res: Response) => {
  // Validation throws ValidationError
  if (!teacherId) throw new ValidationError('Missing required fields');
  // Service handles business logic
  const syllabus = await createSyllabusService({ teacherId, ... });
  // Controller shapes response
  res.status(201).json({ success: true, message: '...', data: syllabus });
});
```

## Error Handling System

**Custom error classes** (`src/shared/lib/errors.ts`):
- `AppError` - Base class with `statusCode` and `isOperational`
- `NotFoundError` - 404 errors (missing resources)
- `ValidationError` - 400 validation failures
- `DatabaseError` - 500 database errors
- `ConflictError` - 409 conflicts (duplicates, version conflicts)
- `BadRequestError` - 400 generic bad requests
- `UnauthorizedError` - 401 auth errors
- `AIServiceError` - AI/LLM generation failures
- `VectorSearchError` - Qdrant/embedding failures
- `CacheError` - Redis caching failures

**Global error handler** (`src/shared/middleware/errorHandler.ts`):
- Catches all errors (sync/async via asyncHandler wrapper)
- Returns consistent JSON: `{ status, message, ...(stack in dev) }`
- Logs errors appropriately with context
- Handles Prisma errors (P2025 → NotFoundError, P2002 → ConflictError)
- Handles Zod validation errors → ValidationError

**Usage pattern**:
```typescript
// Service layer
if (!syllabus) {
  throw new NotFoundError('Syllabus not found');
}

// Controller layer (use asyncHandler)
export const getSyllabus = asyncHandler(async (req, res) => {
  const result = await getSyllabusService(req.params.id);
  res.json(result);
});
```

## Configuration Management

**Centralized config** (`src/shared/config/index.ts`):
- Single source of truth for all configuration
- Type-safe access to environment variables
- Validation at startup
- Default values for optional settings

**Usage**:
```typescript
import { config } from './shared/config';

const port = config.port;
const isDev = config.isDevelopment;
const dbUrl = config.database.url;
```

**Environment variables**: Copy `.env.example` to `.env` for local development. Config includes:
- Server settings (PORT, NODE_ENV)
- Database URL (PostgreSQL)
- AI provider: Ollama (local LLM) with qwen2.5:14b model by default
- Redis connection - for caching/job queues
- Qdrant URL for vector database
- Tavily API key for web search

**Never access `process.env` directly** - always use the config object for type safety and centralized management.

## Database & Prisma

**Production Database**: PostgreSQL with pgvector extension for vector storage. Singleton pattern in `src/shared/lib/prisma.ts` with:
- Configuration from centralized config system
- Conditional logging (queries in dev, errors only in prod)
- Graceful shutdown hook
- Global singleton to prevent connection exhaustion

**Schema location**: `prisma/schema.prisma`  
**Key Models**:
- `Syllabus` - Course syllabi with **version tracking** (v1, v2, v3...)
- `Unit` - Syllabus units with teaching hours
- `Topic` - Unit topics with embeddings for semantic search
- `Question` - Question bank (MCQ, short-answer, essay, true-false)
- `AIGeneration` - AI operation audit log
- `JobQueue` - Background job tracking
- `WebSearchCache` - Web search result caching
- `TopicResource` - External resources linked to topics
- `Notification` - User notifications

**Migration workflow**:
1. Edit schema
2. Run `npx prisma db push` (fast) OR `npx prisma migrate dev --name change_name`
3. Run `npx prisma generate` to regenerate client
4. Restart dev server

**Version Tracking System** (CRITICAL):
- Syllabi support multiple AI-generated versions (v1, v2, v3...)
- `version` field auto-increments (Int, default: 1)
- `isLatest` boolean marks active version (default: true)
- `parentId` links version chain to original syllabus
- `generationJobId` links to background job
- **NO deletion** - all versions preserved for comparison
- See `VERSION_TRACKING.md` for full API details

**Version Tracking Behavior**:
```typescript
// First generation: Creates v1
// Second generation: Creates v2, marks v1 as isLatest: false
// Third generation: Creates v3, marks v1,v2 as isLatest: false
// All versions share same parentId (the original v1 id)
```

## AI Integration (Ollama + Embeddings + Vector Search)

**LLM Service** (`src/shared/lib/ollama.ts`):
- Local Ollama server for inference
- Models: 
  - `qwen2.5:14b` - Primary (syllabus generation, questions)
  - `mistral-nemo:12b-instruct-2407-q6_K` - Backup
  - `llama3.2:3b` - Fast fallback
- Structured output via `format: "json"`
- Token-based optimization (dynamic max_tokens via TokenCalculator)

**Ollama Setup**:
```bash
# Install Ollama
brew install ollama  # macOS

# Pull models
ollama pull qwen2.5:14b
ollama pull mistral-nemo:12b-instruct-2407-q6_K
ollama pull llama3.2:3b
ollama pull nomic-embed-text:v1.5

# Start server
ollama serve  # Runs on http://localhost:11434
```

**Ollama Service Usage**:
```typescript
import { ollamaService } from '../../shared/lib/ollama';

// Simple generation
const response = await ollamaService.generate('Explain photosynthesis');

// Chat completion
const chatResponse = await ollamaService.chat([
  { role: 'system', content: 'You are a helpful teacher.' },
  { role: 'user', content: 'What is algebra?' }
]);

// Streaming (for real-time responses)
for await (const chunk of ollamaService.generateStream('Write a poem')) {
  process.stdout.write(chunk);
}
```

**Embeddings** (`src/shared/lib/embeddings.ts`):
- `nomic-embed-text:v1.5` model (384 dimensions)
- Generates vector embeddings for topics
- Used for semantic search (find related content)
- Batch processing support

**Vector Database** (`src/shared/lib/qdrant.ts`):
- Qdrant for storing/searching embeddings
- Collection: "syllabus_topics" 
- Hybrid search: semantic + metadata filters
- Find similar topics across syllabi

**Semantic Search** (`src/shared/lib/vectorSearch.ts`):
- Query by natural language → find relevant topics
- Cosine similarity scoring
- Filter by: subject, class, board, teacher
- Use case: "find topics related to photosynthesis"

**Web Search** (`src/shared/lib/webSearch.ts`):
- Tavily API integration for real-time web search
- Fetches latest educational resources
- Cached results in database (WebSearchCache)
- Used during AI syllabus generation for up-to-date content

**Context Builder** (`src/features/ai/context.service.ts`):
- Assembles context for AI prompts
- Fetches related topics, web results, cached data
- Optimizes token usage
- Maintains conversation history

## API Endpoints & Routes

**IMPORTANT**: All routes have been refactored to use versioned API structure. See `API_REFACTORING_GUIDE.md` for complete migration details.

**Base URL**: `/api/v1`  
**Legacy Support**: Old `/api/*` routes automatically redirect to `/api/v1/*`  
**Response Format**:
```json
{
  "success": true,
  "message": "Description of result",
  "data": { /* payload */ },
  "count": 10  // For list responses
}
```

### Syllabus Routes (`/api/v1/syllabi`)

**CRUD Operations**:
- `POST /api/v1/syllabi` - Create manual syllabus
  - Handler: `createSyllabusHandler`
  - Service: `createSyllabusService`
- `GET /syllabus` - Get all syllabi with filters
  - Handler: `getAllSyllabusesHandler`
  - Service: `getAllSyllabusesService`
- `GET /syllabus/:id` - Get single syllabus
  - Handler: `getSyllabusHandler`
  - Service: `getSingleSyllabusService`
  - Note: Excludes embeddings from topic responses
- `PUT /syllabus/:id` - Update syllabus
  - Handler: `updateSyllabusHandler`
  - Service: `updateSyllabusService`
- `DELETE /syllabus/:id` - Delete syllabus (cascade)
  - Handler: `deleteSyllabusHandler`
  - Service: `deleteSyllabusService`
- `GET /syllabus/teacher/:teacherId` - Get by teacher
  - Handler: `getAllSyllabusByTeacherIdHandler`
  - Service: `getAllSyllabusByTeacherIdService`
  - Note: Excludes embeddings from topic responses

**AI Generation**:
- `POST /syllabus/:id/generate-ai` - Generate syllabus with AI (background job)
  - Handler: `generateAISyllabusHandler`
  - Creates new version, preserves old versions
  - Returns jobId for status checking
- `GET /syllabus/job/:jobId` - Check AI job status
  - Handler: `getJobStatusHandler`
  - Service: `getJobStatusService`
- `GET /syllabus/:id/completeness` - Get completeness score
  - Handler: `getCompletenessScoreHandler`
  - Service: `calculateCompletenessScoreService`

**Version Management** (NEW):
- `GET /syllabus/versions` - List all versions for syllabus
  - Handler: `getSyllabusVersionsHandler`
  - Service: `getSyllabusVersionsService`
  - Query params: `teacherId`, `subjectName`, `className`, `board`, `term`, `academicYear`
  - Returns: Array of versions with metadata (version number, isLatest, createdAt)
- `GET /syllabus/version/:syllabusId` - Get specific version
  - Handler: `getSyllabusVersionHandler`
  - Service: `getSyllabusVersionService`
  - Returns: Full syllabus with units, topics (no embeddings)
- `GET /syllabus/compare` - Compare two versions
  - Handler: `compareSyllabusVersionsHandler`
  - Service: `compareSyllabusVersionsService`
  - Query params: `version1Id`, `version2Id`
  - Returns: Side-by-side comparison with differences
- `PATCH /syllabus/:syllabusId/set-latest` - Mark version as latest
  - Handler: `setLatestVersionHandler`
  - Service: `setLatestVersionService`
  - Marks all other versions as not latest

**Units & Topics**:
- `POST /syllabus/:syllabusId/units` - Add unit
  - Handler: `addUnitHandler`
  - Service: `addUnitService`
- `PUT /units/:unitId` - Update unit
  - Handler: `updateUnitHandler`
  - Service: `updateUnitService`
- `DELETE /units/:unitId` - Delete unit (cascade)
  - Handler: `deleteUnitHandler`
  - Service: `deleteUnitService`
- `POST /units/:unitId/topics` - Add topic
  - Handler: `addTopicHandler`
  - Service: `addTopicService`
- `PUT /topics/:topicId` - Update topic
  - Handler: `updateTopicHandler`
  - Service: `updateTopicService`
- `DELETE /topics/:topicId` - Delete topic
  - Handler: `deleteTopicHandler`
  - Service: `deleteTopicService`

**Search & Analytics**:
- `GET /topics/semantic-search` - Semantic search for topics
  - Handler: `semanticSearchHandler`
  - Service: `semanticSearchService`
  - Query params: `query`, `subject`, `class`, `limit`

### Question Routes (`/api/questions`)

**CRUD**:
- `POST /questions` - Create question
- `GET /questions` - Get all questions (with filters)
- `GET /questions/:id` - Get single question
- `PUT /questions/:id` - Update question
- `DELETE /questions/:id` - Delete question

**AI Generation**:
- `POST /questions/generate-ai` - Generate questions (MCQ, short-answer, essay, true-false)
  - Handler: `generateQuestionsHandler`
  - Service: `generateQuestionsService`
  - Supports sync (count ≤ 3) or async via queue (count > 3)
- `GET /questions/job/:jobId` - Check generation job status

**Filtering**:
- Query params: `topicId`, `questionType`, `difficultyLevel`, `generatedBy`

### AI Routes (`/api/ai`)

- `POST /ai/chat` - Chat with AI (context-aware)
- `POST /ai/generate-text` - Generate custom text content
- `POST /ai/embeddings` - Generate embeddings for text

### Notification Routes (`/api/notifications`)

- `GET /notifications` - Get user notifications
- `PATCH /notifications/:id/read` - Mark as read
- `DELETE /notifications/:id` - Delete notification

## Development Workflow

**Start dev server**: `npm run dev` (uses ts-node-dev with auto-restart)  
**Build**: `npm run build` (outputs to `dist/`)  
**Run production**: `npm start`

**Environment**: Uses `dotenv` - expects `.env` file (gitignored). PORT defaults to 3000 if not set.

**Common commands**:
```bash
# Database
npm run db:push       # Push schema changes (fast)
npm run db:migrate    # Create migration
npm run db:generate   # Regenerate Prisma client
npm run db:studio     # Open Prisma Studio

# Development
npm run dev           # Start dev server
npm run build         # Build for production
npm start             # Run production build
npm run lint          # ESLint check
```

## TypeScript Configuration

Uses strict mode with NodeNext modules. Key settings:
- `verbatimModuleSyntax: false` (non-standard, required for Prisma compatibility)
- `noUncheckedIndexedAccess: true` - array access returns `T | undefined`
- `exactOptionalPropertyTypes: true` - distinguish `undefined` from omitted properties

**Critical: exactOptionalPropertyTypes Pattern**

With `exactOptionalPropertyTypes: true`, cannot assign `undefined` to optional Prisma fields. Must use conditional spread:

```typescript
// ❌ WRONG - causes TypeScript error
await prisma.syllabus.create({
  data: {
    teacherId: value,
    parentId: maybeUndefined,  // Error if undefined!
  }
});

// ✅ CORRECT - use conditional spread
await prisma.syllabus.create({
  data: {
    teacherId: value,
    ...(maybeUndefined ? { parentId: maybeUndefined } : {}),
  }
});

// ✅ CORRECT - for multiple optional fields
const { optionalField1, optionalField2, ...requiredData } = allData;
await prisma.syllabus.update({
  data: {
    ...requiredData,
    ...(optionalField1 ? { optionalField1 } : {}),
    ...(optionalField2 ? { optionalField2 } : {}),
  }
});
```

**When to use**: All Prisma create/update operations with optional foreign keys or nullable fields like `parentId`, `generationJobId`.

## Token Optimization Patterns

**Problem**: LLM token allocation must balance quality vs cost. Too many tokens waste resources, too few truncate responses.

**Solution**: Field-based calculation in `TokenCalculator` (`src/shared/lib/advancedOptimizations.ts`):

```typescript
// Fixed fields (constant size)
TOKENS_OBJECTIVES = 250;      // 7 learning objectives × 35 tokens
TOKENS_OVERVIEW = 400;        // 200-250 word overview
TOKENS_PREREQUISITES = 180;   // 5 prerequisites × 35 tokens
TOKENS_ASSESSMENT = 240;      // 6 assessment methods × 40 tokens
TOKENS_RESOURCES = 300;       // 8 resources × 35-40 tokens

// Variable fields (scale with content)
TOKENS_PER_UNIT = 120;        // title + detailed description
TOKENS_PER_TOPIC = 150;       // name + description + keywords

// Safety margin
SAFETY_MARGIN = 1.15;         // 15% buffer for JSON structure

// Calculation
recommendedTokens = 
  (fixedFields + units * 120 + topics * 150) * 1.15
```

**Example**: 
- STEM syllabus: 6 units, 30 topics = ~6,750 tokens
- Humanities: 5 units, 20 topics = ~5,400 tokens
- Elementary: 4 units, 15 topics = ~4,500 tokens

**Results**: 25% token savings vs original, maintains 100% quality, prevents truncation.

## Embedding Exclusion Pattern

**Problem**: 384-dimension vector embeddings bloat API responses (unnecessary data transfer).

**Solution**: Explicit select statements in service layer to exclude embeddings:

```typescript
// ❌ WRONG - includes embedding (384 floats = ~1.5KB per topic)
const syllabus = await prisma.syllabus.findUnique({
  where: { id },
  include: {
    units: {
      include: {
        topics: true  // Gets ALL fields including embedding
      }
    }
  }
});

// ✅ CORRECT - excludes embedding
const syllabus = await prisma.syllabus.findUnique({
  where: { id },
  include: {
    units: {
      include: {
        topics: {
          select: {
            id: true,
            unitId: true,
            teacherId: true,
            topicName: true,
            description: true,
            keywords: true,
            order: true,
            generatedBy: true,
            createdAt: true,
            updatedAt: true
            // embedding: false - omitted
          }
        }
      }
    }
  }
});
```

**Services with embedding exclusion**:
- `getAllSyllabusByTeacherIdService` (lines ~108-127)
- `getSingleSyllabusService` (lines ~146-178)
- `getSyllabusVersionService` (version endpoint)

**When to exclude**: All GET routes returning syllabi to clients. Keep embeddings only for vector search operations.

## Background Jobs & Caching

**Job Queue System**: Uses BullMQ with Redis for async processing
```typescript
import { addAIJob, getJobStatus } from '../../shared/queues/ai.queue';

// Queue background job
const jobId = await addAIJob({
  type: 'syllabus-generation',
  teacherId,
  syllabusId,
  data: { /* syllabus params */ }
}, 5); // priority

// Check status later
const status = await getJobStatus(jobId);
```

**Job Types**:
- `syllabus-generation` - AI syllabus generation (creates new version)
- `questions-batch` - AI question generation (10+ questions)
- `embeddings-batch` - Vector embedding generation

**Caching Layer**: Redis-based caching with utility functions
```typescript
import { cacheService, CacheKeys } from '../../shared/lib/cache';

// Get or fetch with cache
const data = await cacheService.getOrSet(
  CacheKeys.syllabus(id),
  () => fetchFromDatabase(id),
  3600 // TTL in seconds
);

// Invalidate cache patterns
await cacheService.deletePattern('questions:topic:*');
```

**When to use**:
- **Queue**: AI generation (>3 questions), bulk operations, slow tasks (>5s)
- **Cache**: AI responses (expensive), frequently accessed data, rate limiting

## Database Optimizations

**Indexes**: Schema includes performance indexes on:
- `teacherId`, `topicId`, `syllabusId` (foreign keys)
- `difficulty`, `questionType`, `generatedBy` (filter fields)
- `version`, `isLatest` (version tracking)
- Composite indexes for common queries

**AI Generation Tracking**: All AI operations logged to `AIGeneration` table with:
- Input/output, prompt, model, provider
- Duration, status, cost tracking
- Linked to syllabus/unit/topic/teacher
- Used for analytics and debugging

**Query Optimization Patterns**:
- Use `select` for existence checks (faster than `findUnique`)
- Use `include` only when returning data to client
- Batch operations with `createMany`, `updateMany`
- Use transactions for multi-step operations

## Question Bank System

**Question Model**: Supports 4 types with AI or manual generation:
- MCQ (multiple choice) - 4 options, 1+ correct
- Short Answer - text response, keyword matching
- Essay - long-form response, rubric-based grading
- True/False - boolean response

**Fields**:
- `difficulty` - easy/medium/hard
- `points` - scoring weight
- `options` - for MCQ (array of strings)
- `correctAnswer` - expected answer
- `explanation` - learning feedback
- `generatedBy` - 'ai' or 'manual'

**Generate questions**:
```typescript
// Sync (small batches ≤ 3)
const result = await generateQuestionsService({
  topicId, teacherId, count: 3
});

// Async (large batches > 3)
const { jobId } = await generateQuestionsService({
  topicId, teacherId, count: 20, useQueue: true
});
```

## Adding New Features

**Follow feature-based structure**:
1. Create feature directory: `src/features/feature-name/`
2. Define Prisma models in `schema.prisma` with relations
3. Run migration: `npx prisma migrate dev --name feature_name`
4. Create types in `feature-name.types.ts`
5. Implement service layer with business logic (40+ services pattern)
6. Create controllers with `asyncHandler` wrapper and validation
7. Define routes with RESTful verbs (POST/GET/PATCH/DELETE)
8. Register routes in `src/server.ts` under `/api`

**Example feature structure**:
```
src/features/homework/
  homework.types.ts      # TypeScript interfaces
  homework.service.ts    # Business logic
  homework.controller.ts # HTTP handlers
  homework.routes.ts     # Route definitions
```

## Critical Patterns

**Duplicate prevention**: Check unique constraints manually before creating/updating. Example in `ai.queue.ts`:
```typescript
const existingSyllabi = await prisma.syllabus.findMany({
  where: { teacherId, subjectName, className, board, term, academicYear },
  orderBy: { version: 'desc' },
  take: 1
});
```

**Version tracking on mutations**: When generating new AI syllabus:
1. Find existing syllabi with same params
2. Increment version number
3. Mark all previous as `isLatest: false`
4. Create new with `version`, `isLatest: true`, `parentId`

**Partial updates**: Use `UpdateInput` types with all optional fields. Validate at least one field provided. Use conditional spread pattern (see TypeScript Configuration section).

**Cascading deletes**: Schema uses `onDelete: Cascade` for related data cleanup. Deleting syllabus deletes units, topics, questions automatically.

**Cache invalidation**: Always invalidate related cache keys after mutations:
```typescript
await cacheService.delete(CacheKeys.syllabus(syllabusId));
await cacheService.deletePattern(`syllabus:teacher:${teacherId}:*`);
```

**Type-safe optional fields**: Always use conditional spread `...(value ? { key: value } : {})` for optional Prisma fields with `exactOptionalPropertyTypes: true`. Never assign potentially undefined values directly to optional properties like `parentId`, `generationJobId`.

**Null safety**: With `noUncheckedIndexedAccess: true`, always check array bounds:
```typescript
// ❌ WRONG
const first = array[0];  // Type: T | undefined

// ✅ CORRECT
if (array.length > 0 && array[0]) {
  const first = array[0];  // Type: T
}
```

## Service Function Reference

**Syllabus Core Services** (`syllabus.service.ts`):
- `createSyllabusService` - Create manual syllabus
- `getAllSyllabusesService` - Get all with filters
- `getSingleSyllabusService` - Get by ID (excludes embeddings)
- `getAllSyllabusByTeacherIdService` - Get by teacher (excludes embeddings)
- `updateSyllabusService` - Update syllabus
- `deleteSyllabusService` - Delete with cascade
- `checkDuplicateSyllabusService` - Check for duplicates

**Version Management Services** (NEW):
- `getSyllabusVersionsService` - List all versions for syllabus
- `getSyllabusVersionService` - Get specific version details
- `compareSyllabusVersionsService` - Compare two versions
- `setLatestVersionService` - Mark version as active

**Unit Services**:
- `addUnitService` - Add unit to syllabus
- `updateUnitService` - Update unit
- `deleteUnitService` - Delete unit with cascade

**Topic Services**:
- `addTopicService` - Add topic to unit
- `updateTopicService` - Update topic
- `deleteTopicService` - Delete topic
- `semanticSearchService` - Search topics by meaning

**AI Services**:
- `generateAISyllabusService` - Queue AI generation job
- `calculateCompletenessScoreService` - Score syllabus quality
- `getJobStatusService` - Check background job status

**Question Services**:
- `generateQuestionsService` - Generate questions (sync/async)
- `createQuestionService` - Create manual question
- `getQuestionsService` - Get with filters
- `updateQuestionService` - Update question
- `deleteQuestionService` - Delete question

## Documentation Files

- `README.md` - Project overview and setup
- `VERSION_TRACKING.md` - Version system documentation with API examples
- `.github/copilot-instructions.md` - This file (AI assistant instructions)
- `IMPROVEMENTS.md` - Feature roadmap and completed improvements
- `VECTOR_DB_PLAN.md` - Vector database architecture
- `readmes/QUICK_REFERENCE.md` - Quick API reference
- `readmes/DOCKER_SETUP.md` - Docker configuration
- `readmes/PHASE2_COMPLETE.md` - Phase 2 completion notes
