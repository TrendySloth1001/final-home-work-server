/**
 * Advanced algorithmic optimizations for large-scale systems
 * Patterns used by GitHub, Google, AWS, etc.
 */

import { config } from '../config';

// ============================================================================
// 1. TOKEN BUCKET RATE LIMITER
// ============================================================================
export class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryConsume(tokens: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  private refill() {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getAvailableTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

// ============================================================================
// 2. CIRCUIT BREAKER (Fault Tolerance)
// ============================================================================
export class CircuitBreaker {
  private failures = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

  constructor(
    private threshold: number = 5,
    private timeout: number = 60000, // 1 minute
    private successThreshold: number = 2 // successes needed to close
  ) {}

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'OPEN') {
      if (Date.now() - this.lastFailureTime > this.timeout) {
        console.log('[CircuitBreaker] Transitioning to HALF_OPEN state');
        this.state = 'HALF_OPEN';
        this.successCount = 0;
      } else {
        throw new Error('Circuit breaker is OPEN - service unavailable');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;

    if (this.state === 'HALF_OPEN') {
      this.successCount++;
      if (this.successCount >= this.successThreshold) {
        console.log('[CircuitBreaker] Closing circuit after successful recovery');
        this.state = 'CLOSED';
      }
    }
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= this.threshold) {
      console.warn(`[CircuitBreaker] OPENING circuit after ${this.failures} failures`);
      this.state = 'OPEN';
    }
  }

  getState() {
    return this.state;
  }
}

// ============================================================================
// 3. ADAPTIVE TOKEN CALCULATOR (Dynamic Programming)
// ============================================================================
export class TokenCalculator {
  // Realistic token estimates based on actual output (adjusted from production data)
  private static readonly TOKENS_OBJECTIVES = 250; // 7 items × 35 tokens (more verbose)
  private static readonly TOKENS_OVERVIEW = 400; // 200-250 words (engaging content)
  private static readonly TOKENS_PREREQUISITES = 180; // 5 items × 35 tokens
  private static readonly TOKENS_ASSESSMENT = 240; // 6 items × 40 tokens (with percentages)
  private static readonly TOKENS_RESOURCES = 300; // 8 items × 35-40 tokens (specific resources)
  private static readonly TOKENS_STRUCTURE = 150; // JSON structure overhead + formatting
  
  private static readonly TOKENS_PER_UNIT = 120; // title + detailed description (40+ words)
  private static readonly TOKENS_PER_TOPIC = 150; // name + detailed description (30+ words) + keywords
  private static readonly SAFETY_MARGIN = 1.15; // 15% buffer for variance

  static estimateTokensNeeded(units: number, topicsPerUnit: number): number {
    // Fixed fields (objectives, overview, prerequisites, assessment, resources)
    const fixedFields = 
      this.TOKENS_OBJECTIVES +
      this.TOKENS_OVERVIEW +
      this.TOKENS_PREREQUISITES +
      this.TOKENS_ASSESSMENT +
      this.TOKENS_RESOURCES +
      this.TOKENS_STRUCTURE;
    
    // Variable fields (units and topics)
    const variableFields =
      units * this.TOKENS_PER_UNIT +
      units * topicsPerUnit * this.TOKENS_PER_TOPIC;
    
    const baseTokens = fixedFields + variableFields;
    return Math.ceil(baseTokens * this.SAFETY_MARGIN);
  }

  static recommendedTokensForSyllabus(
    subjectName: string,
    className: string
  ): number {
    // Heuristics based on complexity
    const isSTEM =
      subjectName.toLowerCase().includes('math') ||
      subjectName.toLowerCase().includes('physics') ||
      subjectName.toLowerCase().includes('chemistry') ||
      subjectName.toLowerCase().includes('biology');

    const isHigherClass = parseInt(className.replace(/\D/g, '')) >= 9;

    // Realistic unit/topic counts based on curriculum standards
    let units = 4;
    let topicsPerUnit = 4; // Average 4 topics per unit

    if (isSTEM) {
      units = 5; // STEM subjects have more units
      topicsPerUnit = 4; // Keep at 4 (20 total topics)
    }

    if (isHigherClass) {
      topicsPerUnit = 5; // Higher classes: 5 topics per unit
    }

    const estimated = this.estimateTokensNeeded(units, topicsPerUnit);

    if (config.isDevelopment) {
      console.log('[TokenCalculator/DEV] 🧮 Token Estimation:');
      console.log('[TokenCalculator/DEV] - Subject:', subjectName, isSTEM ? '(STEM)' : '(Non-STEM)');
      console.log('[TokenCalculator/DEV] - Class:', className, isHigherClass ? '(Higher)' : '(Lower)');
      console.log('[TokenCalculator/DEV] - Units:', units);
      console.log('[TokenCalculator/DEV] - Topics per unit:', topicsPerUnit);
      console.log('[TokenCalculator/DEV] - Total topics:', units * topicsPerUnit);
      console.log('[TokenCalculator/DEV] - Fixed fields: ~1,520 tokens (objectives, overview, prereqs, assessment, resources)');
      console.log('[TokenCalculator/DEV] - Units: ~', units * 120, 'tokens (detailed descriptions)');
      console.log('[TokenCalculator/DEV] - Topics: ~', units * topicsPerUnit * 150, 'tokens (name + description + keywords)');
      console.log('[TokenCalculator/DEV] - 📊 Estimated tokens needed:', estimated);
      console.log('[TokenCalculator/DEV] - 💰 Balanced approach: Quality output with reasonable token usage');
    }

    return estimated;
  }
}

// ============================================================================
// 4. COMPLETENESS SCORER (Quality Validation)
// ============================================================================
export class CompletenessScorer {
  static calculateScore(syllabus: any): {
    score: number;
    details: any;
    missingFields: string[];
  } {
    let score = 0;
    let maxScore = 0;
    const missingFields: string[] = [];
    const details: any = { units: [] };

    // Objectives (0-12 points)
    maxScore += 12;
    if (syllabus.objectives && syllabus.objectives.length > 100) {
      score += 12;
    } else if (syllabus.objectives) {
      score += 6;
      missingFields.push('objectives (too short)');
    } else {
      missingFields.push('objectives');
    }

    // Overview (0-12 points)
    maxScore += 12;
    if (syllabus.overview && syllabus.overview.length > 150) {
      score += 12;
    } else if (syllabus.overview) {
      score += 6;
      missingFields.push('overview (too short)');
    } else {
      missingFields.push('overview');
    }

    // Prerequisites (0-8 points)
    maxScore += 8;
    if (syllabus.prerequisites && syllabus.prerequisites.length > 50) {
      score += 8;
    } else if (syllabus.prerequisites) {
      score += 4;
      missingFields.push('prerequisites (too short)');
    } else {
      missingFields.push('prerequisites');
    }

    // Assessment Methods (0-8 points)
    maxScore += 8;
    if (syllabus.assessmentMethods && syllabus.assessmentMethods.length > 50) {
      score += 8;
    } else if (syllabus.assessmentMethods) {
      score += 4;
      missingFields.push('assessmentMethods (too short)');
    } else {
      missingFields.push('assessmentMethods');
    }

    // Resources (0-8 points)
    maxScore += 8;
    if (syllabus.resources && syllabus.resources.length > 50) {
      score += 8;
    } else if (syllabus.resources) {
      score += 4;
      missingFields.push('resources (too short)');
    } else {
      missingFields.push('resources');
    }

    // Units and Topics (0-52 points) - adjusted to make total 100
    syllabus.units?.forEach((unit: any, unitIdx: number) => {
      const unitDetails: any = {
        title: unit.title,
        score: 0,
        maxScore: 13, // 13 points per unit × 4 units = 52 points
        missing: [],
      };

      maxScore += 13;

      if (unit.title) {
        score += 2;
        unitDetails.score += 2;
      } else {
        unitDetails.missing.push('title');
      }

      if (unit.description && unit.description.length > 40) {
        score += 3;
        unitDetails.score += 3;
      } else {
        unitDetails.missing.push('description');
        missingFields.push(`units[${unitIdx}].description`);
      }

      if (unit.teachingHours) {
        score += 3;
        unitDetails.score += 3;
      } else {
        unitDetails.missing.push('teachingHours');
        missingFields.push(`units[${unitIdx}].teachingHours`);
      }

      if (unit.durationDays) {
        score += 3;
        unitDetails.score += 3;
      } else {
        unitDetails.missing.push('durationDays');
        missingFields.push(`units[${unitIdx}].durationDays`);
      }

      // Topics
      unitDetails.topics = [];
      unit.topics?.forEach((topic: any, topicIdx: number) => {
        const topicDetails: any = {
          name: topic.topicName,
          score: 0,
          maxScore: 4,
          missing: [],
        };

        maxScore += 4;

        if (topic.topicName) {
          score += 1;
          topicDetails.score += 1;
        } else {
          topicDetails.missing.push('topicName');
        }

        if (topic.description && topic.description.length > 30) {
          score += 1.5;
          topicDetails.score += 1.5;
        } else {
          topicDetails.missing.push('description');
          missingFields.push(`units[${unitIdx}].topics[${topicIdx}].description`);
        }

        if (topic.keywords) {
          score += 1.5;
          topicDetails.score += 1.5;
        } else {
          topicDetails.missing.push('keywords');
          missingFields.push(`units[${unitIdx}].topics[${topicIdx}].keywords`);
        }

        unitDetails.topics.push(topicDetails);
      });

      details.units.push(unitDetails);
    });

    const percentage = maxScore > 0 ? (score / maxScore) * 100 : 0;

    return {
      score: Math.round(percentage),
      details,
      missingFields,
    };
  }

  static logScore(result: ReturnType<typeof CompletenessScorer.calculateScore>) {
    console.log(`[CompletenessScorer] Overall Score: ${result.score}%`);

    if (result.score < 80) {
      console.warn('[CompletenessScorer] ⚠️ Syllabus incomplete!');
      console.warn('[CompletenessScorer] Missing fields:', result.missingFields.length);

      if (config.isDevelopment) {
        console.log('[CompletenessScorer/DEV] Detailed breakdown:');
        result.details.units.forEach((unit: any, idx: number) => {
          console.log(
            `[CompletenessScorer/DEV]   Unit ${idx + 1}: ${unit.score}/${unit.maxScore} (${Math.round((unit.score / unit.maxScore) * 100)}%)`
          );
          if (unit.missing.length > 0) {
            console.log('[CompletenessScorer/DEV]     Missing:', unit.missing.join(', '));
          }
        });
      }
    } else {
      console.log('[CompletenessScorer] ✓ Syllabus is well-formed');
    }
  }
}

// ============================================================================
// 5. EXPONENTIAL BACKOFF WITH JITTER
// ============================================================================
export class ExponentialBackoff {
  static calculateDelay(
    attempt: number,
    baseDelay: number = 1000,
    maxDelay: number = 32000
  ): number {
    // Exponential: 1s, 2s, 4s, 8s, 16s, 32s
    const exponentialDelay = Math.min(maxDelay, baseDelay * Math.pow(2, attempt - 1));

    // Add jitter (randomness) to prevent thundering herd
    const jitter = exponentialDelay * Math.random() * 0.3; // ±30% jitter

    return Math.floor(exponentialDelay + jitter);
  }

  static async retry<T>(
    fn: () => Promise<T>,
    maxAttempts: number = 3,
    baseDelay: number = 1000
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error as Error;

        if (attempt === maxAttempts) {
          break;
        }

        const delay = this.calculateDelay(attempt, baseDelay);
        console.log(
          `[ExponentialBackoff] Attempt ${attempt} failed, retrying in ${delay}ms...`
        );

        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError;
  }
}
