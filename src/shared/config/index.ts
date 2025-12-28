/**
 * Centralized configuration management
 * All environment variables and config values should be accessed through this module
 */

interface Config {
  // Server
  port: number;
  nodeEnv: string;
  isDevelopment: boolean;
  isProduction: boolean;

  // Database
  database: {
    url: string;
  };

  // AI Services
  ai: {
    provider: 'ollama' | 'openai';
    ollama: {
      baseUrl: string;
      model: string;
      timeout: number;
    };
    openai?: {
      apiKey?: string;
      model: string;
      maxTokens: number;
    };
  };

  // Caching (for future use)
  redis?: {
    url?: string;
    enabled: boolean;
  };

  // Vector Database
  qdrant?: {
    url: string;
  };

  // Web Search
  tavily?: {
    apiKey: string;
    enabled: boolean;
  };

  // API Configuration
  api: {
    rateLimit: {
      windowMs: number;
      maxRequests: number;
    };
  };
}

function validateConfig(): Config {
  const nodeEnv = process.env.NODE_ENV || 'development';

  return {
    port: parseInt(process.env.PORT || '3000', 10),
    nodeEnv,
    isDevelopment: nodeEnv === 'development',
    isProduction: nodeEnv === 'production',

    database: {
      url: process.env.DATABASE_URL || 'file:./dev.db',
    },

    ai: {
      provider: (process.env.AI_PROVIDER as 'ollama' | 'openai') || 'ollama',
      ollama: {
        baseUrl: process.env.OLLAMA_BASE_URL || 'http://localhost:11434',
        model: process.env.OLLAMA_MODEL || 'qwen2.5:14b', // Dynamically configurable via .env
        timeout: parseInt(process.env.OLLAMA_TIMEOUT || '300000', 10), // 5 minutes for syllabus generation
      },
      ...(process.env.OPENAI_API_KEY ? {
        openai: {
          apiKey: process.env.OPENAI_API_KEY,
          model: process.env.OPENAI_MODEL || 'gpt-4',
          maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS || '2000', 10),
        },
      } : {}),
    },

    ...(process.env.REDIS_URL ? {
      redis: {
        url: process.env.REDIS_URL,
        enabled: true,
      },
    } : {}),

    ...(process.env.QDRANT_URL ? {
      qdrant: {
        url: process.env.QDRANT_URL,
      },
    } : {}),

    ...(process.env.TAVILY_API_KEY ? {
      tavily: {
        apiKey: process.env.TAVILY_API_KEY,
        enabled: true,
      },
    } : {}),

    api: {
      rateLimit: {
        windowMs: 15 * 60 * 1000,
        maxRequests: parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
      },
    },
  };
}

export const config = validateConfig();

export function logConfig(): void {
  console.log('Configuration:', {
    nodeEnv: config.nodeEnv,
    port: config.port,
    database: { url: config.database.url.substring(0, 20) + '...' },
    ai: {
      provider: config.ai.provider,
      ollama: {
        baseUrl: config.ai.ollama.baseUrl,
        model: config.ai.ollama.model,
      },
      openai: {
        configured: !!config.ai.openai?.apiKey,
        model: config.ai.openai?.model,
      },
    },
    redis: { enabled: config.redis?.enabled },
  });
}
