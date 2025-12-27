/**
 * Web Search Service using Tavily API
 * Provides curriculum search with caching and database storage
 */

import { tavily } from '@tavily/core';
import { config } from '../config';
import { prisma } from './prisma';
import crypto from 'crypto';

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  score?: number; // Relevance score from Tavily
  publishedDate?: string;
}

interface SearchOptions {
  maxResults?: number;
  searchDepth?: 'basic' | 'advanced';
  useCache?: boolean;
  cacheDays?: number;
}

interface CurriculumSearchParams {
  subject: string;
  className: string;
  board: string;
  academicYear?: string;
  term?: string;
}

/**
 * Initialize Tavily client
 */
function getTavilyClient() {
  if (!config.tavily?.apiKey) {
    throw new Error('Tavily API key not configured. Add TAVILY_API_KEY to .env');
  }
  return tavily({ apiKey: config.tavily.apiKey });
}

/**
 * Search the web using Tavily API
 */
export async function searchWeb(
  query: string,
  options: SearchOptions = {}
): Promise<SearchResult[]> {
  console.log('[Tavily] =========================');
  console.log('[Tavily] Starting new search');
  console.log('[Tavily] Query:', query);
  console.log('[Tavily] Options:', JSON.stringify(options, null, 2));

  const {
    maxResults = 5,
    searchDepth = 'advanced',
    useCache = true,
    cacheDays = 7,
  } = options;

  // Create query hash for caching
  const queryHash = crypto
    .createHash('md5')
    .update(`${query}-${maxResults}-${searchDepth}`)
    .digest('hex');

  // Check cache first
  if (useCache) {
    console.log('[Tavily] Checking cache with hash:', queryHash);
    const cached = await getCachedResults(queryHash);
    if (cached) {
      console.log(`[Tavily] ✓ Cache HIT! Returning ${cached.length} cached results`);
      return cached;
    }
    console.log('[Tavily] ✗ Cache MISS - fetching from Tavily API');
  }

  try {
    console.log('[Tavily] Calling Tavily API...');
    const tvly = getTavilyClient();
    
    const startTime = Date.now();
    const response = await tvly.search(query, {
      searchDepth,
      maxResults,
      includeAnswer: false,
      includeRawContent: false,
      includeImages: false,
    });
    const duration = Date.now() - startTime;

    console.log(`[Tavily] ✓ API response received in ${duration}ms`);
    console.log(`[Tavily] Found ${response.results.length} results`);

    // Transform Tavily results to our format
    const results: SearchResult[] = response.results.map((r: any) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
      score: r.score,
      publishedDate: r.publishedDate,
    }));

    if (results.length > 0) {
      console.log('[Tavily] Sample result:', JSON.stringify(results[0], null, 2));
    }

    // Cache results
    if (useCache && results.length > 0) {
      console.log(`[Tavily] Caching ${results.length} results for ${cacheDays} days...`);
      await cacheResults(queryHash, query, results, cacheDays);
      console.log('[Tavily] ✓ Results cached successfully');
    } else if (results.length === 0) {
      console.warn('[Tavily] ✗ No results to cache');
    }

    console.log('[Tavily] Returning', results.length, 'results');
    console.log('[Tavily] =========================');
    return results;
  } catch (error) {
    console.error('[Tavily] ✗ Search failed:', error);
    return [];
  }
}

/**
 * Search specifically for curriculum/syllabus documents
 * Uses multiple optimized queries for comprehensive results
 */
export async function searchCurriculum(params: CurriculumSearchParams): Promise<SearchResult[]> {
  const { subject, className, board, academicYear, term } = params;

  console.log('[Curriculum] ===================================');
  console.log('[Curriculum] Starting curriculum search');
  console.log('[Curriculum] Params:', JSON.stringify(params, null, 2));

  // Build optimized search queries for curriculum
  const queries = [
    // Official syllabus query
    `${board} ${className} ${subject} syllabus ${academicYear || ''} official PDF site:${getBoardWebsite(board)}`,
    // Curriculum guide query
    `${board} ${className} ${subject} curriculum guide ${term || ''} chapters topics`,
    // NCERT/Board resource query
    `${board} ${className} ${subject} textbook chapters lessons ${academicYear || ''}`,
  ].map(q => q.trim().replace(/\s+/g, ' '));

  console.log('[Curriculum] Generated', queries.length, 'search queries:');
  queries.forEach((q, i) => console.log(`[Curriculum]   ${i + 1}. "${q}"`));

  const allResults: SearchResult[] = [];
  const seenUrls = new Set<string>();

  // Search with multiple queries and deduplicate
  console.log('[Curriculum] Executing searches...');
  for (const query of queries) {
    try {
      console.log(`[Curriculum] Searching: "${query}"`);
      const results = await searchWeb(query, {
        maxResults: 5,
        searchDepth: 'advanced',
        useCache: true,
      });

      console.log(`[Curriculum] Got ${results.length} results for this query`);

      // Deduplicate by URL
      let newResults = 0;
      for (const result of results) {
        if (!seenUrls.has(result.url)) {
          seenUrls.add(result.url);
          allResults.push(result);
          newResults++;
        }
      }

      console.log(`[Curriculum] Added ${newResults} new unique results (total: ${allResults.length})`);

      // Break early if we have enough results
      if (allResults.length >= 15) {
        console.log('[Curriculum] Reached 15 results, stopping search');
        break;
      }
    } catch (error) {
      console.warn(`[Curriculum] ✗ Query failed: ${query}`, error);
      // Continue with next query
    }
  }

  // Sort by score (if available) and return top 10
  const sortedResults = allResults
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, 10);

  console.log(`[Curriculum] ✓ Returning ${sortedResults.length} top results`);
  if (sortedResults.length > 0) {
    console.log('[Curriculum] Top result:', sortedResults[0]?.title);
  }
  console.log('[Curriculum] ===================================');
  
  return sortedResults;
}

/**
 * Extract context from search results for AI prompt
 */
export function extractContextFromResults(results: SearchResult[]): string {
  console.log('[Tavily] Extracting context from', results.length, 'results');

  if (results.length === 0) {
    console.log('[Tavily] No results to extract context from');
    return '';
  }

  let context = '=== OFFICIAL CURRICULUM INFORMATION (from web search) ===\n\n';
  context += 'Based on the following official curriculum sources:\n\n';

  results.forEach((result, index) => {
    context += `${index + 1}. ${result.title}\n`;
    context += `   Source: ${result.url}\n`;
    if (result.score) {
      context += `   Relevance: ${(result.score * 100).toFixed(1)}%\n`;
    }
    if (result.snippet) {
      context += `   Content: ${result.snippet}\n`;
    }
    context += '\n';
  });

  context += '=== END OF CURRICULUM SOURCES ===\n';
  context += 'IMPORTANT: Use the above official curriculum information to ensure accuracy.\n';

  console.log('[Tavily] Context extracted, length:', context.length, 'characters');
  return context;
}

/**
 * Get board website domain for targeted search
 */
function getBoardWebsite(board: string): string {
  const domains: Record<string, string> = {
    'CBSE': 'cbse.gov.in OR cbseacademic.nic.in OR ncert.nic.in',
    'ICSE': 'cisce.org',
    'ISC': 'cisce.org',
    'IB': 'ibo.org',
    'State Board': 'education.gov.in',
  };
  return domains[board] || 'edu';
}

/**
 * Get cached search results from database
 */
async function getCachedResults(queryHash: string): Promise<SearchResult[] | null> {
  try {
    console.log('[Tavily] Looking up cache with hash:', queryHash);

    const cached = await prisma.webSearchCache.findUnique({
      where: { queryHash },
    });

    if (!cached) {
      console.log('[Tavily] No cache entry found');
      return null;
    }

    console.log('[Tavily] Found cache entry:', {
      id: cached.id,
      createdAt: cached.createdAt,
      expiresAt: cached.expiresAt,
      resultCount: cached.resultCount,
    });

    // Check if expired
    if (new Date() > cached.expiresAt) {
      console.log('[Tavily] Cache expired, deleting...');
      await prisma.webSearchCache.delete({
        where: { id: cached.id },
      });
      return null;
    }

    const results = JSON.parse(cached.results) as SearchResult[];
    console.log('[Tavily] Returning', results.length, 'cached results');
    return results;
  } catch (error) {
    console.error('[Tavily] Cache retrieval failed:', error);
    return null;
  }
}

/**
 * Cache search results in database
 */
async function cacheResults(
  queryHash: string,
  query: string,
  results: SearchResult[],
  cacheDays: number
): Promise<void> {
  try {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + cacheDays);

    console.log('[Tavily] Storing in cache:', {
      queryHash,
      resultCount: results.length,
      expiresAt,
      cacheDays,
    });

    const cached = await prisma.webSearchCache.upsert({
      where: { queryHash },
      create: {
        query,
        queryHash,
        results: JSON.stringify(results),
        source: 'tavily',
        resultCount: results.length,
        expiresAt,
      },
      update: {
        results: JSON.stringify(results),
        resultCount: results.length,
        expiresAt,
        source: 'tavily',
      },
    });

    console.log('[Tavily] Cache stored successfully:', cached.id);
  } catch (error) {
    console.error('[Tavily] Cache storage failed:', error);
    throw error;
  }
}

/**
 * Store search results as topic resources in database
 */
export async function storeSearchResultsAsResources(
  searchResults: SearchResult[],
  topicIds: string[]
): Promise<void> {
  if (searchResults.length === 0 || topicIds.length === 0) {
    console.log('[Tavily] No results or topics to store');
    return;
  }

  console.log(`[Tavily] Storing ${searchResults.length} results for ${topicIds.length} topics...`);

  try {
    // Store top 3 most relevant results for each topic
    const topResults = searchResults
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, 3);

    for (const topicId of topicIds) {
      await prisma.topicResource.createMany({
        data: topResults.map(result => ({
          topicId,
          title: result.title,
          url: result.url,
          snippet: result.snippet || null,
          source: 'tavily',
          relevance: result.score || null,
        })),
        skipDuplicates: true,
      });
    }

    console.log(`[Tavily] ✓ Stored ${topResults.length * topicIds.length} resource links`);
  } catch (error) {
    console.error('[Tavily] Failed to store resources:', error);
    throw error;
  }
}
