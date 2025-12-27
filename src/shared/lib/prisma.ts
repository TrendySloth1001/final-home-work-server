import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { config } from '../config';
import * as fs from 'fs';
import * as path from 'path';

// Create PostgreSQL connection pool
const pool = new Pool({
    connectionString: config.database.url,
});

// Create Prisma adapter
const adapter = new PrismaPg(pool);

// Singleton Prisma Client instance
const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

// Configure logging - only errors by default, queries disabled for cleaner console
export const prisma = globalForPrisma.prisma ?? new PrismaClient({ 
    adapter,
    log: [
        { emit: 'event', level: 'query' },
        { emit: 'stdout', level: 'error' },
        { emit: 'stdout', level: 'warn' },
    ],
});

// Optional: Write query logs to file instead of console (disabled by default)
const ENABLE_QUERY_LOGGING = process.env.PRISMA_QUERY_LOG === 'true';

if (ENABLE_QUERY_LOGGING && config.isDevelopment) {
    const logDir = path.join(process.cwd(), 'logs');
    const logFile = path.join(logDir, 'prisma-queries.log');
    
    // Create logs directory if it doesn't exist
    if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
    }

    (prisma.$on as any)('query', (e: any) => {
        const timestamp = new Date().toISOString();
        const logMessage = `[${timestamp}] Query: ${e.query}\nParams: ${e.params}\nDuration: ${e.duration}ms\n\n`;
        fs.appendFileSync(logFile, logMessage);
    });

    console.log(` Prisma query logging enabled. Logs written to: ${logFile}`);
}

if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.prisma = prisma;
}

// Graceful shutdown
process.on('beforeExit', async () => {
    await prisma.$disconnect();
});
