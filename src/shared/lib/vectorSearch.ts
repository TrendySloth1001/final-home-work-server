/**
 * Vector Search Service
 * Smart caching using Qdrant vector database for semantic similarity
 */

import { randomUUID } from 'crypto';
import { qdrantService } from './qdrant';
import { embeddingService } from './embeddings';
import { SearchResult } from './webSearch';
import { config } from '../config';

interface CurriculumSearchPayload {
  query: string;
  board: string;
  className: string;
  subject: string;
  results: SearchResult[];
  timestamp: number;
  resultCount: number;
}

interface SyllabusPayload {
  syllabusId: string;
  teacherId: string;
  subjectName: string;
  className: string;
  board: string;
  objectives: string;
  overview: string;
  unitsCount: number;
  topicsCount: number;
  timestamp: number;
}

export interface TopicPayload {
  topicId: string;
  topicName: string;
  description: string;
  keywords: string;
  unitId: string;
  syllabusId: string;
}

const COLLECTIONS = {
  CURRICULUM_SEARCHES: 'curriculum-searches',
  SYLLABUS_CONTENT: 'syllabus-content',
  TOPIC_EMBEDDINGS: 'topic-embeddings',
};

const SIMILARITY_THRESHOLD = 0.85; // 85% similarity to reuse results

/**
 * Search for similar curriculum queries in vector DB
 * Returns cached results if similarity > threshold
 */
export async function searchSimilarCurriculumQueries(params: {
  subject: string;
  className: string;
  board: string;
  academicYear?: string;
  term?: string;
}): Promise<SearchResult[] | null> {
  try {
    console.log('[VectorSearch] Searching for similar curriculum queries...');
    console.log('[VectorSearch] Params:', JSON.stringify(params));

    // Generate embedding for the query
    const queryText = `${params.board} ${params.className} ${params.subject} syllabus ${params.academicYear || ''} ${params.term || ''}`.trim();
    console.log('[VectorSearch] Query text:', queryText);
    
    const queryEmbedding = await embeddingService.generateEmbedding(queryText);
    console.log('[VectorSearch] Generated embedding (384D)');

    // Search in Qdrant
    const similarResults = await qdrantService.search(
      COLLECTIONS.CURRICULUM_SEARCHES,
      queryEmbedding,
      1, // top 1 result
      SIMILARITY_THRESHOLD
    );

    if (similarResults.length === 0) {
      if (config.isDevelopment) {
        console.log('[VectorSearch/DEV] ✗ No similar queries found in Vector DB');
        console.log('[VectorSearch/DEV] Similarity threshold: 0.85 (85%)');
      }
      console.log('[VectorSearch] ✗ No similar queries found (threshold: 0.85)');
      return null;
    }

    const match = similarResults[0];
    if (!match || !match.payload) {
      console.log('[VectorSearch] ✗ No valid match found');
      return null;
    }
    
    console.log('[VectorSearch] ✓ Found similar query!');
    console.log('[VectorSearch] Similarity:', (match.score * 100).toFixed(1) + '%');
    console.log('[VectorSearch] Original query:', match.payload.query);
    console.log('[VectorSearch] Cached results:', match.payload.resultCount);

    return match.payload.results as SearchResult[];
  } catch (error) {
    console.error('[VectorSearch] Search failed:', error);
    return null;
  }
}

/**
 * Store curriculum search results in vector DB
 */
export async function storeCurriculumSearch(
  params: {
    subject: string;
    className: string;
    board: string;
    academicYear?: string;
    term?: string;
  },
  results: SearchResult[]
): Promise<void> {
  try {
    console.log('[VectorSearch] Storing curriculum search in vector DB...');

    const queryText = `${params.board} ${params.className} ${params.subject} syllabus ${params.academicYear || ''} ${params.term || ''}`.trim();
    const queryEmbedding = await embeddingService.generateEmbedding(queryText);

    const payload: CurriculumSearchPayload = {
      query: queryText,
      board: params.board,
      className: params.className,
      subject: params.subject,
      results,
      timestamp: Date.now(),
      resultCount: results.length,
    };

    await qdrantService.upsertPointsBatch(COLLECTIONS.CURRICULUM_SEARCHES, [
      {
        id: randomUUID(),
        vector: queryEmbedding,
        payload: payload as unknown as Record<string, unknown>,
      },
    ]);

    if (config.isDevelopment) {
      console.log('[VectorSearch/DEV] ✓ Search stored in Vector DB successfully');
      console.log('[VectorSearch/DEV] Collection:', COLLECTIONS.CURRICULUM_SEARCHES);
    }
    console.log('[VectorSearch] ✓ Stored search with', results.length, 'results');
  } catch (error) {
    console.error('[VectorSearch] Failed to store search:', error);
    // Don't throw - this is not critical
  }
}

/**
 * Store syllabus content in vector DB for similarity search
 */
export async function storeSyllabusEmbedding(syllabus: {
  id: string;
  teacherId: string;
  subjectName: string;
  className: string;
  board: string;
  objectives: string;
  overview: string;
  units: any[];
}): Promise<void> {
  try {
    console.log('[VectorSearch] Generating syllabus embedding...');

    // Combine objectives and overview for embedding
    const syllabusText = `${syllabus.subjectName} ${syllabus.className} ${syllabus.board}\n${syllabus.objectives}\n${syllabus.overview}`;
    const embedding = await embeddingService.generateEmbedding(syllabusText);

    const topicsCount = syllabus.units.reduce((sum, unit) => sum + (unit.topics?.length || 0), 0);

    const payload: SyllabusPayload = {
      syllabusId: syllabus.id,
      teacherId: syllabus.teacherId,
      subjectName: syllabus.subjectName,
      className: syllabus.className,
      board: syllabus.board,
      objectives: syllabus.objectives,
      overview: syllabus.overview,
      unitsCount: syllabus.units.length,
      topicsCount,
      timestamp: Date.now(),
    };

    await qdrantService.upsertPointsBatch(COLLECTIONS.SYLLABUS_CONTENT, [
      {
        id: syllabus.id, // Use existing UUID from database
        vector: embedding,
        payload: payload as unknown as Record<string, unknown>,
      },
    ]);

    if (config.isDevelopment) {
      console.log('[VectorSearch/DEV] ✓ Syllabus embedding stored in Vector DB');
      console.log('[VectorSearch/DEV] Collection:', COLLECTIONS.SYLLABUS_CONTENT);
    }
    console.log('[VectorSearch] ✓ Stored syllabus embedding');
  } catch (error) {
    console.error('[VectorSearch] Failed to store syllabus embedding:', error);
  }
}

/**
 * Store topic embeddings in both Qdrant and database
 */
export async function storeTopicEmbeddings(
  topics: Array<{
    id: string;
    topicName: string;
    description?: string | null;
    keywords?: string | null;
    unitId: string;
    syllabusId?: string;
  }>
): Promise<void> {
  try {
    console.log('[VectorSearch] Generating embeddings for', topics.length, 'topics...');

    const vectors = [];

    for (const topic of topics) {
      // Combine name, description, and keywords for embedding
      const topicText = `${topic.topicName} ${topic.description || ''} ${topic.keywords || ''}`.trim();
      const embedding = await embeddingService.generateEmbedding(topicText);

      // Store in Qdrant
      const payload: TopicPayload = {
        topicId: topic.id,
        topicName: topic.topicName,
        description: topic.description || '',
        keywords: topic.keywords || '',
        unitId: topic.unitId,
        syllabusId: topic.syllabusId || '',
      };

      vectors.push({
        id: topic.id, // Use existing UUID from database
        vector: embedding,
        payload,
      });

      // Also store embedding in database for direct access
      await prisma.topic.update({
        where: { id: topic.id },
        data: { embedding: JSON.stringify(embedding) },
      });
    }

    // Batch upsert to Qdrant
    await qdrantService.upsertPointsBatch(
      COLLECTIONS.TOPIC_EMBEDDINGS,
      vectors.map(v => ({ ...v, payload: v.payload as unknown as Record<string, unknown> }))
    );

    if (config.isDevelopment) {
      console.log('[VectorSearch/DEV] ✓ All topic embeddings stored in Vector DB and database');
      console.log('[VectorSearch/DEV] Collection:', COLLECTIONS.TOPIC_EMBEDDINGS);
    }
    console.log('[VectorSearch] ✓ Stored embeddings for', topics.length, 'topics');
  } catch (error) {
    console.error('[VectorSearch] Failed to store topic embeddings:', error);
  }
}

/**
 * Search for similar syllabi based on subject, class, and board
 */
export async function searchSimilarSyllabi(params: {
  subject: string;
  className: string;
  board?: string;
  limit?: number;
}): Promise<SyllabusPayload[]> {
  try {
    console.log('[VectorSearch] Searching for similar syllabi...');

    const queryText = `${params.subject} ${params.className} ${params.board || ''}`.trim();
    const queryEmbedding = await embeddingService.generateEmbedding(queryText);

    const results = await qdrantService.search(
      COLLECTIONS.SYLLABUS_CONTENT,
      queryEmbedding,
      params.limit || 5,
      0.7 // Lower threshold for recommendations
    );

    console.log('[VectorSearch] Found', results.length, 'similar syllabi');

    return results
      .filter((r) => r.payload)
      .map((r) => r.payload as unknown as SyllabusPayload);
  } catch (error) {
    console.error('[VectorSearch] Failed to search similar syllabi:', error);
    return [];
  }
}

/**
 * Search for similar topics based on topic name and description
 */
export async function searchSimilarTopics(
  topicName: string,
  limit: number = 10
): Promise<TopicPayload[]> {
  try {
    console.log('[VectorSearch] Searching for similar topics to:', topicName);

    const queryEmbedding = await embeddingService.generateEmbedding(topicName);

    const results = await qdrantService.search(
      COLLECTIONS.TOPIC_EMBEDDINGS,
      queryEmbedding,
      limit,
      0.7 // Lower threshold for recommendations
    );

    console.log('[VectorSearch] Found', results.length, 'similar topics');

    return results
      .filter((r) => r.payload)
      .map((r) => r.payload as unknown as TopicPayload);
  } catch (error) {
    console.error('[VectorSearch] Failed to search similar topics:', error);
    return [];
  }
}

/**
 * Get cache statistics
 */
export async function getCacheStats(): Promise<{
  curriculumSearchesCount: number;
  syllabiCount: number;
  topicsCount: number;
}> {
  try {
    const [curriculumSearchesCount, syllabiCount, topicsCount] = await Promise.all([
      qdrantService.getCollectionInfo(COLLECTIONS.CURRICULUM_SEARCHES).then((info: any) => info?.vectors_count || 0),
      qdrantService.getCollectionInfo(COLLECTIONS.SYLLABUS_CONTENT).then((info: any) => info?.vectors_count || 0),
      qdrantService.getCollectionInfo(COLLECTIONS.TOPIC_EMBEDDINGS).then((info: any) => info?.vectors_count || 0),
    ]);

    return {
      curriculumSearchesCount,
      syllabiCount,
      topicsCount,
    };
  } catch (error) {
    console.error('[VectorSearch] Failed to get cache stats:', error);
    return {
      curriculumSearchesCount: 0,
      syllabiCount: 0,
      topicsCount: 0,
    };
  }
}

// Need prisma import
import { prisma } from './prisma';




// One IMPORTANT thing to do (don’t skip this)
// Your future savings depend on how you store embeddings.
// You must embed:
// Topic
// Class
// Board
// Difficulty
// Learning objective
// Bloom’s taxonomy (optional but OP)
// This ensures:
// High-quality similarity hits
// Less false positives
// Less AI fallback
// Bad embeddings = AI still runs = money burns.


// Extra win you may not realize yet
// Your vector DB also enables:
// Analytics (“most asked concepts”)
// Adaptive learning (weak-area detection)
// Follow-up questions without regeneration
// Spaced repetition logic later
// All from the same data. Chef’s kiss 👌