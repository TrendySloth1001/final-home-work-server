import { pipeline, Pipeline } from '@xenova/transformers';

/**
 * Embedding Service
 * 
 * Provides text embedding generation using sentence-transformers model
 * for semantic search and similarity calculations.
 * 
 * Model: all-MiniLM-L6-v2 (384 dimensions)
 * - Fast inference
 * - Good quality for semantic search
 * - Optimized for sentence/paragraph embeddings
 */

class EmbeddingService {
  private static instance: EmbeddingService;
  private pipeline: Pipeline | null = null;
  private isInitializing = false;
  private initPromise: Promise<void> | null = null;

  // Model configuration
  private readonly MODEL_NAME = 'Xenova/all-MiniLM-L6-v2';
  private readonly EMBEDDING_DIMENSION = 384;

  private constructor() {}

  /**
   * Get singleton instance
   */
  public static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Initialize the embedding pipeline
   * Downloads model on first use (cached afterwards)
   */
  private async initialize(): Promise<void> {
    if (this.pipeline) return;

    if (this.isInitializing && this.initPromise) {
      return this.initPromise;
    }

    this.isInitializing = true;
    this.initPromise = (async () => {
      try {
        console.log(`:: Loading embedding model: ${this.MODEL_NAME}...`);
        this.pipeline = await pipeline('feature-extraction', this.MODEL_NAME) as any;
        console.log(`:: Embedding model loaded successfully (${this.EMBEDDING_DIMENSION}D)`);
      } catch (error) {
        console.error(':: Failed to load embedding model:', error);
        this.isInitializing = false;
        this.initPromise = null;
        throw error;
      } finally {
        this.isInitializing = false;
      }
    })();

    return this.initPromise;
  }

  /**
   * Generate embedding vector for text
   * 
   * @param text - Input text to embed
   * @param normalize - Whether to normalize the vector (default: true)
   * @returns 384-dimensional embedding vector
   */
  async generateEmbedding(text: string, normalize = true): Promise<number[]> {
    if (!text || text.trim().length === 0) {
      throw new Error('Text cannot be empty');
    }

    await this.initialize();

    if (!this.pipeline) {
      throw new Error('Embedding pipeline not initialized');
    }

    try {
      // Generate embedding
      const output = await this.pipeline(text, {
        pooling: 'mean',
        normalize: normalize,
      });

      // Extract array from tensor
      const embedding = Array.from(output.data) as number[];

      // Validate dimension
      if (embedding.length !== this.EMBEDDING_DIMENSION) {
        throw new Error(
          `Unexpected embedding dimension: ${embedding.length}, expected ${this.EMBEDDING_DIMENSION}`
        );
      }

      return embedding;
    } catch (error) {
      console.error('Error generating embedding:', error);
      throw new Error(`Failed to generate embedding: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Generate embeddings for multiple texts in batch
   * More efficient than calling generateEmbedding multiple times
   * 
   * @param texts - Array of texts to embed
   * @param normalize - Whether to normalize vectors
   * @returns Array of embedding vectors
   */
  async generateEmbeddingsBatch(texts: string[], normalize = true): Promise<number[][]> {
    if (!texts || texts.length === 0) {
      return [];
    }

    // Filter out empty texts
    const validTexts = texts.filter(t => t && t.trim().length > 0);
    if (validTexts.length === 0) {
      return [];
    }

    await this.initialize();

    if (!this.pipeline) {
      throw new Error('Embedding pipeline not initialized');
    }

    try {
      // Process all texts in parallel for better performance
      const embeddings = await Promise.all(
        validTexts.map(text => this.generateEmbedding(text, normalize))
      );

      return embeddings;
    } catch (error) {
      console.error('Error generating batch embeddings:', error);
      throw new Error(`Failed to generate batch embeddings: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Calculate cosine similarity between two vectors
   * Returns value between -1 and 1 (1 = identical, 0 = orthogonal, -1 = opposite)
   * 
   * @param vec1 - First embedding vector
   * @param vec2 - Second embedding vector
   * @returns Cosine similarity score
   */
  cosineSimilarity(vec1: number[], vec2: number[]): number {
    if (vec1.length !== vec2.length) {
      throw new Error('Vectors must have the same dimension');
    }

    if (vec1.length !== this.EMBEDDING_DIMENSION) {
      throw new Error(`Invalid vector dimension: ${vec1.length}, expected ${this.EMBEDDING_DIMENSION}`);
    }

    let dotProduct = 0;
    let norm1 = 0;
    let norm2 = 0;

    for (let i = 0; i < vec1.length; i++) {
      const v1 = vec1[i]!;
      const v2 = vec2[i]!;
      dotProduct += v1 * v2;
      norm1 += v1 * v1;
      norm2 += v2 * v2;
    }

    // Handle zero vectors
    if (norm1 === 0 || norm2 === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(norm1) * Math.sqrt(norm2));
  }

  /**
   * Find most similar embeddings from a list
   * 
   * @param queryEmbedding - Query vector
   * @param candidateEmbeddings - List of candidate vectors
   * @param topK - Number of top results to return
   * @returns Indices and similarity scores of top matches
   */
  findMostSimilar(
    queryEmbedding: number[],
    candidateEmbeddings: number[][],
    topK = 5
  ): Array<{ index: number; score: number }> {
    if (candidateEmbeddings.length === 0) {
      return [];
    }

    // Calculate similarities
    const similarities = candidateEmbeddings.map((embedding, index) => ({
      index,
      score: this.cosineSimilarity(queryEmbedding, embedding),
    }));

    // Sort by score (descending) and take top K
    return similarities
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(topK, similarities.length));
  }

  /**
   * Check if embedding is valid
   */
  isValidEmbedding(embedding: unknown): embedding is number[] {
    return (
      Array.isArray(embedding) &&
      embedding.length === this.EMBEDDING_DIMENSION &&
      embedding.every(v => typeof v === 'number' && !isNaN(v))
    );
  }

  /**
   * Get embedding dimension
   */
  getDimension(): number {
    return this.EMBEDDING_DIMENSION;
  }

  /**
   * Preload the model (useful for warming up the service)
   */
  async warmup(): Promise<void> {
    console.log(':: Warming up embedding service...');
    await this.initialize();
    // Generate a test embedding to ensure everything works
    await this.generateEmbedding('test warmup');
    console.log(':: Embedding service ready');
  }
}

// Export singleton instance
export const embeddingService = EmbeddingService.getInstance();

// Export types
export interface EmbeddingResult {
  embedding: number[];
  dimension: number;
}

export interface SimilarityMatch {
  index: number;
  score: number;
  item?: unknown;
}
