/**
 * Redis Cache Utility
 * Provides caching functionality for AI responses and database queries
 */

import Redis from 'ioredis';
import { config } from '../config';

class CacheService {
  private redis: Redis | null = null;
  private enabled: boolean;

  constructor() {
    this.enabled = config.redis?.enabled || false;

    if (this.enabled && config.redis?.url) {
      try {
        this.redis = new Redis(config.redis.url, {
          maxRetriesPerRequest: 3,
          retryStrategy: (times) => {
            const delay = Math.min(times * 50, 2000);
            return delay;
          },
          lazyConnect: true,
        });

        this.redis.on('error', (err) => {
          console.error('Redis connection error:', err);
        });

        this.redis.on('connect', () => {
          console.log('Redis connected successfully');
        });

        // Connect immediately
        this.redis.connect().catch((err) => {
          console.error('Failed to connect to Redis:', err);
          this.enabled = false;
          this.redis = null;
        });
      } catch (error) {
        console.error('Redis initialization error:', error);
        this.enabled = false;
        this.redis = null;
      }
    }
  }

  /**
   * Get a cached value
   */
  async get<T>(key: string): Promise<T | null> {
    if (!this.enabled || !this.redis) return null;

    try {
      const value = await this.redis.get(key);
      if (!value) return null;

      return JSON.parse(value) as T;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  /**
   * Set a cached value with TTL (time to live in seconds)
   */
  async set<T>(key: string, value: T, ttl: number = 3600): Promise<boolean> {
    if (!this.enabled || !this.redis) return false;

    try {
      const serialized = JSON.stringify(value);
      await this.redis.setex(key, ttl, serialized);
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  /**
   * Delete a cached value
   */
  async delete(key: string): Promise<boolean> {
    if (!this.enabled || !this.redis) return false;

    try {
      await this.redis.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  /**
   * Delete all keys matching a pattern
   */
  async deletePattern(pattern: string): Promise<number> {
    if (!this.enabled || !this.redis) return 0;

    try {
      const keys = await this.redis.keys(pattern);
      if (keys.length === 0) return 0;

      await this.redis.del(...keys);
      return keys.length;
    } catch (error) {
      console.error('Cache deletePattern error:', error);
      return 0;
    }
  }

  /**
   * Check if a key exists
   */
  async exists(key: string): Promise<boolean> {
    if (!this.enabled || !this.redis) return false;

    try {
      const result = await this.redis.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  /**
   * Get or set a cached value (fetch if not exists)
   */
  async getOrSet<T>(
    key: string,
    fetchFn: () => Promise<T>,
    ttl: number = 3600
  ): Promise<T> {
    // Try to get from cache first
    const cached = await this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    // Fetch fresh data
    const fresh = await fetchFn();

    // Cache it (don't await to avoid slowing down response)
    this.set(key, fresh, ttl).catch((err) => {
      console.error('Failed to cache data:', err);
    });

    return fresh;
  }

  /**
   * Increment a counter (useful for rate limiting)
   */
  async increment(key: string, ttl?: number): Promise<number> {
    if (!this.enabled || !this.redis) return 1;

    try {
      const value = await this.redis.incr(key);
      if (ttl && value === 1) {
        await this.redis.expire(key, ttl);
      }
      return value;
    } catch (error) {
      console.error('Cache increment error:', error);
      return 1;
    }
  }

  /**
   * Get cache statistics
   */
  async getStats(): Promise<{
    enabled: boolean;
    connected: boolean;
    keyCount?: number;
  }> {
    if (!this.enabled || !this.redis) {
      return { enabled: false, connected: false };
    }

    try {
      const keyCount = await this.redis.dbsize();
      return {
        enabled: true,
        connected: this.redis.status === 'ready',
        keyCount,
      };
    } catch (error) {
      return { enabled: true, connected: false };
    }
  }

  /**
   * Close Redis connection (for graceful shutdown)
   */
  async disconnect(): Promise<void> {
    if (this.redis) {
      await this.redis.quit();
    }
  }

  /**
   * Check if cache is enabled and connected
   */
  isAvailable(): boolean {
    return this.enabled && this.redis !== null && this.redis.status === 'ready';
  }
}

// Export singleton instance
export const cacheService = new CacheService();

// Graceful shutdown
process.on('beforeExit', async () => {
  await cacheService.disconnect();
});

/**
 * Cache key builders for consistent naming
 */
export const CacheKeys = {
  aiGeneration: (prompt: string, model: string) =>
    `ai:gen:${model}:${Buffer.from(prompt).toString('base64').substring(0, 50)}`,
  
  syllabus: (id: string) => `syllabus:${id}`,
  
  syllabusByTeacher: (teacherId: string, includeUnits?: boolean, includeTopics?: boolean) =>
    `syllabus:teacher:${teacherId}:units-${includeUnits}:topics-${includeTopics}`,
  
  unit: (id: string) => `unit:${id}`,
  
  unitsBySyllabus: (syllabusId: string) => `units:syllabus:${syllabusId}`,
  
  topic: (id: string) => `topic:${id}`,
  
  topicsByUnit: (unitId: string) => `topics:unit:${unitId}`,
  
  questionsByTopic: (topicId: string, filters?: string) =>
    `questions:topic:${topicId}${filters ? `:${filters}` : ''}`,
  
  topicContext: (topicId: string) => `context:topic:${topicId}`,
  
  aiHealth: () => `ai:health:status`,
  
  rateLimit: (identifier: string, window: string) => `ratelimit:${identifier}:${window}`,
};
