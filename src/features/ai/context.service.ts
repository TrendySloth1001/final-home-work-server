import { prisma } from '../../shared/lib/prisma';
import { embeddingService } from '../../shared/lib/embeddings';
import { qdrantService } from '../../shared/lib/qdrant';
import { cacheService, CacheKeys } from '../../shared/lib/cache';

/**
 * Context Builder Service for RAG
 * 
 * Builds rich context for AI generation by retrieving relevant information
 * from the database and vector stores.
 */

export interface TopicContext {
  topicId: string;
  topicName: string;
  description: string | null;
  unitTitle: string;
  unitDescription: string | null;
  syllabusInfo: {
    subjectName: string;
    className: string;
    board: string;
  };
  relatedTopics: Array<{
    id: string;
    name: string;
    description: string | null;
  }>;
}

export interface QuestionContext {
  existingQuestions: Array<{
    id: string;
    questionText: string;
    questionType: string;
    difficulty: string;
    embedding?: number[];
  }>;
  questionStats: {
    total: number;
    byDifficulty: Record<string, number>;
    byType: Record<string, number>;
  };
  similarQuestions?: Array<{
    id: string;
    questionText: string;
    similarity: number;
  }>;
}

export interface EnhancedContext {
  topic: TopicContext;
  questions: QuestionContext;
  curriculum: {
    objectives?: string;
    overview?: string;
  };
}

class ContextBuilderService {
  /**
   * Build comprehensive context for a topic
   */
  async buildTopicContext(topicId: string): Promise<TopicContext> {
    // Try cache first
    const cacheKey = CacheKeys.topicContext(topicId);
    const cached = await cacheService.get<TopicContext>(cacheKey);
    if (cached) return cached;

    // Fetch topic with full hierarchy
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        unit: {
          include: {
            syllabus: {
              select: {
                subjectName: true,
                className: true,
                board: true,
                objectives: true,
                overview: true,
              },
            },
            topics: {
              where: {
                id: { not: topicId },
              },
              select: {
                id: true,
                topicName: true,
                description: true,
              },
              take: 5,
            },
          },
        },
      },
    });

    if (!topic) {
      throw new Error(`Topic not found: ${topicId}`);
    }

    const context: TopicContext = {
      topicId: topic.id,
      topicName: topic.topicName,
      description: topic.description,
      unitTitle: topic.unit.title,
      unitDescription: topic.unit.description,
      syllabusInfo: {
        subjectName: topic.unit.syllabus.subjectName,
        className: topic.unit.syllabus.className,
        board: topic.unit.syllabus.board,
      },
      relatedTopics: topic.unit.topics.map(t => ({
        id: t.id,
        name: t.topicName,
        description: t.description,
      })),
    };

    // Cache for 1 hour
    await cacheService.set(cacheKey, context, 3600);

    return context;
  }

  /**
   * Build question context for a topic
   */
  async buildQuestionContext(topicId: string): Promise<QuestionContext> {
    // Fetch existing questions
    const questions = await prisma.question.findMany({
      where: { topicId },
      select: {
        id: true,
        questionText: true,
        questionType: true,
        difficulty: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // Limit for performance
    });

    // Calculate statistics
    const stats = {
      total: questions.length,
      byDifficulty: questions.reduce((acc, q) => {
        acc[q.difficulty] = (acc[q.difficulty] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      byType: questions.reduce((acc, q) => {
        acc[q.questionType] = (acc[q.questionType] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    return {
      existingQuestions: questions as Array<{
        id: string;
        questionText: string;
        questionType: string;
        difficulty: string;
      }>,
      questionStats: stats,
    };
  }

  /**
   * Find similar questions using vector search
   */
  async findSimilarQuestions(
    queryText: string,
    topicId: string,
    threshold = 0.75,
    limit = 5
  ): Promise<Array<{ id: string; questionText: string; similarity: number }>> {
    try {
      // Generate embedding for query
      const queryEmbedding = await embeddingService.generateEmbedding(queryText);

      // Search in Qdrant first (if available)
      try {
        const qdrantResults = await qdrantService.search(
          qdrantService.COLLECTIONS.QUESTIONS,
          queryEmbedding,
          limit,
          threshold,
          { topicId }
        );

        if (qdrantResults.length > 0) {
          return qdrantResults.map(r => ({
            id: String(r.id),
            questionText: (r.payload?.questionText as string) || '',
            similarity: r.score,
          }));
        }
      } catch (error) {
        console.warn('Qdrant search failed, falling back to PostgreSQL:', error);
      }

      // Fallback: search in PostgreSQL using embeddings
      const questions = await prisma.question.findMany({
        where: {
          topicId,
          embedding: { not: null },
        },
        select: {
          id: true,
          questionText: true,
          embedding: true,
        },
      });
      
      if (questions.length === 0) {
        return [];
      }

      // Calculate similarity with each question (reuse queryEmbedding from above)
      const similarities = questions
        .map(q => {
          try {
            const questionEmbedding = JSON.parse(q.embedding!);
            const similarity = embeddingService.cosineSimilarity(queryEmbedding, questionEmbedding);
            return {
              id: q.id,
              questionText: q.questionText,
              similarity,
            };
          } catch (error) {
            console.error(`Failed to parse embedding for question ${q.id}:`, error);
            return null;
          }
        })
        .filter((item): item is { id: string; questionText: string; similarity: number } => 
          item !== null && item.similarity >= threshold
        )
        .sort((a, b) => b.similarity - a.similarity)
        .slice(0, limit);

      return similarities;
    } catch (error) {
      console.error('Error finding similar questions:', error);
      return [];
    }
  }

  /**
   * Build complete enhanced context for AI generation
   */
  async buildEnhancedContext(
    topicId: string,
    options: {
      includeSimilarQuestions?: boolean;
      queryText?: string;
    } = {}
  ): Promise<EnhancedContext> {
    const [topicContext, questionContext] = await Promise.all([
      this.buildTopicContext(topicId),
      this.buildQuestionContext(topicId),
    ]);

    // Optionally find similar questions
    if (options.includeSimilarQuestions && options.queryText) {
      const similarQuestions = await this.findSimilarQuestions(
        options.queryText,
        topicId
      );
      questionContext.similarQuestions = similarQuestions;
    }

    // Get curriculum context from syllabus
    const topic = await prisma.topic.findUnique({
      where: { id: topicId },
      include: {
        unit: {
          include: {
            syllabus: {
              select: {
                objectives: true,
                overview: true,
              },
            },
          },
        },
      },
    });

    const curriculum: { objectives?: string; overview?: string } = {};
    if (topic?.unit.syllabus.objectives) {
      curriculum.objectives = topic.unit.syllabus.objectives;
    }
    if (topic?.unit.syllabus.overview) {
      curriculum.overview = topic.unit.syllabus.overview;
    }

    return {
      topic: topicContext,
      questions: questionContext,
      curriculum,
    };
  }

  /**
   * Build enhanced prompt with context
   */
  buildEnhancedPrompt(
    basePrompt: string,
    context: EnhancedContext,
    options: {
      difficulty?: string;
      questionType?: string;
      count?: number;
    } = {}
  ): string {
    const parts: string[] = [];

    // Add curriculum context
    parts.push(`# Educational Context`);
    parts.push(`Board: ${context.topic.syllabusInfo.board}`);
    parts.push(`Class: ${context.topic.syllabusInfo.className}`);
    parts.push(`Subject: ${context.topic.syllabusInfo.subjectName}`);
    parts.push(`\n# Curriculum Structure`);
    parts.push(`Unit: ${context.topic.unitTitle}`);
    if (context.topic.unitDescription) {
      parts.push(`Unit Description: ${context.topic.unitDescription}`);
    }
    parts.push(`Topic: ${context.topic.topicName}`);
    if (context.topic.description) {
      parts.push(`Topic Description: ${context.topic.description}`);
    }

    // Add curriculum objectives
    if (context.curriculum.objectives) {
      parts.push(`\n# Learning Objectives`);
      parts.push(context.curriculum.objectives);
    }

    // Add related topics for context
    if (context.topic.relatedTopics.length > 0) {
      parts.push(`\n# Related Topics in Same Unit`);
      context.topic.relatedTopics.forEach(t => {
        parts.push(`- ${t.name}${t.description ? `: ${t.description}` : ''}`);
      });
    }

    // Add question statistics
    if (context.questions.questionStats.total > 0) {
      parts.push(`\n# Existing Questions Statistics`);
      parts.push(`Total questions: ${context.questions.questionStats.total}`);
      
      if (Object.keys(context.questions.questionStats.byDifficulty).length > 0) {
        parts.push(`Difficulty distribution:`);
        Object.entries(context.questions.questionStats.byDifficulty).forEach(([diff, count]) => {
          parts.push(`  - ${diff}: ${count}`);
        });
      }
      
      if (Object.keys(context.questions.questionStats.byType).length > 0) {
        parts.push(`Type distribution:`);
        Object.entries(context.questions.questionStats.byType).forEach(([type, count]) => {
          parts.push(`  - ${type}: ${count}`);
        });
      }
    }

    // Add examples of existing questions to avoid duplication
    if (context.questions.existingQuestions.length > 0) {
      parts.push(`\n# Avoid Duplicating These Question Patterns`);
      const samples = context.questions.existingQuestions
        .slice(0, 5)
        .map(q => `- [${q.questionType}] ${q.questionText.substring(0, 100)}...`);
      parts.push(samples.join('\n'));
    }

    // Add similar questions if available
    if (context.questions.similarQuestions && context.questions.similarQuestions.length > 0) {
      parts.push(`\n# Similar Questions to Avoid`);
      context.questions.similarQuestions.forEach(q => {
        parts.push(`- (${(q.similarity * 100).toFixed(1)}% similar) ${q.questionText}`);
      });
    }

    // Add generation requirements
    parts.push(`\n# Generation Requirements`);
    if (options.difficulty) {
      parts.push(`Difficulty Level: ${options.difficulty}`);
    }
    if (options.questionType) {
      parts.push(`Question Type: ${options.questionType}`);
    }
    if (options.count) {
      parts.push(`Number of Questions: ${options.count}`);
    }

    // Add base prompt
    parts.push(`\n# Task`);
    parts.push(basePrompt);

    parts.push(`\n# Important Guidelines`);
    parts.push(`- Questions must be unique and not duplicate existing patterns`);
    parts.push(`- Maintain educational quality appropriate for ${context.topic.syllabusInfo.board} ${context.topic.syllabusInfo.className}`);
    parts.push(`- Focus specifically on: ${context.topic.topicName}`);
    parts.push(`- Provide clear, accurate, and educationally sound questions`);

    return parts.join('\n');
  }

  /**
   * Check if question is duplicate using embedding similarity
   */
  async isDuplicate(
    questionText: string,
    topicId: string,
    threshold = 0.85
  ): Promise<{ isDuplicate: boolean; similarQuestion?: { id: string; questionText: string; similarity: number } }> {
    const similarQuestions = await this.findSimilarQuestions(
      questionText,
      topicId,
      threshold,
      1
    );

    if (similarQuestions.length > 0) {
      const result: { isDuplicate: boolean; similarQuestion?: { id: string; questionText: string; similarity: number } } = {
        isDuplicate: true,
      };
      const firstMatch = similarQuestions[0];
      if (firstMatch) {
        result.similarQuestion = firstMatch;
      }
      return result;
    }

    return { isDuplicate: false };
  }
}

export const contextBuilderService = new ContextBuilderService();
