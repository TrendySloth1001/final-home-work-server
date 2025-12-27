/**
 * AI Job Queue
 * Handles background processing of AI generation tasks
 */

import { Queue, Worker, Job } from 'bullmq';
import { config } from '../config';
import { ollamaService } from '../lib/ollama';
import { prisma } from '../lib/prisma';
import { embeddingService } from '../lib/embeddings';
import { qdrantService } from '../lib/qdrant';
import { contextBuilderService } from '../../features/ai/context.service';
import { searchCurriculum, extractContextFromResults, storeSearchResultsAsResources, SearchResult } from '../lib/webSearch';
import { 
  searchSimilarCurriculumQueries, 
  storeCurriculumSearch,
  storeSyllabusEmbedding,
  storeTopicEmbeddings 
} from '../lib/vectorSearch';
import { AIGenerationJobData, AIGenerationJobResult, JobTypes } from './types';
import { 
  TokenCalculator, 
  CompletenessScorer, 
  CircuitBreaker, 
  ExponentialBackoff 
} from '../lib/advancedOptimizations';

const connection = config.redis?.enabled && config.redis?.url
  ? {
      host: new URL(config.redis.url).hostname,
      port: parseInt(new URL(config.redis.url).port) || 6379,
    }
  : undefined;

/**
 * Helper: Create or update job in database
 */
async function persistJobToDatabase(
  jobId: string,
  data: AIGenerationJobData,
  status: 'waiting' | 'active' | 'completed' | 'failed',
  progress: number = 0,
  result?: any,
  error?: string
) {
  const { teacherId, type } = data;

  await prisma.jobQueue.upsert({
    where: { jobId },
    create: {
      jobId,
      jobType: type,
      teacherId,
      payload: JSON.stringify(data),
      status,
      progress,
      result: result ? JSON.stringify(result) : null,
      error: error || null,
      attempts: 0,
    },
    update: {
      status,
      progress,
      result: result ? JSON.stringify(result) : null,
      error: error || null,
      updatedAt: new Date(),
    },
  });
}

// Create AI generation queue
export const aiQueue = connection
  ? new Queue<AIGenerationJobData>(JobTypes.AI_GENERATION, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: {
          age: 24 * 3600, // Keep for 24 hours
          count: 1000,
        },
        removeOnFail: {
          age: 7 * 24 * 3600, // Keep failures for 7 days
        },
      },
    })
  : null;

// Process AI generation jobs
export const aiWorker = connection
  ? new Worker<AIGenerationJobData, AIGenerationJobResult>(
      JobTypes.AI_GENERATION,
      async (job: Job<AIGenerationJobData>) => {
        const startTime = Date.now();
        const { type, teacherId, topicId, unitId, syllabusId } = job.data;

        console.log(`Processing AI job ${job.id}: ${type}`);

        // Persist job as active
        await persistJobToDatabase(job.id!, job.data, 'active', 10);

        try {
          let result: any;
          let prompt = '';

          switch (type) {
            case 'question':
              result = await generateSingleQuestion(job.data);
              break;

            case 'questions-batch':
              result = await generateBatchQuestions(job.data);
              await persistJobToDatabase(job.id!, job.data, 'active', 50);
              break;

            case 'summary':
              result = await generateSummary(job.data);
              break;

            case 'enhancement':
              result = await generateEnhancement(job.data);
              break;

            case 'syllabus-generation':
              await persistJobToDatabase(job.id!, job.data, 'active', 30);
              result = await generateCompleteSyllabus(job.data);
              await persistJobToDatabase(job.id!, job.data, 'active', 90);
              break;

            default:
              throw new Error(`Unknown job type: ${type}`);
          }

          const duration = (Date.now() - startTime) / 1000;

          // Log to database
          await prisma.aIGeneration.create({
            data: {
              type,
              input: JSON.stringify(job.data),
              output: JSON.stringify(result),
              prompt: result.prompt,
              model: config.ai.ollama.model,
              provider: config.ai.provider,
              duration,
              status: 'success',
              teacherId,
              ...(topicId ? { topicId } : {}),
              ...(unitId ? { unitId } : {}),
              ...(syllabusId ? { syllabusId } : {}),
            },
          });

          // Persist completed job with result
          await persistJobToDatabase(job.id!, job.data, 'completed', 100, result);

          return {
            success: true,
            data: result,
            duration,
          };
        } catch (error) {
          const duration = (Date.now() - startTime) / 1000;
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';

          // Log failure to database
          await prisma.aIGeneration.create({
            data: {
              type,
              input: JSON.stringify(job.data),
              output: JSON.stringify({ error: errorMessage }),
              model: config.ai.ollama.model,
              provider: config.ai.provider,
              duration,
              status: 'failed',
              error: errorMessage,
              teacherId,
              ...(topicId ? { topicId } : {}),
              ...(unitId ? { unitId } : {}),
              ...(syllabusId ? { syllabusId } : {}),
            },
          });

          // Persist failed job
          await persistJobToDatabase(job.id!, job.data, 'failed', 0, undefined, errorMessage);

          throw error;
        }
      },
      {
        connection,
        concurrency: 2, // Process 2 jobs at a time
        limiter: {
          max: 10, // Max 10 jobs
          duration: 60000, // per minute
        },
      }
    )
  : null;

// Job processing functions
async function generateSingleQuestion(
  data: AIGenerationJobData,
  aiParams?: { temperature?: number; top_p?: number; top_k?: number; threshold?: number }
) {
  const { topicId, questionType = 'mcq', difficulty = 'medium' } = data;

  if (!topicId) throw new Error('Topic ID is required');

  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    include: {
      unit: {
        include: {
          syllabus: true,
        },
      },
    },
  });

  if (!topic) throw new Error('Topic not found');

  // Build RAG-enhanced context
  const context = await contextBuilderService.buildEnhancedContext(topicId);
  
  // Adaptive prompt strategies - rotate through different approaches
  const promptStrategies = [
    // Basic strategies
    'Focus on practical applications and real-world examples.',
    'Emphasize conceptual understanding and theoretical aspects.',
    'Include calculations or problem-solving elements.',
    'Test higher-order thinking skills like analysis or evaluation.',
    'Focus on definitions and foundational knowledge.',
    // Advanced strategies (for when stuck)
    'Create a scenario-based question involving multiple concepts.',
    'Design a compare-and-contrast question.',
    'Formulate a cause-and-effect relationship question.',
    'Ask about misconceptions or common mistakes.',
    'Create a question about historical development or discovery.',
    'Design a question about exceptions or special cases.',
    'Ask about interdisciplinary connections.',
  ];
  
  // Use adaptive selection - explore more strategies when duplicates occur
  const strategyIndex = aiParams?.top_k ? 
    Math.floor(Math.random() * promptStrategies.length) : // High diversity when adaptive
    Math.floor(Math.random() * 5); // Standard strategies normally
  
  const diversityHint = promptStrategies[strategyIndex];
  
  // Add extra emphasis on uniqueness if adaptive params are used
  const uniquenessEmphasis = aiParams?.temperature && aiParams.temperature > 1.0 ?
    '\n\n🚨 CRITICAL: You are in high-diversity mode. Generate something RADICALLY different from all previous questions. Try a completely new angle, framing, or approach.' :
    '';
  
  const basePrompt = `Generate a UNIQUE and DIFFERENT ${difficulty} difficulty ${questionType} question.
${diversityHint}

${questionType === 'mcq' ? 'Provide 4 options (A, B, C, D) with one correct answer.' : ''}
${questionType === 'short-answer' ? 'Provide a question that can be answered in 2-3 sentences.' : ''}
${questionType === 'essay' ? 'Provide a question that requires a detailed essay response.' : ''}

IMPORTANT: Make this question substantially different from any existing questions shown in the context.${uniquenessEmphasis}

Format your response as JSON:
{
  "question": "...",
  ${questionType === 'mcq' ? '"options": ["A) ...", "B) ...", "C) ...", "D) ..."],' : ''}
  "answer": "...",
  "explanation": "..."
}`;

  const prompt = contextBuilderService.buildEnhancedPrompt(basePrompt, context, {
    difficulty,
    questionType,
    count: 1,
  });

  // Use adaptive parameters or defaults
  const temperature = aiParams?.temperature ?? 0.9;
  const top_p = aiParams?.top_p ?? 0.95;
  const top_k = aiParams?.top_k ?? 60;
  
  const response = await ollamaService.generate(prompt, {
    temperature,
    num_predict: 500,
    top_p,
    top_k,
  });

  // Parse AI response with robust error handling
  let parsed;
  try {
    // Try to extract JSON from response
    let jsonText = response.match(/\{[\s\S]*\}/)?.[0] || response;
    
    // Fix common AI JSON mistakes
    // 1. Fix unquoted single letters for answer (e.g., "answer": C -> "answer": "C")
    jsonText = jsonText.replace(/"answer":\s*([A-D])\s*,/g, '"answer": "$1",');
    jsonText = jsonText.replace(/"answer":\s*([A-D])\s*\}/g, '"answer": "$1"}');
    
    // 2. Fix trailing commas
    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1');
    
    // 3. Try parsing
    parsed = JSON.parse(jsonText);
    
    // Validate required fields
    if (!parsed.question || typeof parsed.question !== 'string') {
      throw new Error('Missing or invalid question field');
    }
  } catch (error) {
    console.error('JSON parsing failed:', error);
    console.log('Raw response:', response.substring(0, 200));
    
    // Try manual extraction as fallback
    try {
      const questionMatch = response.match(/"question":\s*"([^"]+)"/);
      const answerMatch = response.match(/"answer":\s*"?([^",}]+)"?/);
      const explanationMatch = response.match(/"explanation":\s*"([^"]+)"/);
      const optionsMatch = response.match(/"options":\s*\[(.*?)\]/s);
      
      parsed = {
        question: questionMatch?.[1] || response.substring(0, 200),
        answer: answerMatch?.[1]?.trim() || '',
        explanation: explanationMatch?.[1] || '',
      };
      
      if (optionsMatch && optionsMatch[1]) {
        const optionsText = optionsMatch[1];
        (parsed as any).options = optionsText
          .split(',')
          .map((opt: string) => opt.trim().replace(/^"|"$/g, ''))
          .filter((opt: string) => opt.length > 0);
      }
    } catch (fallbackError) {
      // Final fallback
      parsed = {
        question: response.substring(0, 200),
        answer: '',
        explanation: '',
      };
    }
  }

  // Validate parsed question
  if (!parsed.question || parsed.question.length < 10) {
    console.error('❌ [Queue] Invalid question generated (too short or missing)');
    return {
      question: null,
      prompt,
      skipped: true,
      reason: 'invalid_question',
    };
  }
  
  // Check for duplicate with adaptive threshold (passed via aiParams)
  console.log(`🔍 [Queue] Checking for duplicates: "${parsed.question.substring(0, 60)}..."`);
  const duplicateThreshold = aiParams?.threshold ?? 0.80;
  const duplicateCheck = await contextBuilderService.isDuplicate(
    parsed.question,
    topicId,
    duplicateThreshold
  );
  
  if (duplicateCheck.isDuplicate) {
    console.warn(`  [Queue] Duplicate detected (${(duplicateCheck.similarQuestion!.similarity * 100).toFixed(1)}% similar), returning null`);
    return {
      question: null,
      prompt,
      skipped: true,
      reason: 'duplicate',
    };
  }

  // Generate embedding
  console.log(`[Queue] Generating embedding...`);
  let embedding: string | null = null;
  try {
    const embeddingVector = await embeddingService.generateEmbedding(parsed.question);
    embedding = JSON.stringify(embeddingVector);
    console.log(`[Queue] Embedding generated (${embeddingVector.length}D)`);
  } catch (error) {
    console.error('❌ [Queue] Error generating embedding:', error);
  }

  // Save to database
  const question = await prisma.question.create({
    data: {
      topicId,
      teacherId: data.teacherId,
      questionText: parsed.question,
      questionType,
      difficulty,
      options: parsed.options ? JSON.stringify(parsed.options) : null,
      correctAnswer: parsed.answer,
      explanation: parsed.explanation,
      generatedBy: 'ai',
      aiModel: config.ai.ollama.model,
      aiPrompt: prompt,
      ...(embedding ? { embedding } : {}),
    },
  });

  // Store in Qdrant
  if (embedding) {
    console.log(`[Queue] Storing in Qdrant...`);
    try {
      const embeddingVector = JSON.parse(embedding);
      await qdrantService.upsertPoint(
        qdrantService.COLLECTIONS.QUESTIONS,
        question.id,
        embeddingVector,
        {
          topicId: question.topicId,
          questionText: question.questionText,
          difficulty: question.difficulty,
          questionType: question.questionType,
        }
      );
      console.log(`[Queue] Stored in Qdrant`);
    } catch (error) {
      console.error('[Queue] Error storing in Qdrant:', error);
    }
  }

  return {
    question,
    prompt,
  };
}

/**
 * Calculate adaptive similarity threshold based on progress
 * Starts strict, gets more relaxed as we need more questions
 */
function getAdaptiveThreshold(
  questionsGenerated: number,
  totalNeeded: number,
  consecutiveDuplicates: number
): number {
  const progress = questionsGenerated / totalNeeded;
  
  // Base threshold based on progress
  let threshold: number;
  if (progress < 0.3) {
    threshold = 0.85; // First 30% - very strict (only truly unique)
  } else if (progress < 0.6) {
    threshold = 0.80; // Middle 30% - balanced
  } else if (progress < 0.85) {
    threshold = 0.77; // Next 25% - relaxed
  } else {
    threshold = 0.73; // Final 15% - very relaxed (to complete batch)
  }
  
  // Further reduce threshold if stuck with consecutive duplicates
  if (consecutiveDuplicates >= 5) {
    threshold = Math.max(0.70, threshold - 0.05); // Lower by 5%, minimum 70%
  }
  if (consecutiveDuplicates >= 8) {
    threshold = Math.max(0.68, threshold - 0.07); // Lower by 7%, minimum 68%
  }
  
  return threshold;
}

async function generateBatchQuestions(data: AIGenerationJobData) {
  const { topicId, questionCount = 5, questionType = 'mcq', difficulty = 'medium' } = data;

  if (!topicId) {
    throw new Error('topicId is required for batch question generation');
  }

  console.log(`[Queue] Starting batch generation: ${questionCount} questions`);
  const questions = [];
  let attempts = 0;
  // Dynamic max attempts: scale with question count (min 2x, max 3x for large batches)
  const maxAttempts = questionCount <= 10 ? questionCount * 3 : questionCount * 2;
  let consecutiveDuplicates = 0;
  
  // Adaptive parameters
  let currentTemperature = 0.9;
  let currentTopP = 0.95;
  let currentTopK = 60;

  while (questions.length < questionCount && attempts < maxAttempts) {
    attempts++;
    
    // Calculate adaptive threshold based on progress
    const adaptiveThreshold = getAdaptiveThreshold(
      questions.length,
      questionCount,
      consecutiveDuplicates
    );
    
    // Adaptive retry logic: increase randomness after consecutive duplicates
    if (consecutiveDuplicates > 0) {
      // Gradually increase temperature (max 1.3)
      currentTemperature = Math.min(1.3, 0.9 + (consecutiveDuplicates * 0.05));
      // Increase top_p (max 0.98)
      currentTopP = Math.min(0.98, 0.95 + (consecutiveDuplicates * 0.005));
      // Increase top_k (max 100)
      currentTopK = Math.min(100, 60 + (consecutiveDuplicates * 5));
      
      console.log(`[Queue] Adaptive retry ${consecutiveDuplicates}: temp=${currentTemperature.toFixed(2)}, top_p=${currentTopP.toFixed(2)}, top_k=${currentTopK}, threshold=${(adaptiveThreshold * 100).toFixed(0)}%`);
    } else if (attempts % 5 === 0) {
      // Log threshold every 5 attempts
      console.log(`[Queue] Progress ${questions.length}/${questionCount} (${(questions.length / questionCount * 100).toFixed(0)}%) - threshold: ${(adaptiveThreshold * 100).toFixed(0)}%`);
    }
    
    try {
      const result = await generateSingleQuestion(
        {
          type: data.type,
          teacherId: data.teacherId,
          topicId,
          questionType,
          difficulty,
          ...(data.unitId ? { unitId: data.unitId } : {}),
          ...(data.syllabusId ? { syllabusId: data.syllabusId } : {}),
          ...(data.enhancementType ? { enhancementType: data.enhancementType } : {}),
          ...(data.requestId ? { requestId: data.requestId } : {}),
          ...(data.priority ? { priority: data.priority } : {}),
        },
        {
          temperature: currentTemperature,
          top_p: currentTopP,
          top_k: currentTopK,
          threshold: adaptiveThreshold,
        }
      );
      
      // Only add if not skipped (duplicate)
      if (result.question) {
        questions.push(result.question);
        // Reset parameters and counter on success
        consecutiveDuplicates = 0;
        currentTemperature = 0.9;
        currentTopP = 0.95;
        currentTopK = 60;
        console.log(`[Queue] Progress: ${questions.length}/${questionCount} unique questions generated`);
      } else if (result.skipped) {
        consecutiveDuplicates++;
        console.log(`[Queue] Skipped duplicate, regenerating... (${questions.length}/${questionCount})`);
        
        // Break if too many consecutive duplicates (AI stuck in loop)
        if (consecutiveDuplicates >= 10) {
          console.warn(`[Queue] Too many consecutive duplicates (${consecutiveDuplicates}), stopping early`);
          console.warn(`[Queue] Generated ${questions.length}/${questionCount} questions before hitting duplicate saturation`);
          break;
        }
      }
    } catch (error) {
      console.error(`[Queue] Failed to generate question (attempt ${attempts}):`, error);
    }
  }

  console.log(`[Queue] Batch complete: ${questions.length} unique questions from ${attempts} attempts`);
  return { questions, count: questions.length, attempts };
}

async function generateSummary(data: AIGenerationJobData) {
  const { unitId } = data;
  if (!unitId) throw new Error('Unit ID is required');

  const unit = await prisma.unit.findUnique({
    where: { id: unitId },
    include: {
      topics: true,
      syllabus: true,
    },
  });

  if (!unit) throw new Error('Unit not found');

  const prompt = `Summarize this educational unit for ${unit.syllabus.className} students:

Unit: ${unit.title}
${unit.description ? `Description: ${unit.description}` : ''}

Topics:
${unit.topics.map((t, i) => `${i + 1}. ${t.topicName}`).join('\n')}

Provide a clear, student-friendly summary in 2-3 paragraphs.`;

  const summary = await ollamaService.generate(prompt, {
    temperature: 0.7,
    num_predict: 400,
  });

  return { summary, prompt };
}

async function generateEnhancement(data: AIGenerationJobData) {
  const { syllabusId, enhancementType } = data;
  if (!syllabusId) throw new Error('Syllabus ID is required');

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

  if (!syllabus) throw new Error('Syllabus not found');

  let prompt = '';
  let updateField: 'objectives' | 'overview' = 'objectives';

  if (enhancementType === 'objectives') {
    updateField = 'objectives';
    prompt = `Generate learning objectives for ${syllabus.subjectName} - ${syllabus.className}:

Units:
${syllabus.units.map((u, i) => `${i + 1}. ${u.title}`).join('\n')}

Provide 5-7 clear, measurable learning objectives.`;
  } else if (enhancementType === 'overview') {
    updateField = 'overview';
    prompt = `Write a course overview for ${syllabus.subjectName} - ${syllabus.className}:

Units:
${syllabus.units.map((u, i) => `${i + 1}. ${u.title}`).join('\n')}

Provide 2-3 engaging paragraphs.`;
  }

  const content = await ollamaService.generate(prompt, {
    temperature: 0.7,
    num_predict: 500,
  });

  // Update syllabus
  await prisma.syllabus.update({
    where: { id: syllabusId },
    data: { [updateField]: content },
  });

  return { content, field: updateField, prompt };
}

/**
 * Generate complete syllabus with units and topics
 */
async function generateCompleteSyllabus(data: AIGenerationJobData) {
  const { teacherId, syllabusData } = data;
  
  if (!syllabusData) {
    throw new Error('Syllabus data is required');
  }

  const { subjectName, className, board, term, academicYear, description } = syllabusData;

  if (config.isDevelopment) {
    console.log('[Queue/DEV] ========== STARTING SYLLABUS GENERATION ==========');
    console.log('[Queue/DEV] Teacher ID:', teacherId);
    console.log('[Queue/DEV] Subject:', subjectName);
    console.log('[Queue/DEV] Class:', className);
    console.log('[Queue/DEV] Board:', board || 'CBSE');
    console.log('[Queue/DEV] Academic Year:', academicYear || 'Not specified');
    console.log('[Queue/DEV] Term:', term || 'Not specified');
    console.log('[Queue/DEV] Description:', description || 'None');
    console.log('[Queue/DEV] =======================================================');
  }
  console.log(`[Queue] Generating complete syllabus: ${subjectName} - ${className}`);

  // Step 1: Smart curriculum search with multi-layer caching
  console.log('\n' + '='.repeat(60));
  console.log('[Queue] STEP 1: SMART CURRICULUM SEARCH (Multi-Layer Cache)');
  console.log('='.repeat(60));
  console.log(`[Queue] Searching for: ${board || 'CBSE'} ${className} ${subjectName}`);
  console.log(`[Queue] Academic Year: ${academicYear || 'N/A'}, Term: ${term || 'N/A'}`);
  
  let curriculumContext = '';
  let searchResults: SearchResult[] = [];
  let cacheSource = 'none';
  
  try {
    // LAYER 1: Check Vector DB for semantic similarity (85% threshold)
    if (config.isDevelopment) {
      console.log('[Queue/DEV] 🔍 LAYER 1: Checking Vector DB for semantic similarity...');
      console.log('[Queue/DEV] Query params:', { subject: subjectName, className, board: board || 'CBSE', academicYear, term });
    }
    console.log('[Queue] Layer 1: Checking Vector DB for similar queries...');
    const vectorResults = await searchSimilarCurriculumQueries({
      subject: subjectName,
      className,
      board: board || 'CBSE',
      ...(academicYear ? { academicYear } : {}),
      ...(term ? { term } : {}),
    });

    if (vectorResults && vectorResults.length > 0) {
      if (config.isDevelopment) {
        console.log('[Queue/DEV] ✓✓✓ VECTOR DB HIT! Semantic similarity match found!');
        console.log('[Queue/DEV] Cached results count:', vectorResults.length);
        console.log('[Queue/DEV] Cache source: Vector DB (85%+ similarity)');
        console.log('[Queue/DEV] Skipping Tavily API call - SAVING COST! 💰');
      }
      console.log('[Queue] ✓✓✓ VECTOR DB HIT! Using cached results from similar query');
      searchResults = vectorResults;
      cacheSource = 'vector-db';
    } else {
      if (config.isDevelopment) {
        console.log('[Queue/DEV] ✗ Vector DB miss - no similar queries found');
        console.log('[Queue/DEV] 🔍 LAYER 2 & 3: Checking WebSearchCache → Tavily API...');
      }
      // LAYER 2 & 3: WebSearchCache → Tavily (handled by searchCurriculum)
      console.log('[Queue] Layer 2: Checking WebSearchCache and Tavily...');
      searchResults = await searchCurriculum({
        subject: subjectName,
        className,
        board: board || 'CBSE',
        ...(academicYear ? { academicYear } : {}),
        ...(term ? { term } : {}),
      });

      if (searchResults.length > 0) {
        cacheSource = 'tavily-fresh';
        // Store in Vector DB for future semantic matches
        if (config.isDevelopment) {
          console.log('[Queue/DEV] 💾 Storing new results in Vector DB for future semantic matches...');
          console.log('[Queue/DEV] Results to store:', searchResults.length);
        }
        console.log('[Queue] Storing new results in Vector DB for future use...');
        await storeCurriculumSearch(
          {
            subject: subjectName,
            className,
            board: board || 'CBSE',
            ...(academicYear ? { academicYear } : {}),
            ...(term ? { term } : {}),
          },
          searchResults
        );
        if (config.isDevelopment) {
          console.log('[Queue/DEV] ✓ Successfully stored in Vector DB - future similar queries will hit cache');
        }
        console.log('[Queue] ✓ Stored in Vector DB');
      }
    }

    console.log(`[Queue] Search completed with ${searchResults.length} results (source: ${cacheSource})`);

    if (searchResults.length > 0) {
      console.log('[Queue] Sample results:');
      searchResults.slice(0, 3).forEach((r: any, i: number) => {
        console.log(`[Queue]   ${i + 1}. ${r.title}`);
        console.log(`[Queue]      URL: ${r.url}`);
      });
      
      curriculumContext = extractContextFromResults(searchResults);
      if (config.isDevelopment) {
        console.log('[Queue/DEV] 📝 Extracted web context length:', curriculumContext.length, 'chars');
        console.log('[Queue/DEV] Context preview:', curriculumContext.substring(0, 300) + '...');
        console.log('[Queue/DEV] Cache source for this generation:', cacheSource);
      }
      console.log(`[Queue] ✓ Extracted context (${curriculumContext.length} chars)`);
    } else {
      console.log(`[Queue] ✗ No web results found, using AI knowledge only`);
    }
  } catch (error) {
    console.error(`[Queue] ✗ Web search failed:`, error);
    console.warn(`[Queue] Continuing with AI-only generation`);
  }

  // Step 2: Build AI prompt with web search context
  console.log('\n' + '='.repeat(60));
  console.log('[Queue] STEP 2: AI GENERATION');
  console.log('='.repeat(60));
  console.log(`[Queue] Building prompt ${curriculumContext ? 'WITH' : 'WITHOUT'} web context`);
  if (curriculumContext) {
    console.log(`[Queue] Context preview: ${curriculumContext.substring(0, 200)}...`);
  }
  
  const prompt = `${curriculumContext ? curriculumContext + '\n\n' : ''}Generate a comprehensive ${board || ''} curriculum syllabus for:

Subject: ${subjectName}
Class: ${className}
${board ? `Board: ${board}` : ''}
${term ? `Term: ${term}` : ''}
${academicYear ? `Academic Year: ${academicYear}` : ''}
${description ? `\nFocus Areas: ${description}` : ''}

REQUIREMENTS:
1. **Learning Objectives** (REQUIRED): Write 5-7 clear, measurable SMART goals
   - Each objective must start with "Students will..."
   - Must be specific, measurable, and grade-appropriate
   - Format as numbered list: "1. Students will... 2. Students will..."

2. **Course Overview** (REQUIRED): Write 2-3 engaging paragraphs (minimum 150 words)
   - First paragraph: Introduce the subject and its importance
   - Second paragraph: Describe what students will learn and explore
   - Third paragraph: Explain real-world applications and skills gained
   - Must be well-written, engaging, and curriculum-aligned

3. **Prerequisites** (REQUIRED): List 3-5 prerequisite knowledge areas or skills
   - What students should know before starting this course
   - Format as numbered list: "1. Basic understanding of... 2. Familiarity with..."
   - Be specific and grade-appropriate

4. **Assessment Methods** (REQUIRED): Describe 4-6 assessment strategies
   - Include formative and summative assessments
   - Examples: quizzes, projects, lab reports, presentations, exams
   - Format as numbered list: "1. Weekly quizzes (10%)... 2. Unit tests (30%)..."

5. **Resources** (REQUIRED): List 5-8 recommended learning resources
   - Include textbooks, online resources, lab equipment, software
   - Format as numbered list: "1. NCERT ${subjectName} Textbook... 2. Khan Academy videos..."
   - Be specific with titles and types

6. **Additional Custom Fields** (OPTIONAL): Add any extra information as key-value pairs
   - You can add fields like: specialFocus, careerPaths, labRequirements, fieldTrips, etc.
   - Format as JSON object: {"specialFocus": "Hands-on experiments", "careerPaths": "Engineering, Medicine", "labRequirements": "Chemistry lab with safety equipment"}
   - Be creative and add relevant information that enhances the syllabus

7. **Units** (REQUIRED): Create 4-6 thematic units, each containing:
   - **Title** (REQUIRED): Clear, descriptive unit name (e.g., "Unit 1: Introduction to Cell Biology")
   - **Description** (REQUIRED): 2-3 detailed sentences explaining the unit (minimum 40 words)
   - **teachingHours** (REQUIRED): Number of teaching hours for this unit (2-8 hours, must be realistic)
   - **durationDays** (REQUIRED): Number of days to complete this unit (5-15 days, must be realistic)
   - **Topics** (REQUIRED): 3-5 specific topics per unit, each with:
     * **topicName** (REQUIRED): Specific topic name (e.g., "Cell Structure and Organelles")
     * **description** (REQUIRED): Detailed 2-3 sentence explanation of the topic (minimum 30 words)
     * **keywords** (REQUIRED): Comma-separated relevant terms (e.g., "nucleus, mitochondria, cell membrane, organelles")

CRITICAL RULES:
- ALL fields are MANDATORY - do not leave any field empty or null
- Use proper grammar, spelling, and punctuation
- Ensure curriculum alignment with ${board || 'standard'} ${className} level
- Make content age-appropriate and educationally sound
- Generate unique, non-generic content based on official sources provided above

Format your response as valid JSON:
{
  "objectives": "1. Students will understand the fundamental concepts of ${subjectName} and their real-world applications. 2. Students will be able to analyze and explain key principles and theories. 3. Students will develop critical thinking skills through problem-solving activities. 4. Students will demonstrate proficiency in laboratory techniques and experimental design. 5. Students will apply ${subjectName} knowledge to solve complex, real-world problems. 6. Students will communicate scientific concepts effectively through written and oral presentations.",
  "overview": "This comprehensive ${subjectName} course for ${className} students provides an in-depth exploration of fundamental principles and advanced concepts aligned with ${board || 'standard curriculum'} guidelines. Students will engage with theoretical foundations while developing practical skills through hands-on laboratory work and real-world problem-solving activities. The course is structured to build progressively from basic concepts to complex applications, ensuring students develop a thorough understanding of ${subjectName} and its relevance to everyday life. Through interactive lessons, collaborative projects, and rigorous assessments, students will cultivate critical thinking abilities, scientific reasoning, and analytical skills essential for academic success and future careers in science and technology fields.",
  "prerequisites": "1. Basic understanding of mathematics including algebra and geometry. 2. Familiarity with scientific notation and measurement units. 3. Completion of ${className === 'Class 10' ? 'Class 9' : 'previous grade'} ${subjectName} or equivalent coursework. 4. Ability to read and interpret graphs, charts, and data tables. 5. Basic computer literacy for research and presentations.",
  "assessmentMethods": "1. Weekly quizzes (10%) - Short assessments covering recent topics. 2. Unit tests (30%) - Comprehensive exams after each unit. 3. Laboratory work (20%) - Hands-on experiments with detailed lab reports. 4. Projects and presentations (20%) - Individual and group research projects. 5. Mid-term examination (10%) - Cumulative assessment of first-half content. 6. Final examination (10%) - Comprehensive end-of-year assessment covering all units.",
  "resources": "1. NCERT ${subjectName} Textbook for ${className} - Primary course material. 2. Reference books: [relevant author names and titles for ${subjectName}]. 3. Online resources: Khan Academy, BYJU'S, and Vedantu video lessons. 4. Laboratory equipment and materials for hands-on experiments. 5. Educational software and simulations for ${subjectName} concepts. 6. Supplementary worksheets and practice problem sets. 7. Digital resources: Interactive applets and virtual labs. 8. Library access for research projects and extended reading.",
  "otherFields": {
    "specialFocus": "Practical applications and real-world problem solving",
    "careerPaths": "Engineering, Medicine, Research, Technology",
    "labRequirements": "Well-equipped laboratory with safety measures",
    "fieldTrips": "Science museum, research center visits"
  },
  "units": [
    {
      "title": "Unit 1: Introduction to Fundamental Concepts",
      "description": "This foundational unit introduces students to the core principles and basic terminology of ${subjectName}. Students will explore the historical development of key theories and understand how these concepts form the basis for advanced study. Through engaging activities and demonstrations, learners will develop a strong conceptual framework necessary for success in subsequent units.",
      "teachingHours": 6,
      "durationDays": 10,
      "topics": [
        {
          "topicName": "Basic Principles and Definitions",
          "description": "Students will learn the fundamental concepts and terminology used in ${subjectName}, building a strong foundation for advanced topics. This topic covers essential definitions, basic principles, and introduces the scientific vocabulary necessary for understanding complex theories. Through interactive lessons and visual aids, students will develop clarity in using subject-specific terminology accurately.",
          "keywords": "fundamental concepts, terminology, definitions, basic principles, foundational theory"
        },
        {
          "topicName": "Historical Development and Key Discoveries",
          "description": "This topic explores the evolution of ${subjectName} through major discoveries and contributions by pioneering scientists. Students will understand how scientific knowledge builds over time and appreciate the historical context of modern theories. The topic includes case studies of breakthrough experiments and their impact on current understanding.",
          "keywords": "history, scientists, discoveries, evolution of knowledge, milestones"
        },
        {
          "topicName": "Scientific Method and Inquiry",
          "keywords": "scientific method, hypothesis, experimentation, observation, data analysis"
        }
      ]
    }
  ]
}

IMPORTANT: Generate realistic, detailed, curriculum-aligned content. Ensure ALL fields are properly filled with substantive content. Do not use placeholder text or generic responses.`;

  // Use advanced token calculator to determine optimal token count
  const recommendedTokens = TokenCalculator.recommendedTokensForSyllabus(
    subjectName,
    className
  );
  const tokenLimit = Math.max(5000, recommendedTokens); // Minimum 5000 (prevents truncation)
  
  if (config.isDevelopment) {
    console.log('[Queue/DEV] - Preparing AI prompt...');
    console.log('[Queue/DEV] - Prompt length:', prompt.length, 'characters');
    console.log('[Queue/DEV] - AI Generation Parameters:');
    console.log('[Queue/DEV] - Model:', config.ai.ollama.model, '(qwen2.5:14b recommended)');
    console.log('[Queue/DEV] - Temperature: 0.7');
    console.log('[Queue/DEV] - Recommended tokens:', recommendedTokens);
    console.log('[Queue/DEV] - Token limit (used):', tokenLimit);
    console.log('[Queue/DEV] - Timeout: 5 minutes');
    console.log('[Queue/DEV] - Calling Ollama AI service...');
    console.log('[Queue/DEV] - This may take 2-4 minutes for comprehensive syllabus with all fields...');
    console.log('[Queue/DEV] - Large token generation - model must complete ALL units with descriptions, teachingHours, durationDays, topics with descriptions and keywords');
  }
  console.log(`[Queue] Prompt length: ${prompt.length} characters`);
  console.log(`[Queue] Token limit: ${tokenLimit} (calculated for subject complexity)`);
  console.log(`[Queue] Calling Ollama AI (${config.ai.ollama.model})...`);
  console.log('[Queue] Please wait - generating comprehensive syllabus (may take 2-4 minutes)...');
  console.log('[Queue] Generating: 4-6 units  3-5 topics each = ~20 topics with full details');
  
  // Call Ollama with dynamically calculated token limit
  const startTime = Date.now();
  
  // Log progress every 15 seconds
  const progressInterval = config.isDevelopment ? setInterval(() => {
    const elapsed = Math.floor((Date.now() - startTime) / 1000);
    console.log(`[Queue/DEV] ⏳ Still generating... (${elapsed}s elapsed)`);
  }, 15000) : null;
  
  const response = await ollamaService.generate(prompt, {
    temperature: 0.7, // Balanced creativity
    num_predict: tokenLimit, // Dynamic token allocation based on subject complexity
    top_p: 0.9,
  });
  
  if (progressInterval) clearInterval(progressInterval);
  const aiDuration = Date.now() - startTime;

  if (config.isDevelopment) {
    console.log('[Queue/DEV] AI response received!');
    console.log('[Queue/DEV] Duration:', aiDuration + 'ms', '(' + (aiDuration/1000).toFixed(1) + 's)');
    console.log('[Queue/DEV] Response length:', response.length, 'characters');
    console.log('[Queue/DEV] Response preview (first 400 chars):', response.substring(0, 400));
    console.log('[Queue/DEV] Response end (last 200 chars):', response.substring(Math.max(0, response.length - 200)));
    console.log('[Queue/DEV] Parsing JSON response...');
    
    // Check if response looks truncated
    const endsWithClosingBrace = response.trim().endsWith('}') || response.trim().endsWith(']');
    if (!endsWithClosingBrace) {
      console.warn('[Queue/DEV] ⚠️ WARNING: Response may be truncated (no closing brace)!');
      console.warn('[Queue/DEV] This usually means num_predict too low - increase beyond 8000');
    }
  }
  console.log(`[Queue] ✓ AI response received in ${aiDuration}ms (${(aiDuration/1000).toFixed(1)}s)`);
  console.log(`[Queue] Response length: ${response.length} characters`);
  console.log(`[Queue] Response preview: ${response.substring(0, 150)}...`);
  console.log(`[Queue] Parsing JSON response...`);

  // Parse AI response with robust error handling
  let parsed: any;
  try {
    // Extract JSON from response
    let jsonText = response.match(/\{[\s\S]*\}/)?.[0] || response;
    
    // Fix common JSON mistakes
    jsonText = jsonText.replace(/,(\s*[}\]])/g, '$1'); // Trailing commas
    jsonText = jsonText.replace(/([{,]\s*)(\w+):/g, '$1"$2":'); // Unquoted keys
    
    parsed = JSON.parse(jsonText);
    
    if (config.isDevelopment) {
      console.log('[Queue/DEV] ✓ JSON parsed successfully!');
      console.log('[Queue/DEV] Syllabus structure:');
      console.log('[Queue/DEV] - Units count:', parsed.units?.length || 0);
      console.log('[Queue/DEV] - Objectives:', parsed.objectives ? '✓ (' + (typeof parsed.objectives === 'string' ? parsed.objectives.substring(0, 50) : 'object') + ')' : '✗ MISSING');
      console.log('[Queue/DEV] - Overview:', parsed.overview ? '✓ (' + (typeof parsed.overview === 'string' ? parsed.overview.substring(0, 50) : 'object') + ')' : '✗ MISSING');
      console.log('[Queue/DEV] - Prerequisites:', parsed.prerequisites ? '✓ (' + (typeof parsed.prerequisites === 'string' ? parsed.prerequisites.substring(0, 50) : 'object') + ')' : '✗ MISSING');
      console.log('[Queue/DEV] - Assessment Methods:', parsed.assessmentMethods ? '✓ (' + (typeof parsed.assessmentMethods === 'string' ? parsed.assessmentMethods.substring(0, 50) : 'object') + ')' : '✗ MISSING');
      console.log('[Queue/DEV] - Resources:', parsed.resources ? '✓ (' + (typeof parsed.resources === 'string' ? parsed.resources.substring(0, 50) : 'object') + ')' : '✗ MISSING');
      
      // Detailed unit analysis
      if (parsed.units && Array.isArray(parsed.units)) {
        parsed.units.forEach((unit: any, idx: number) => {
          console.log(`[Queue/DEV]   Unit ${idx + 1}: ${unit.title || 'NO TITLE'}`);
          console.log(`[Queue/DEV]     - description: ${unit.description ? '✓' : '✗ MISSING'}`);
          console.log(`[Queue/DEV]     - teachingHours: ${unit.teachingHours || '✗ MISSING'}`);
          console.log(`[Queue/DEV]     - durationDays: ${unit.durationDays || '✗ MISSING'}`);
          console.log(`[Queue/DEV]     - topics: ${unit.topics?.length || 0} topics`);
          
          if (unit.topics && Array.isArray(unit.topics)) {
            unit.topics.forEach((topic: any, tidx: number) => {
              const hasDesc = topic.description && topic.description.length > 0;
              const hasKeywords = topic.keywords && topic.keywords.length > 0;
              console.log(`[Queue/DEV]       Topic ${tidx + 1}: ${topic.topicName || 'NO NAME'} - desc:${hasDesc ? '✓' : '✗'} keywords:${hasKeywords ? '✓' : '✗'}`);
            });
          }
        });
      }
    }
    
    // Validate required fields
    if (!parsed.objectives || !parsed.overview || !parsed.prerequisites || 
        !parsed.assessmentMethods || !parsed.resources || 
        !parsed.units || !Array.isArray(parsed.units)) {
      const missing = [];
      if (!parsed.objectives) missing.push('objectives');
      if (!parsed.overview) missing.push('overview');
      if (!parsed.prerequisites) missing.push('prerequisites');
      if (!parsed.assessmentMethods) missing.push('assessmentMethods');
      if (!parsed.resources) missing.push('resources');
      if (!parsed.units || !Array.isArray(parsed.units)) missing.push('units');
      
      console.error('[Queue]  Missing required fields:', missing.join(', '));
      if (config.isDevelopment) {
        console.error('[Queue/DEV] Parsed object keys:', Object.keys(parsed));
      }
      throw new Error(`Missing required fields in AI response: ${missing.join(', ')}`);
    }
  } catch (error) {
    console.error('[Queue] JSON parsing failed:', error);
    console.log('[Queue] Raw response:', response.substring(0, 500));
    
    // Manual extraction fallback
    try {
      const objectivesMatch = response.match(/"objectives":\s*"([^"]+)"/);
      const overviewMatch = response.match(/"overview":\s*"([^"]+)"/);
      const unitsMatch = response.match(/"units":\s*\[([\s\S]*?)\]/);
      
      parsed = {
        objectives: objectivesMatch?.[1] || 'Generated objectives',
        overview: overviewMatch?.[1] || 'Generated overview',
        units: []
      };
      
      // Try to extract units manually
      if (unitsMatch && unitsMatch[1]) {
        const unitsText = unitsMatch[1];
        const unitMatches = unitsText.matchAll(/\{[^}]*"title":\s*"([^"]+)"[^}]*"description":\s*"([^"]+)"[^}]*\}/g);
        for (const match of unitMatches) {
          parsed.units.push({
            title: match[1],
            description: match[2],
            topics: []
          });
        }
      }
      
      // Ensure minimum units
      if (parsed.units.length === 0) {
        parsed.units = [
          {
            title: 'Unit 1: Introduction',
            description: 'Introduction to the subject',
            topics: [{ topicName: 'Overview', keywords: 'basics' }]
          }
        ];
      }
    } catch (fallbackError) {
      console.error('[Queue] Manual extraction failed:', fallbackError);
      throw new Error('Failed to parse AI syllabus response');
    }
  }

  // Validate structure
  if (parsed.units.length < 3) {
    console.warn('[Queue] Less than 3 units generated, adding placeholder units');
    while (parsed.units.length < 3) {
      parsed.units.push({
        title: `Unit ${parsed.units.length + 1}`,
        description: 'Additional unit content',
        topics: [{ topicName: 'Topic', keywords: '' }]
      });
    }
  }

  // Ensure each unit has topics, teachingHours, and durationDays
  parsed.units = parsed.units.map((unit: any, index: number) => {
    // Ensure topics exist
    if (!unit.topics || !Array.isArray(unit.topics) || unit.topics.length === 0) {
      unit.topics = [
        { topicName: 'Topic 1', keywords: '' },
        { topicName: 'Topic 2', keywords: '' }
      ];
    }
    
    // Ensure teachingHours exists (default: 6 hours)
    if (!unit.teachingHours || unit.teachingHours === null || unit.teachingHours === 'null') {
      unit.teachingHours = 6;
      if (config.isDevelopment) {
        console.log(`[Queue/DEV] ⚠️ Unit ${index + 1} missing teachingHours, using default: 6`);
      }
    }
    
    // Ensure durationDays exists (default: 10 days)
    if (!unit.durationDays || unit.durationDays === null || unit.durationDays === 'null') {
      unit.durationDays = 10;
      if (config.isDevelopment) {
        console.log(`[Queue/DEV] ⚠️ Unit ${index + 1} missing durationDays, using default: 10`);
      }
    }
    
    return unit;
  });

  if (config.isDevelopment) {
    console.log('[Queue/DEV] Preparing to save to database...');
    console.log('[Queue/DEV] Units to save:', parsed.units.length);
    const totalTopics = parsed.units.reduce((sum: number, u: any) => sum + (u.topics?.length || 0), 0);
    console.log('[Queue/DEV] Total topics:', totalTopics);
  }
  console.log(`[Queue] Parsed ${parsed.units.length} units, saving to database...`);

  // Normalize objectives, overview, prerequisites, assessmentMethods, and resources to strings
  const objectivesStr = Array.isArray(parsed.objectives) 
    ? parsed.objectives.map((obj: any) => typeof obj === 'object' ? JSON.stringify(obj) : String(obj)).join('\n') 
    : parsed.objectives || '';
  const overviewStr = Array.isArray(parsed.overview)
    ? parsed.overview.map((obj: any) => typeof obj === 'object' ? JSON.stringify(obj) : String(obj)).join('\n\n')
    : parsed.overview || '';
  const prerequisitesStr = Array.isArray(parsed.prerequisites)
    ? parsed.prerequisites.map((obj: any) => typeof obj === 'object' ? JSON.stringify(obj) : String(obj)).join('\n')
    : parsed.prerequisites || '';
  
  // Handle assessmentMethods - extract text from objects if present
  const assessmentMethodsStr = Array.isArray(parsed.assessmentMethods)
    ? parsed.assessmentMethods.map((item: any) => {
        if (typeof item === 'object' && item !== null) {
          // Extract meaningful text from object (name, description, method, type, etc.)
          return Object.entries(item)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
        }
        return String(item);
      }).join('\n')
    : parsed.assessmentMethods || '';
  
  // Handle resources - extract text from objects if present
  const resourcesStr = Array.isArray(parsed.resources)
    ? parsed.resources.map((item: any) => {
        if (typeof item === 'object' && item !== null) {
          // Extract meaningful text from object (title, name, url, description, etc.)
          return Object.entries(item)
            .map(([key, value]) => `${key}: ${value}`)
            .join(', ');
        }
        return String(item);
      }).join('\n')
    : parsed.resources || '';

  // Check for existing syllabi with same parameters to determine version number
  const existingSyllabi = await prisma.syllabus.findMany({
    where: {
      teacherId,
      subjectName,
      className,
      board: board || 'GENERAL',
      term: term || 'Annual',
      academicYear: academicYear || new Date().getFullYear().toString(),
    },
    orderBy: {
      version: 'desc'
    },
    take: 1
  });

  let versionNumber = 1;
  let parentSyllabusId = null;
  
  if (existingSyllabi.length > 0 && existingSyllabi[0]) {
    const latestSyllabus = existingSyllabi[0];
    versionNumber = (latestSyllabus.version || 0) + 1;
    parentSyllabusId = latestSyllabus.parentId || latestSyllabus.id; // Chain to original
    
    if (config.isDevelopment) {
      console.log('[Queue/DEV] - Previous versions found!');
      console.log('[Queue/DEV] - Latest version:', latestSyllabus.version || 0);
      console.log('[Queue/DEV] - New version will be:', versionNumber);
      console.log('[Queue/DEV] - Marking previous versions as not latest...');
    }
    console.log(`[Queue] Creating version ${versionNumber} of syllabus (preserving all previous versions)`);
    
    // Mark all previous versions as not latest
    await prisma.syllabus.updateMany({
      where: {
        teacherId,
        subjectName,
        className,
        board: board || 'GENERAL',
        term: term || 'Annual',
        academicYear: academicYear || new Date().getFullYear().toString(),
      },
      data: {
        isLatest: false
      }
    });
    
    if (config.isDevelopment) {
      console.log('[Queue/DEV]  Previous versions preserved and marked as historical');
    }
  } else {
    if (config.isDevelopment) {
      console.log('[Queue/DEV]  First version - no previous syllabi found');
    }
    console.log('[Queue] Creating first version of syllabus');
  }

  // Save to database with nested create
  const syllabus = await prisma.syllabus.create({
    include: {
      units: {
        include: {
          topics: true
        }
      }
    },
    data: {
      teacherId,
      subjectName,
      className,
      board: board || 'GENERAL',
      term: term || 'Annual',
      academicYear: academicYear || new Date().getFullYear().toString(),
      objectives: objectivesStr,
      overview: overviewStr,
      prerequisites: prerequisitesStr,
      assessmentMethods: assessmentMethodsStr,
      resources: resourcesStr,
      ...(parsed.otherFields && typeof parsed.otherFields === 'object' ? { otherFields: parsed.otherFields } : {}),
      published: false, // Save as draft
      generatedBy: 'ai',
      aiPrompt: prompt,
      stage: 'draft',
      version: versionNumber,
      isLatest: true,
      ...(parentSyllabusId ? { parentId: parentSyllabusId } : {}),
      units: {
        create: parsed.units.map((unit: any, unitIndex: number) => {
          // Normalize description to string if array
          const descriptionStr = unit.description
            ? (Array.isArray(unit.description) ? unit.description.join(' ') : unit.description)
            : undefined;
          
          if (config.isDevelopment) {
            console.log('[Queue/DEV]   Creating unit:', unit.title);
            console.log('[Queue/DEV]     - teachingHours:', unit.teachingHours || '✗ MISSING');
            console.log('[Queue/DEV]     - durationDays:', unit.durationDays || '✗ MISSING');
            console.log('[Queue/DEV]     - description:', descriptionStr ? '✓ (' + descriptionStr.length + ' chars)' : '✗ MISSING');
            console.log('[Queue/DEV]     - topics:', unit.topics?.length || 0);
          }
          
          // Parse teachingHours and durationDays with fallback defaults
          const teachingHours = unit.teachingHours 
            ? (typeof unit.teachingHours === 'number' ? unit.teachingHours : parseInt(String(unit.teachingHours)))
            : 6; // Default: 6 hours per unit
          const durationDays = unit.durationDays
            ? (typeof unit.durationDays === 'number' ? unit.durationDays : parseInt(String(unit.durationDays)))
            : 10; // Default: 10 days per unit
          
          return {
            teacherId, // Add teacherId to Unit
            title: unit.title,
            teachingHours: isNaN(teachingHours) ? 6 : teachingHours,
            durationDays: isNaN(durationDays) ? 10 : durationDays,
            ...(descriptionStr ? { description: descriptionStr } : {}),
            generatedBy: 'ai',
            ...(unitIndex !== undefined ? { order: unitIndex + 1 } : {}),
            topics: {
              create: unit.topics.map((topic: any, topicIndex: number) => {
                // Normalize keywords to string if array
                const keywordsStr = topic.keywords 
                  ? (Array.isArray(topic.keywords) ? topic.keywords.join(', ') : topic.keywords)
                  : undefined;
                
                // Normalize description to string if array
                const topicDescriptionStr = topic.description
                  ? (Array.isArray(topic.description) ? topic.description.join(' ') : topic.description)
                  : undefined;
                
                if (config.isDevelopment) {
                  console.log('[Queue/DEV]       - Topic:', topic.topicName);
                  console.log('[Queue/DEV]         description:', topicDescriptionStr ? ' (' + topicDescriptionStr.length + ' chars)' : ' MISSING');
                  console.log('[Queue/DEV]         keywords:', keywordsStr ? 'OK' : ' MISSING');
                }
                
                return {
                  teacherId,
                  topicName: topic.topicName,
                  ...(topicDescriptionStr ? { description: topicDescriptionStr } : {}),
                  ...(keywordsStr ? { keywords: keywordsStr } : {}),
                  generatedBy: 'ai',
                  ...(topicIndex !== undefined ? { order: topicIndex + 1 } : {})
                };
              })
            }
          };
        })
      }
    }
  });

  // Calculate and log completeness score using advanced algorithm
  const completenessResult = CompletenessScorer.calculateScore(syllabus);
  CompletenessScorer.logScore(completenessResult);
  
  if (config.isDevelopment) {
    console.log('[Queue/DEV]  Syllabus saved to database!');
    console.log('[Queue/DEV] Syllabus ID:', syllabus.id);
    console.log('[Queue/DEV] Completeness Score:', completenessResult.score + '%');
    console.log('[Queue/DEV] Validating ALL fields populated:');
    syllabus.units.forEach((unit, idx) => {
      console.log('[Queue/DEV]   Unit', idx + 1, ':', unit.title);
      console.log('[Queue/DEV]     teachingHours:', unit.teachingHours || '✗ MISSING');
      console.log('[Queue/DEV]     durationDays:', unit.durationDays || '✗ MISSING');
      console.log('[Queue/DEV]     description:', unit.description ? ' (' + unit.description.length + ' chars)' : ' MISSING');
      unit.topics.forEach((topic, tidx) => {
        console.log('[Queue/DEV]       Topic', tidx + 1, ':', topic.topicName);
        console.log('[Queue/DEV]         description:', topic.description ? ' (' + topic.description.length + ' chars)' : ' MISSING');
        console.log('[Queue/DEV]         keywords:', topic.keywords ? 'OK' : ' MISSING');
      });
    });
    
    if (completenessResult.score < 80) {
      console.warn('[Queue/DEV] QUALITY ALERT: Syllabus below 80% completeness!');
      console.warn('[Queue/DEV] Missing fields:', completenessResult.missingFields.slice(0, 10));
      console.warn('[Queue/DEV] Consider: Increase token limit or use staged generation');
    }
  }
  console.log(`[Queue] Syllabus created successfully: ${syllabus.id}`);

  // Store web search results as topic resources
  if (searchResults.length > 0) {
    if (config.isDevelopment) {
      console.log('[Queue/DEV] Storing web search results as TopicResources...');
      console.log('[Queue/DEV] Search results to store:', searchResults.length);
    }
    console.log('[Queue] Storing web search results in database...');
    try {
      const allTopicIds = syllabus.units.flatMap(unit => unit.topics.map(topic => topic.id));
      await storeSearchResultsAsResources(searchResults, allTopicIds);
      console.log(`[Queue] Stored resources for ${allTopicIds.length} topics`);
    } catch (error) {
      console.error('[Queue] Failed to store resources:', error);
      // Continue anyway - this is not critical
    }
  }

  // Generate and store embeddings in Vector DB
  if (config.isDevelopment) {
    console.log('[Queue/DEV] Generating and storing embeddings in Vector DB...');
    console.log('[Queue/DEV] Step 1: Storing syllabus embedding (objectives + overview)...');
  }
  console.log('[Queue] Generating embeddings for Vector DB...');
  try {
    // 1. Store syllabus embedding
    await storeSyllabusEmbedding({
      id: syllabus.id,
      teacherId: syllabus.teacherId,
      subjectName: syllabus.subjectName,
      className: syllabus.className,
      board: syllabus.board,
      objectives: syllabus.objectives || '',
      overview: syllabus.overview || '',
      units: syllabus.units,
    });

    if (config.isDevelopment) {
      console.log('[Queue/DEV] Syllabus embedding stored');
      console.log('[Queue/DEV] Step 2: Storing topic embeddings...');
    }
    
    // 2. Store topic embeddings
    const allTopics = syllabus.units.flatMap(unit =>
      unit.topics.map(topic => ({
        id: topic.id,
        topicName: topic.topicName,
        description: topic.description,
        keywords: topic.keywords,
        unitId: unit.id,
        syllabusId: syllabus.id,
      }))
    );

    if (allTopics.length > 0) {
      await storeTopicEmbeddings(allTopics);
    }

    if (config.isDevelopment) {
      console.log('[Queue/DEV] All topic embeddings stored');
      console.log('[Queue/DEV] Total embeddings:', allTopics.length + 1, '(1 syllabus + ' + allTopics.length + ' topics)');
    }
    console.log('[Queue] All embeddings stored in Vector DB');
  } catch (error) {
    console.error('[Queue] Failed to store embeddings:', error);
    // Continue anyway - this is not critical
  }

  if (config.isDevelopment) {
    console.log('[Queue/DEV] Summary:');
    console.log('[Queue/DEV] - Syllabus ID:', syllabus.id);
    console.log('[Queue/DEV] - Cache source:', cacheSource);
    console.log('[Queue/DEV] - Units:', parsed.units.length);
    console.log('[Queue/DEV] - Topics:', parsed.units.reduce((sum: number, u: any) => sum + (u.topics?.length || 0), 0));
    console.log('[Queue/DEV] - Resources stored:', searchResults.length);
    const totalTopics = syllabus.units.reduce((sum, unit) => sum + unit.topics.length, 0);
    console.log('[Queue/DEV] - Embeddings stored:', totalTopics + 1, '(syllabus + topics)');
    console.log('[Queue/DEV] - AI generation time:', aiDuration + 'ms');
  }
  
  return {
    syllabus,
    prompt,
    unitsCount: parsed.units.length,
    topicsCount: parsed.units.reduce((sum: number, u: any) => sum + (u.topics?.length || 0), 0),
    webSearchResults: searchResults.length,
  };
}

// Queue helper functions
export async function addAIJob(
  data: AIGenerationJobData,
  priority?: number
): Promise<string | null> {
  if (!aiQueue) {
    throw new Error('Redis not configured - job queue unavailable');
  }

  const job = await aiQueue.add(JobTypes.AI_GENERATION, data, {
    priority: priority || 5,
  });

  // Persist initial job state to database
  if (job.id) {
    await persistJobToDatabase(job.id, data, 'waiting', 0);
  }

  return job.id || null;
}

export async function getJobStatus(jobId: string) {
  if (!aiQueue) return null;

  const job = await aiQueue.getJob(jobId);
  if (!job) return null;

  const state = await job.getState();
  const progress = job.progress;
  const notified = job.attemptsMade > 0;

  return {
    id: job.id,
    state,
    progress,
    attemptsMade: job.attemptsMade,
    notified,
    data: job.data,
    result: job.returnvalue,
    failedReason: job.failedReason,
  };
}

// Graceful shutdown
process.on('beforeExit', async () => {
  if (aiWorker) {
    await aiWorker.close();
  }
  if (aiQueue) {
    await aiQueue.close();
  }
});
