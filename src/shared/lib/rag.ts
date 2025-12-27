/**
 * RAG Service using LlamaIndex
 * Provides Retrieval Augmented Generation capabilities with vector search
 * Can be used across the application for context-aware AI responses
 */

import { ollamaService } from './ollama';
import { embeddingService } from './embeddings';
import { qdrantService } from './qdrant';
import { cacheService, CacheKeys } from './cache';
import { prisma } from './prisma';

/**
 * RAG Query Response
 */
export interface RAGResponse {
  answer: string;
  sourceNodes: Array<{
    text: string;
    score: number;
    metadata: Record<string, any>;
  }>;
  tokensUsed?: number;
}

/**
 * RAG Query Options
 */
export interface RAGQueryOptions {
  query: string;
  topK?: number; // Number of documents to retrieve (default: 5)
  conversationHistory?: Array<{ role: string; content: string }>;
  filters?: {
    subject?: string;
    class?: string;
    board?: string;
    topicIds?: string[];
    teacherId?: string;
  };
  temperature?: number;
  maxTokens?: number;
}

/**
 * Document for indexing
 */
export interface IndexableDocument {
  id: string;
  text: string;
  metadata: {
    type: 'syllabus' | 'unit' | 'topic' | 'question';
    id: string;
    [key: string]: any;
  };
}

/**
 * RAG Service Class
 */
class RAGService {
  private isInitialized = false;
  private readonly collectionName = 'syllabus_topics';

  constructor() {
    // Empty constructor - initialization happens in initialize()
  }

  /**
   * Initialize the RAG service with Qdrant vector store
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) return;

    try {
      // Ensure Qdrant collection exists
      await this.ensureCollection();

      this.isInitialized = true;
      console.log('✅ RAG Service initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize RAG Service:', error);
      throw error;
    }
  }

  /**
   * Ensure Qdrant collection exists
   */
  private async ensureCollection(): Promise<void> {
    try {
      // Check if collection exists using qdrantClient directly
      const client = qdrantService.getClient();
      try {
        await client.getCollection(this.collectionName);
        console.log(`✅ Qdrant collection exists: ${this.collectionName}`);
      } catch (error: any) {
        // Collection doesn't exist, create it
        if (error.status === 404 || error.message?.includes('not found')) {
          await client.createCollection(this.collectionName, {
            vectors: { size: 384, distance: 'Cosine' } // nomic-embed-text dimensions
          });
          console.log(`✅ Created Qdrant collection: ${this.collectionName}`);
        } else {
          throw error;
        }
      }
    } catch (error) {
      console.error('Error ensuring collection:', error);
      throw error;
    }
  }

  /**
   * Query with RAG - Main method for context-aware generation
   * @param options Query options with filters and conversation history
   * @returns RAG response with answer and source documents
   */
  async query(options: RAGQueryOptions): Promise<RAGResponse> {
    await this.initialize();

    const {
      query,
      topK = 5,
      conversationHistory = [],
      filters,
      temperature = 0.7,
      maxTokens = 500,
    } = options;

    // Check cache first
    const cacheKey = `rag:query:${query}:${JSON.stringify(filters || {})}`;
    const cached = await cacheService.get<RAGResponse>(cacheKey);
    if (cached) {
      console.log('✅ RAG query served from cache');
      return cached;
    }

    try {
      // Step 1: Retrieve relevant documents
      const retrievedDocs = await this.retrieve(query, topK, filters);

      // Step 2: Build context from retrieved documents
      const retrievedContext = this.buildRetrievedContext(retrievedDocs);

      // Step 3: Build enhanced prompt with conversation history + retrieved context
      const enhancedPrompt = this.buildEnhancedPrompt({
        userQuery: query,
        conversationHistory,
        retrievedContext,
      });

      // Step 4: Generate response with Ollama
      const answer = await ollamaService.generate(enhancedPrompt, {
        temperature,
        num_predict: maxTokens,
      });

      const response: RAGResponse = {
        answer,
        sourceNodes: retrievedDocs.map((doc) => ({
          text: doc.text,
          score: doc.score || 0,
          metadata: doc.metadata,
        })),
      };

      // Cache the response for 1 hour
      await cacheService.set(cacheKey, response, 3600);

      return response;
    } catch (error) {
      console.error('RAG query error:', error);
      throw error;
    }
  }

  /**
   * Retrieve relevant documents without generating answer
   * @param query Search query
   * @param topK Number of documents to retrieve
   * @param filters Optional filters for the search
   * @returns Array of retrieved documents
   */
  async retrieve(
    query: string,
    topK: number = 5,
    filters?: RAGQueryOptions['filters']
  ): Promise<Array<{ text: string; score?: number; metadata: Record<string, any> }>> {
    await this.initialize();

    try {
      // Generate embedding for the query
      const queryEmbedding = await embeddingService.generateEmbedding(query);

      // Build Qdrant filter
      const qdrantFilter = this.buildQdrantFilter(filters);

      // Search in Qdrant using vectorSearch
      const client = qdrantService.getClient();
      const searchResults = await client.search(this.collectionName, {
        vector: queryEmbedding,
        limit: topK,
        filter: qdrantFilter,
      });

      return searchResults.map((result: any) => ({
        text: result.payload?.text || result.payload?.topicName || result.payload?.description || '',
        score: result.score,
        metadata: result.payload || {},
      }));
    } catch (error: any) {
      // If collection doesn't exist or is empty, return empty array
      if (error.status === 404 || error.message?.includes('not found')) {
        console.log('⚠️  RAG collection not found or empty - returning no results');
        return [];
      }
      console.error('RAG retrieval error:', error);
      return [];
    }
  }

  /**
   * Index documents into the vector store
   * @param documents Array of documents to index
   */
  async indexDocuments(documents: IndexableDocument[]): Promise<void> {
    await this.initialize();

    if (documents.length === 0) return;

    try {
      const client = qdrantService.getClient();
      const points = [];

      // Generate embeddings and create points for each document
      for (const doc of documents) {
        const embedding = await embeddingService.generateEmbedding(doc.text);
        
        points.push({
          id: doc.id,
          vector: embedding,
          payload: {
            text: doc.text,
            ...doc.metadata,
          },
        });
      }

      // Upsert points to Qdrant
      await client.upsert(this.collectionName, {
        wait: true,
        points,
      });

      console.log(`✅ Indexed ${documents.length} documents`);
    } catch (error) {
      console.error('Error indexing documents:', error);
      throw error;
    }
  }

  /**
   * Index a single syllabus with all its units and topics
   */
  async indexSyllabus(syllabusId: string): Promise<void> {
    const syllabus = await prisma.syllabus.findUnique({
      where: { id: syllabusId },
      include: {
        units: {
          include: {
            topics: true,
          },
        },
      },
    });

    if (!syllabus) {
      throw new Error(`Syllabus not found: ${syllabusId}`);
    }

    const documents: IndexableDocument[] = [];

    // Main syllabus document
    documents.push({
      id: `syllabus_${syllabus.id}`,
      text: `
        Subject: ${syllabus.subjectName}
        Class: ${syllabus.className}
        Board: ${syllabus.board}
        Term: ${syllabus.term}
        Academic Year: ${syllabus.academicYear}
        Overview: ${syllabus.overview || 'N/A'}
        Objectives: ${syllabus.objectives || 'N/A'}
        Prerequisites: ${syllabus.prerequisites || 'N/A'}
      `.trim(),
      metadata: {
        type: 'syllabus',
        id: syllabus.id,
        subject: syllabus.subjectName,
        class: syllabus.className,
        board: syllabus.board,
        teacherId: syllabus.teacherId,
      },
    });

    // Unit documents
    for (const unit of syllabus.units) {
      documents.push({
        id: `unit_${unit.id}`,
        text: `Unit: ${unit.title}\nDescription: ${unit.description || 'N/A'}\nTeaching Hours: ${unit.teachingHours || 'N/A'}`,
        metadata: {
          type: 'unit',
          id: unit.id,
          syllabusId: syllabus.id,
          subject: syllabus.subjectName,
          class: syllabus.className,
          board: syllabus.board,
          teacherId: unit.teacherId,
        },
      });

      // Topic documents
      for (const topic of unit.topics) {
        documents.push({
          id: `topic_${topic.id}`,
          text: `Topic: ${topic.topicName}\nDescription: ${topic.description || 'N/A'}\nKeywords: ${topic.keywords || 'N/A'}`,
          metadata: {
            type: 'topic',
            id: topic.id,
            unitId: unit.id,
            syllabusId: syllabus.id,
            subject: syllabus.subjectName,
            class: syllabus.className,
            board: syllabus.board,
            teacherId: topic.teacherId,
          },
        });
      }
    }

    await this.indexDocuments(documents);
    console.log(`✅ Indexed syllabus ${syllabusId} with ${documents.length} documents`);
  }

  /**
   * Index questions for a topic
   */
  async indexQuestions(topicId?: string): Promise<void> {
    const where = topicId ? { topicId } : {};

    const questions = await prisma.question.findMany({
      where,
      include: {
        topic: {
          include: {
            unit: {
              include: {
                syllabus: true,
              },
            },
          },
        },
      },
    });

    const documents: IndexableDocument[] = questions.map((q) => ({
      id: `question_${q.id}`,
      text: `Question: ${q.questionText}\nType: ${q.questionType}\nDifficulty: ${q.difficulty}\nExplanation: ${q.explanation || 'N/A'}`,
      metadata: {
        type: 'question',
        id: q.id,
        topicId: q.topicId,
        unitId: q.topic.unitId,
        syllabusId: q.topic.unit.syllabusId,
        subject: q.topic.unit.syllabus.subjectName,
        class: q.topic.unit.syllabus.className,
        board: q.topic.unit.syllabus.board,
        questionType: q.questionType,
        difficulty: q.difficulty,
        teacherId: q.teacherId,
      },
    }));

    await this.indexDocuments(documents);
    console.log(`✅ Indexed ${documents.length} questions`);
  }

  /**
   * Reindex all content (maintenance operation)
   */
  async reindexAll(): Promise<void> {
    console.log('🔄 Starting full reindex...');

    // Index all syllabi
    const syllabi = await prisma.syllabus.findMany({ select: { id: true } });
    for (const syllabus of syllabi) {
      await this.indexSyllabus(syllabus.id);
    }

    // Index all questions
    await this.indexQuestions();

    console.log('✅ Full reindex completed');
  }

  /**
   * Build enhanced prompt with conversation history and retrieved context
   */
  private buildEnhancedPrompt(params: {
    userQuery: string;
    conversationHistory: Array<{ role: string; content: string }>;
    retrievedContext: string;
  }): string {
    const { userQuery, conversationHistory, retrievedContext } = params;

    let prompt = '';

    // System instructions
    prompt += `You are an intelligent educational AI assistant. Use the provided context and conversation history to give accurate, helpful responses.\n\n`;

    // Add retrieved documents (RAG context)
    if (retrievedContext) {
      prompt += `--- RELEVANT CONTEXT ---\n${retrievedContext}\n\n`;
    }

    // Add conversation history (last 10 messages for token efficiency)
    if (conversationHistory.length > 0) {
      const recentHistory = conversationHistory.slice(-10);
      prompt += `--- CONVERSATION HISTORY ---\n`;
      for (const msg of recentHistory) {
        prompt += `${msg.role.toUpperCase()}: ${msg.content}\n`;
      }
      prompt += `\n`;
    }

    // Add current user query
    prompt += `--- CURRENT QUERY ---\nUSER: ${userQuery}\n\nASSISTANT:`;

    return prompt;
  }

  /**
   * Build context string from retrieved documents
   */
  private buildRetrievedContext(
    docs: Array<{ text: string; score?: number; metadata: Record<string, any> }>
  ): string {
    if (docs.length === 0) return '';

    return docs
      .map((doc, i) => {
        const source = doc.metadata.type ? `[${doc.metadata.type.toUpperCase()}]` : '[DOCUMENT]';
        return `${source} Document ${i + 1} (Score: ${(doc.score || 0).toFixed(2)})\n${doc.text}`;
      })
      .join('\n\n');
  }

  /**
   * Build Qdrant filter from RAG query filters
   */
  private buildQdrantFilter(filters?: RAGQueryOptions['filters']): any {
    if (!filters) return undefined;

    const must: any[] = [];

    if (filters.subject) {
      must.push({ key: 'subject', match: { value: filters.subject } });
    }
    if (filters.class) {
      must.push({ key: 'class', match: { value: filters.class } });
    }
    if (filters.board) {
      must.push({ key: 'board', match: { value: filters.board } });
    }
    if (filters.teacherId) {
      must.push({ key: 'teacherId', match: { value: filters.teacherId } });
    }
    if (filters.topicIds && filters.topicIds.length > 0) {
      must.push({ key: 'id', match: { any: filters.topicIds } });
    }

    return must.length > 0 ? { must } : undefined;
  }

  /**
   * Clear cache for RAG queries
   */
  async clearCache(): Promise<void> {
    await cacheService.deletePattern('rag:*');
    console.log('✅ RAG cache cleared');
  }
}

// Export singleton instance
export const ragService = new RAGService();
