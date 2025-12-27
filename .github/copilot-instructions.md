# homeWork Server - AI Agent Instructions

## Project Overview
Educational platform server that generates curriculum content (syllabi, units, topics, questions) using **local Ollama LLMs** with **RAG** (Retrieval Augmented Generation). Built on **TypeScript/Express** with **PostgreSQL (pgvector)**, **Qdrant** vector DB, **Redis** caching, and **BullMQ** job queues.

## Core Architecture

### Three-Tier Infrastructure Stack (Docker Compose)
```yaml
postgres:    PostgreSQL 16 + pgvector extension
redis:       Job queue persistence & response caching  
qdrant:      Vector database (384-dim embeddings)
```
**Start command:** `./start.sh` (handles Docker, DB migrations, seeds sample data)
**Stop command:** `./stop.sh`

### AI Pipeline Components
1. **Ollama Integration** (`src/shared/lib/ollama.ts`)
   - Default model: `qwen2.5:7b` (configurable via `OLLAMA_MODEL` env var)
   - Timeout: 300s for large generation tasks (syllabus generation)
   - Uses optimized defaults: `temperature=0.7`, `top_p=0.9`, `repeat_penalty=1.1`

2. **RAG Service** (`src/shared/lib/rag.ts`)
   - LlamaIndex-based retrieval with Qdrant vector search
   - Collection name: `syllabus_topics`
   - Workflow: Query → Embedding → Vector search → Context augmentation → LLM generation
   - **Cache-first strategy:** Check Redis before calling LLM

3. **Embeddings** (`src/shared/lib/embeddings.ts`)
   - Model: `nomic-embed-text` (384 dimensions) via Transformers.js
   - Stores embeddings as JSON strings in Prisma (PostgreSQL Text field)

4. **Job Queue** (`src/shared/queues/ai.queue.ts`)
   - **BullMQ** handles async AI generation (syllabi, questions, content enhancement)
   - Job types: `syllabus-generation`, `questions-batch`, `content-enhancement`
   - Tracks jobs in `JobQueue` model with progress/status
   - Circuit breaker pattern for LLM failures

### Database Schema Key Patterns

#### Hierarchical Content Model
```
Syllabus (subject/class/board/term)
  ├─ Units (teaching modules)
  │   ├─ Topics (individual concepts)
  │   │   ├─ Questions (with embeddings for similarity)
  │   │   └─ TopicResource (web search results)
```

#### AI Generation Tracking
- **Version Control:** `Syllabus.version` + `isLatest` flag enable multiple AI-generated variations
- **Job Linkage:** `generationJobId` → `JobQueue.jobId` → `AIGeneration.id`
- **Tool Execution:** Conversational AI tracked via `ToolExecution` → `Conversation` → `ConversationMessage`

#### Vector Embeddings Storage
- All embeddings stored as **JSON-stringified arrays** in PostgreSQL Text fields
- Example: `embedding: "[0.123, -0.456, ...]"` (384 floats for nomic-embed-text)
- Qdrant used for actual vector search; Prisma just stores for reference

### Web Search Integration
- **Tavily API** (`src/shared/lib/webSearch.ts`)
- Caches results in `WebSearchCache` model (7-day TTL by default)
- Query hash: MD5 of `query-maxResults-searchDepth`
- Auto-stores results as `TopicResource` linked to topics

## Developer Workflows

### Local Development Startup
```bash
./start.sh  # Starts Docker services + runs Prisma migrations + seeds data
npm run dev # TypeScript hot-reload server (ts-node-dev)
```

### Database Migrations
```bash
npx prisma migrate dev --name description_of_change
npx prisma generate  # Updates Prisma Client types
```

### Adding New AI Job Types
1. Define job data interface in `src/shared/queues/types.ts`
2. Add job handler in `aiWorker` switch statement (`src/shared/queues/ai.queue.ts`)
3. Create job with `aiQueue.add(JobTypes.AI_GENERATION, jobData)`
4. Track progress via `JobQueue` model and BullMQ status

### Testing AI Generation
- **Ollama must be running:** `ollama serve` (default port 11434)
- Pull required models: `ollama pull qwen2.5:7b && ollama pull nomic-embed-text`
- Check model: `curl http://localhost:11434/api/tags`

## Project-Specific Conventions

### Configuration Management
All config in `src/shared/config/index.ts` - **never hardcode values**
- AI provider toggle: `AI_PROVIDER=ollama` (or `openai`)
- Model selection: `OLLAMA_MODEL=qwen2.5:7b` (qwen2.5:14b for better quality)
- Service URLs: `QDRANT_URL`, `REDIS_URL`, `DATABASE_URL`

### Error Handling Pattern
- Centralized middleware: `src/shared/middleware/errorHandler.ts`
- Custom errors: `src/shared/lib/errors.ts` (e.g., `OllamaTimeoutError`)
- Circuit breaker for LLM failures (auto-retry with exponential backoff)

### Caching Strategy
1. **Redis first** (check cache before expensive operations)
2. **Cache keys** defined in `src/shared/lib/cache.ts` → `CacheKeys` enum
3. **TTLs:** RAG queries=1hr, web search=7days, embeddings=24hrs

### Async Job Patterns
- **Always persist to JobQueue:** Update status/progress via `persistJobToDatabase()`
- **Job naming:** Use `JobTypes` enum from `types.ts`
- **Progress tracking:** Update `job.progress(percentage)` for UI feedback

### Embedding Generation
- **Batch operations:** Generate embeddings for Topics/Questions after creation
- **Qdrant sync:** Store in Qdrant immediately after generating embedding
- **Metadata:** Include `teacherId`, `type`, `id` for filtering during RAG retrieval

## Critical Integration Points

### Ollama ↔ RAG Pipeline
```typescript
// Always use through RAG service for context-aware responses
await ragService.query({
  query: "user question",
  filters: { subject, class, board, topicIds },
  conversationHistory: [...messages]
});
```

### Qdrant Vector Search Filters
```typescript
// Example filter for teacher-specific search
qdrantFilter = {
  must: [
    { key: 'teacherId', match: { value: teacherId } },
    { key: 'type', match: { value: 'topic' } }
  ]
}
```

### Prisma + Qdrant Sync Pattern
1. Create entity in Prisma (get ID)
2. Generate embedding via `embeddingService`
3. Store in Qdrant with metadata: `{ id, type, teacherId, ...context }`
4. Update Prisma record with embedding JSON string (for reference)

## Key Files Reference

- **Entry Point:** [src/server.ts](src/server.ts) - Minimal Express app (needs route implementation)
- **Job Processor:** [src/shared/queues/ai.queue.ts](src/shared/queues/ai.queue.ts) - BullMQ worker with all AI job handlers
- **RAG Logic:** [src/shared/lib/rag.ts](src/shared/lib/rag.ts) - Context retrieval + LLM generation
- **DB Schema:** [prisma/schema.prisma](prisma/schema.prisma) - Complete data model (20+ models)
- **Docker Services:** [docker-compose.yml](docker-compose.yml) - PostgreSQL/Redis/Qdrant config
- **Startup Script:** [start.sh](start.sh) - Full environment initialization

## Common Pitfalls

1. **Embedding dimension mismatch:** Always use 384 dims (nomic-embed-text) - Qdrant collection config must match
2. **Ollama timeout:** Default 300s may be too short for syllabus generation on slow machines - increase via `OLLAMA_TIMEOUT`
3. **Redis connection:** Jobs will fail silently if Redis isn't running - check `docker ps`
4. **Prisma schema changes:** Always run `prisma generate` after migrations to update TypeScript types
5. **Qdrant collection creation:** RAG service auto-creates `syllabus_topics` on first use - don't create manually
6. **Caching stale data:** Clear Redis cache when schema changes: `docker exec homework_redis redis-cli FLUSHALL`
