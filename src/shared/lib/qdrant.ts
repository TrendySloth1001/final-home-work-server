import { QdrantClient } from '@qdrant/js-client-rest';
import { config } from '../config';

/**
 * Qdrant Vector Database Client
 * 
 * Provides high-performance vector search capabilities for semantic similarity
 * Used for RAG (Retrieval-Augmented Generation) and duplicate detection
 */

class QdrantService {
  private static instance: QdrantService;
  private client: QdrantClient;
  
  // Collection names
  public readonly COLLECTIONS = {
    QUESTIONS: 'questions',
    TOPICS: 'topics',
    SYLLABUS: 'syllabus',
  } as const;

  // Embedding dimension (must match embedding service)
  private readonly EMBEDDING_DIMENSION = 384;

  private constructor() {
    // Parse Qdrant URL
    const qdrantUrl = config.qdrant?.url || 'http://localhost:6333';
    
    this.client = new QdrantClient({
      url: qdrantUrl,
    });

    console.log(`:: Qdrant client initialized: ${qdrantUrl}`);
  }

  /**
   * Get singleton instance
   */
  public static getInstance(): QdrantService {
    if (!QdrantService.instance) {
      QdrantService.instance = new QdrantService();
    }
    return QdrantService.instance;
  }

  /**
   * Get Qdrant client
   */
  getClient(): QdrantClient {
    return this.client;
  }

  /**
   * Check if Qdrant is healthy
   */
  async isHealthy(): Promise<boolean> {
    try {
      await this.client.getCollections();
      return true;
    } catch (error) {
      console.error('Qdrant health check failed:', error);
      return false;
    }
  }

  /**
   * Ensure collection exists, create if not
   */
  async ensureCollection(collectionName: string): Promise<void> {
    try {
      const collections = await this.client.getCollections();
      const exists = collections.collections.some(c => c.name === collectionName);

      if (!exists) {
        console.log(`:: Creating Qdrant collection: ${collectionName}`);
        await this.client.createCollection(collectionName, {
          vectors: {
            size: this.EMBEDDING_DIMENSION,
            distance: 'Cosine',
          },
          optimizers_config: {
            default_segment_number: 2,
          },
          replication_factor: 1,
        });
        console.log(`:: Collection created: ${collectionName}`);
      }
    } catch (error) {
      console.error(`:: Error ensuring collection ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Upsert a point (vector with payload)
   */
  /**
   * Convert UUID string to numeric hash for Qdrant
   */
  private uuidToNumber(uuid: string): number {
    // Use first 8 chars of UUID and convert to number
    const hex = uuid.replace(/-/g, '').substring(0, 8);
    return parseInt(hex, 16);
  }

  async upsertPoint(
    collectionName: string,
    id: string,
    vector: number[],
    payload: Record<string, unknown>
  ): Promise<void> {
    try {
      await this.ensureCollection(collectionName);
      
      const numericId = this.uuidToNumber(id);
      
      await this.client.upsert(collectionName, {
        wait: true,
        points: [
          {
            id: numericId,
            vector: vector,
            payload: { ...payload, originalId: id },
          },
        ],
      });
    } catch (error) {
      console.error(`Error upserting point to ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Batch upsert multiple points
   */
  async upsertPointsBatch(
    collectionName: string,
    points: Array<{
      id: string;
      vector: number[];
      payload: Record<string, unknown>;
    }>
  ): Promise<void> {
    try {
      await this.ensureCollection(collectionName);
      
      const convertedPoints = points.map(p => ({
        id: this.uuidToNumber(p.id),
        vector: p.vector,
        payload: { ...p.payload, originalId: p.id },
      }));
      
      await this.client.upsert(collectionName, {
        wait: true,
        points: convertedPoints,
      });
    } catch (error) {
      console.error(`Error batch upserting to ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Search for similar vectors
   */
  async search(
    collectionName: string,
    queryVector: number[],
    limit = 10,
    scoreThreshold?: number,
    filter?: Record<string, unknown>
  ): Promise<Array<{ id: string | number; score: number; payload?: Record<string, unknown> }>> {
    try {
      const searchParams: any = {
        vector: queryVector,
        limit: limit,
        with_payload: true,
      };
      if (scoreThreshold !== undefined) {
        searchParams.score_threshold = scoreThreshold;
      }
      if (filter !== undefined && Object.keys(filter).length > 0) {
        // Convert simple key-value filter to Qdrant filter format
        searchParams.filter = {
          must: Object.entries(filter).map(([key, value]) => ({
            key: key,
            match: { value: value }
          }))
        };
      }

      const results = await this.client.search(collectionName, searchParams);

      return results.map(result => {
        const mapped: { id: string | number; score: number; payload?: Record<string, unknown> } = {
          id: result.id,
          score: result.score,
        };
        if (result.payload) {
          mapped.payload = result.payload as Record<string, unknown>;
        }
        return mapped;
      });
    } catch (error) {
      console.error(`Error searching in ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete a point
   */
  async deletePoint(collectionName: string, id: string): Promise<void> {
    try {
      await this.client.delete(collectionName, {
        wait: true,
        points: [id],
      });
    } catch (error) {
      console.error(`Error deleting point from ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Delete multiple points
   */
  async deletePoints(collectionName: string, ids: string[]): Promise<void> {
    try {
      await this.client.delete(collectionName, {
        wait: true,
        points: ids,
      });
    } catch (error) {
      console.error(`Error deleting points from ${collectionName}:`, error);
      throw error;
    }
  }

  /**
   * Get collection info
   */
  async getCollectionInfo(collectionName: string) {
    try {
      return await this.client.getCollection(collectionName);
    } catch (error) {
      console.error(`Error getting collection info for ${collectionName}:`, error);
      return null;
    }
  }

  /**
   * Initialize all required collections
   */
  async initializeCollections(): Promise<void> {
    console.log(':: Initializing Qdrant collections...');
    
    try {
      await Promise.all([
        this.ensureCollection(this.COLLECTIONS.QUESTIONS),
        this.ensureCollection(this.COLLECTIONS.TOPICS),
        this.ensureCollection(this.COLLECTIONS.SYLLABUS),
      ]);
      
      console.log(':: All Qdrant collections initialized');
    } catch (error) {
      console.error(':: Failed to initialize Qdrant collections:', error);
      throw error;
    }
  }

  /**
   * Get statistics for all collections
   */
  async getStats(): Promise<Record<string, unknown>> {
    try {
      const collections = await this.client.getCollections();
      
      const stats: Record<string, unknown> = {};
      
      for (const collection of collections.collections) {
        const info = await this.client.getCollection(collection.name);
        stats[collection.name] = {
          pointsCount: info.points_count,
          indexedVectorsCount: info.indexed_vectors_count,
        };
      }
      
      return stats;
    } catch (error) {
      console.error('Error getting Qdrant stats:', error);
      return {};
    }
  }
}

// Export singleton instance
export const qdrantService = QdrantService.getInstance();

// Export types
export type QdrantCollectionName = typeof qdrantService.COLLECTIONS[keyof typeof qdrantService.COLLECTIONS];
