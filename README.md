# HomeWork Server - AI-Powered Educational Platform API

An intelligent backend system for educational content management, leveraging AI to generate comprehensive syllabi, questions, and learning materials.

## Overview

HomeWork Server is a production-ready REST API built with Express.js and TypeScript that helps educators create, manage, and enhance educational content using AI. It combines local LLM inference (Ollama), semantic search (Qdrant), and web research (Tavily) to generate curriculum-aligned syllabi and questions.

## Key Features

### AI-Powered Syllabus Generation
- **Automatic Curriculum Creation**: Generate complete syllabi with units, topics, objectives, and resources
- **Multi-Board Support**: CBSE, ICSE, State boards, and IB curriculum alignment
- **Web-Enhanced Context**: Real-time curriculum research via Tavily API
- **Smart Caching**: Three-layer caching (Vector DB → WebSearch → Fresh API) saves costs
- **Version Control**: Track multiple AI-generated versions with comparison tools

### Intelligent Question Bank
- **AI Question Generation**: Create MCQs, short-answer, essay, and true/false questions
- **Duplicate Detection**: Semantic similarity checks prevent repetitive questions
- **Adaptive Generation**: Smart retry logic with increasing diversity parameters
- **Difficulty Levels**: Easy, medium, hard questions for any topic
- **Batch Processing**: Generate 5-100 questions asynchronously via job queue

### Semantic Search
- **Vector Embeddings**: 384-dimension embeddings using nomic-embed-text model
- **Similar Content Discovery**: Find related topics across different syllabi
- **Context-Aware Generation**: AI uses past content to avoid duplication
- **Curriculum Search**: Semantic matching of similar syllabi (85%+ similarity)

### Features
- **Background Job Processing**: BullMQ + Redis for long-running AI tasks
- **Real-time Notifications**: WebSocket support for job status updates
- **Completeness Scoring**: Automatic quality assessment of generated content
- **Resource Management**: Link external learning materials to topics
- **Stage Management**: Draft → Published → Archived workflow

## Tech Stack

### Core
- **Runtime**: Node.js + TypeScript
- **Framework**: Express.js 5.x
- **Database**: PostgreSQL with pgvector extension
- **ORM**: Prisma

### AI & Search
- **LLM**: Ollama (local inference with qwen2.5, mistral, llama models)
- **Embeddings**: nomic-embed-text:v1.5 (384D vectors)
- **Vector DB**: Qdrant for semantic search
- **Web Search**: Tavily API for curriculum research

### Background Processing
- **Job Queue**: BullMQ
- **Cache/Queue**: Redis
- **Concurrency**: 2 workers with rate limiting (10 jobs/minute)

## API Endpoints

### Syllabus Management (`/api/syllabi`)
- `POST /` - Create manual syllabus
- `GET /` - List all syllabi with filters
- `GET /:id` - Get single syllabus with units and topics
- `PATCH /:id` - Update syllabus
- `DELETE /:id` - Delete syllabus
- `GET /teacher/:teacherId` - Get teacher's syllabi
- `GET /similar` - Find similar syllabi (semantic search)

### AI Generation (`/api/syllabi/:id/generate`)
- `POST /` - Queue AI syllabus generation (background job)
- `GET /job/:jobId` - Check generation status
- `GET /:id/completeness` - Get quality score

### Version Management (`/api/syllabi/versions`)
- `GET /` - List all versions of a syllabus
- `GET /:versionId` - Get specific version details
- `GET /compare` - Compare two versions side-by-side
- `PATCH /:versionId/set-latest` - Mark version as active

### Units & Topics (`/api/units`, `/api/topics`)
- `POST /syllabi/:id/units` - Add unit to syllabus
- `GET /units/:id` - Get unit details
- `PATCH /units/:id` - Update unit
- `DELETE /units/:id` - Delete unit
- `POST /units/:id/topics` - Add topic to unit
- `POST /units/:id/topics/bulk` - Add multiple topics
- `GET /topics/:id` - Get topic details
- `PATCH /topics/:id` - Update topic
- `DELETE /topics/:id` - Delete topic
- `GET /topics/:id/resources` - Get external resources
- `GET /topics/:id/similar` - Find similar topics

### Question Bank (`/api/questions`)
- `POST /` - Create manual question
- `GET /` - List questions with filters
- `POST /generate-ai` - Generate AI questions (sync/async)
- `GET /job/:jobId` - Check generation job status

### AI Features (`/api/ai`)
- `GET /health` - Check AI service status
- `POST /chat` - Context-aware AI chat
- `POST /generate-text` - Custom text generation
- `POST /embeddings` - Generate embeddings

## Frontend Possibilities

### 1. **Teacher Dashboard (React/Next.js)**
```
Features:
- Syllabus library with search and filters
- AI generation wizard with progress tracking
- Version comparison tool with diff viewer
- Question bank management
- Real-time generation status updates
- Analytics: completeness scores, usage stats
```

### 2. **Student Learning Portal (Vue/Nuxt)**
```
Features:
- Browse published syllabi by class/subject
- Topic-wise study materials
- Practice questions by difficulty
- Progress tracking per unit/topic
- Resource library (videos, articles)
- Semantic search for topics
```

### 3. **Admin Panel (React + Ant Design)**
```
Features:
- User management (teachers, students)
- Content moderation (review AI-generated content)
- System monitoring (job queue, AI health)
- Cache statistics and optimization
- Bulk operations (import/export syllabi)
```

### 4. **Mobile App (React Native)**
```
Features:
- Quick syllabus access
- Offline question practice
- Push notifications for job completion
- Simple CRUD for teachers on-the-go
- QR code sharing for syllabi
```

## Typical Workflows

### For Teachers
1. **Create Syllabus**: Enter basic details (class, subject, board)
2. **AI Generation**: Click "Generate with AI" → Background job starts
3. **Monitor Progress**: Real-time updates via WebSocket
4. **Review & Edit**: Check completeness score, modify units/topics
5. **Publish**: Mark as published for student access
6. **Regenerate**: Create new versions with different parameters

### For Students
1. **Browse Syllabi**: Filter by class/subject/board
2. **View Content**: Units, topics, objectives, resources
3. **Practice Questions**: Filter by topic, difficulty, type
4. **Track Progress**: Mark completed topics

## Environment Setup

```env
# Server
PORT=3001
NODE_ENV=development

# Database (PostgreSQL with pgvector)
DATABASE_URL=postgresql://user:pass@localhost:5432/homeworkdb

# AI - Ollama (Local LLM)
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b-instruct-q4_K_M
OLLAMA_TIMEOUT=300000

# Redis (Job Queue & Cache)
REDIS_URL=redis://:pass@localhost:6379

# Vector Database
QDRANT_URL=http://localhost:6333

# Web Search
TAVILY_API_KEY=your_tavily_key
```

## Installation

```bash
# Install dependencies
npm install

# Setup database
npx prisma migrate dev

# Start Ollama
ollama serve
ollama pull qwen2.5:7b-instruct-q4_K_M
ollama pull nomic-embed-text:v1.5

# Start Redis & Qdrant (Docker)
docker run -d -p 6379:6379 redis:7-alpine
docker run -d -p 6333:6333 qdrant/qdrant

# Run development server
npm run dev
```

## Response Format

All endpoints return consistent JSON:
```json
{
  "success": true,
  "message": "Description of result",
  "data": { /* payload */ },
  "count": 10  // For list responses
}
```

## Error Handling

Custom error classes with proper HTTP status codes:
- `ValidationError` (400) - Invalid input
- `NotFoundError` (404) - Resource not found
- `ConflictError` (409) - Duplicate or version conflict
- `AIServiceError` (500) - AI generation failure
- `VectorSearchError` (500) - Embedding/search failure

## Performance Features

- **Token Optimization**: Dynamic token allocation based on subject complexity
- **Embedding Exclusion**: API responses exclude 384D vectors (saves bandwidth)
- **Adaptive Thresholds**: Smart duplicate detection with progressive relaxation
- **Batch Operations**: Efficient multi-topic/question creation
- **Database Indexing**: Optimized queries on common filters

## Frontend Integration Tips

1. **Polling for Job Status**: Poll `/api/syllabi/generate/:jobId` every 3-5 seconds
2. **WebSocket for Real-time**: Connect to get instant job completion notifications
3. **Pagination**: Use `?page=1&limit=20` for large lists
4. **Caching**: Cache published syllabi on frontend (they rarely change)
5. **Optimistic Updates**: Update UI immediately, sync with backend
6. **Error Boundaries**: Handle AI failures gracefully with retry options

## Security Considerations

- Add authentication middleware (JWT, OAuth)
- Implement rate limiting per user (currently global)
- Add input sanitization for user-generated content
- Restrict AI generation to authenticated teachers
- Add CORS configuration for frontend domains

## Roadmap

- [ ] Authentication & Authorization (JWT)
- [ ] File upload support (PDFs, images)
- [ ] OCR for syllabus extraction
- [ ] Collaborative editing (real-time)
- [ ] Analytics dashboard
- [ ] Export to PDF/DOCX
- [ ] Multi-language support
- [ ] Parent/Student access controls

## License

ISC

## Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

---

**Built with ❤️ for educators and students**

this is what my project is and i am not intrested in creating auth server and gateway for now since whole service run on teacher id i'll put a input field for theacher as of now for testing after that i'll build a gateway
