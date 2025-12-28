#!/bin/bash

# homeWork Server - Complete Setup & Start Script
# This script sets up and starts PostgreSQL, Redis, Qdrant (Vector DB), and the Node.js server

set -e  # Exit on any error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  homeWork Server Setup & Start${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Check Docker
echo -e "${YELLOW}[1/9]${NC} Checking Docker..."
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker is not installed${NC}"
    echo "Please install Docker Desktop from https://www.docker.com/products/docker-desktop"
    exit 1
fi

if ! docker ps &> /dev/null; then
    echo -e "${YELLOW}⏳ Starting Docker Desktop...${NC}"
    open -a Docker
    echo "Waiting for Docker to start (this may take 30 seconds)..."
    for i in {1..30}; do
        if docker ps &> /dev/null 2>&1; then
            echo -e "${GREEN}:: Docker is running${NC}"
            break
        fi
        sleep 2
        echo -n "."
    done
    echo ""
fi

if ! docker ps &> /dev/null; then
    echo -e "${RED}:: Docker failed to start${NC}"
    exit 1
fi

# Step 2: Check environment file
echo -e "${YELLOW}[2/9]${NC} Checking environment configuration..."
if [ ! -f .env ]; then
    cp .env.example .env
    echo -e "${GREEN}:: Created .env file from .env.example${NC}"
else
    echo -e "${GREEN}:: .env file exists${NC}"
fi

# Step 3: Stop and clean existing containers
echo -e "${YELLOW}[3/9]${NC} Cleaning up existing containers..."
docker-compose down -v > /dev/null 2>&1 || true
echo -e "${GREEN}:: Cleaned up${NC}"

# Step 4: Start infrastructure (PostgreSQL, Redis, Qdrant)
echo -e "${YELLOW}[4/8]${NC} Starting PostgreSQL, Redis, and Qdrant (Vector DB)..."
docker-compose up -d postgres redis qdrant

# Wait for services to be healthy
echo "⏳ Waiting for services to be ready..."
sleep 15

# Check if services are running
if docker-compose ps | grep -q "homework_postgres.*Up"; then
    echo -e "${GREEN}:: PostgreSQL is running${NC}"
else
    echo -e "${RED}:: PostgreSQL failed to start${NC}"
    docker-compose logs postgres
    exit 1
fi

if docker-compose ps | grep -q "homework_redis.*Up"; then
    echo -e "${GREEN}:: Redis is running${NC}"
else
    echo -e "${RED}:: Redis failed to start${NC}"
    docker-compose logs redis
    exit 1
fi

if docker-compose ps | grep -q "homework_qdrant.*Up"; then
    echo -e "${GREEN}:: Qdrant (Vector DB) is running${NC}"
else
    echo -e "${RED}:: Qdrant failed to start${NC}"
    docker-compose logs qdrant
    exit 1
fi

# Step 5: Update environment variables
echo -e "${YELLOW}[5/8]${NC} Configuring database and services..."

# Update DATABASE_URL for PostgreSQL
if grep -q "DATABASE_URL=" .env; then
    if ! grep -q "postgresql://homework:homework123@localhost:5432/homeworkdb" .env; then
        sed -i '' 's|DATABASE_URL=.*|DATABASE_URL="postgresql://homework:homework123@localhost:5432/homeworkdb"|' .env
        echo -e "${GREEN}:: Database URL updated to PostgreSQL${NC}"
    else
        echo -e "${GREEN}:: Database URL already configured${NC}"
    fi
else
    echo 'DATABASE_URL="postgresql://homework:homework123@localhost:5432/homeworkdb"' >> .env
    echo -e "${GREEN}:: Database URL added${NC}"
fi

# Update Redis URL
if grep -q "REDIS_URL=" .env; then
    if ! grep -q "redis://:redis123@localhost:6379" .env; then
        sed -i '' 's|REDIS_URL=.*|REDIS_URL="redis://:redis123@localhost:6379"|' .env
        echo -e "${GREEN}:: Redis URL updated${NC}"
    else
        echo -e "${GREEN}:: Redis URL already configured${NC}"
    fi
else
    echo 'REDIS_URL="redis://:redis123@localhost:6379"' >> .env
    echo -e "${GREEN}:: Redis URL added${NC}"
fi

# Add Qdrant URL
if grep -q "QDRANT_URL=" .env; then
    echo -e "${GREEN}:: Qdrant URL already configured${NC}"
else
    echo 'QDRANT_URL="http://localhost:6333"' >> .env
    echo -e "${GREEN}:: Qdrant URL added${NC}"
fi

# Step 6: Install dependencies
echo -e "${YELLOW}[6/8]${NC} Installing dependencies..."
if [ ! -d "node_modules" ]; then
    npm install
    echo -e "${GREEN}:: Dependencies installed${NC}"
else
    echo -e "${GREEN}:: Dependencies already installed${NC}"
fi

# Step 7: Run database migrations
echo -e "${YELLOW}[7/8]${NC} Running database migrations..."

# Check if migrations need to be reset (switching from SQLite to PostgreSQL)
if [ -f "prisma/migrations/migration_lock.toml" ]; then
    if grep -q "sqlite" prisma/migrations/migration_lock.toml; then
        echo "⚠️  Detected SQLite migrations, backing up and resetting for PostgreSQL..."
        mv prisma/migrations prisma/migrations_sqlite_backup_$(date +%Y%m%d_%H%M%S)
        echo -e "${YELLOW}:: Creating new migrations for PostgreSQL...${NC}"
    fi
fi

# Generate Prisma Client
npx prisma generate > /dev/null 2>&1

# Run migrations
if [ -d "prisma/migrations" ] && [ "$(ls -A prisma/migrations)" ]; then
    echo "Running existing migrations..."
    npx prisma migrate deploy
else
    echo "Creating initial migration..."
    npx prisma migrate dev --name init_postgresql
fi

echo -e "${GREEN}:: Database migrations complete${NC}"

# Step 8: Build and start the application
echo -e "${YELLOW}[8/8]${NC} Building and starting the application..."

# Build TypeScript
npm run build

# Get port from .env or default to 3001
PORT=$(grep "^PORT=" .env | cut -d '=' -f2 | tr -d '"' || echo "3001")

# Kill any existing process on the port
if lsof -ti:$PORT > /dev/null 2>&1; then
    echo "⚠️  Killing existing process on port $PORT..."
    kill $(lsof -ti:$PORT) > /dev/null 2>&1 || true
    sleep 2
fi

# Start the application in background
nohup npm run dev > server.log 2>&1 &
SERVER_PID=$!
echo $SERVER_PID > server.pid

# Wait for server to start
echo "⏳ Waiting for server to start..."
for i in {1..20}; do
    if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
        echo -e "${GREEN}:: Server is running!${NC}"
        break
    fi
    sleep 1
    echo -n "."
done
echo ""

# Verify server is running
if curl -s http://localhost:$PORT/health > /dev/null 2>&1; then
    echo ""
    echo -e "${GREEN}========================================${NC}"
    echo -e "${GREEN}  🚀 All services are running!${NC}"
    echo -e "${GREEN}========================================${NC}"
    echo ""
    echo -e "${BLUE}Service Status:${NC}"
    echo "  :: PostgreSQL:  localhost:5432"
    echo "  :: Redis:       localhost:6379"
    echo "  :: Qdrant:      http://localhost:6333"
    echo "  :: App:         http://localhost:$PORT"
    echo ""
    echo -e "${BLUE}Credentials:${NC}"
    echo "  • PostgreSQL:   homework / homework123 / homeworkdb"
    echo "  • Redis:        password: redis123"
    echo "  • Qdrant:       No authentication (local)"
    echo ""
    echo -e "${BLUE}Quick Tests:${NC}"
    echo "  • API:          curl http://localhost:$PORT/health"
    echo "  • Create Syllabus: Check Postman collection"
    echo "  • Qdrant UI:    http://localhost:6333/dashboard"
    echo ""
    echo -e "${BLUE}Useful Commands:${NC}"
    echo "  • View logs:      tail -f server.log"
    echo "  • Stop server:    ./stop.sh"
    echo "  • Database GUI:   npx prisma studio"
    echo "  • Check DB:       docker exec -it homework_postgres psql -U homework -d homeworkdb"
    echo "  • Redis CLI:      docker exec -it homework_redis redis-cli -a redis123"
    echo "  • Qdrant Health:  curl http://localhost:6333/healthz"
    echo ""
    echo -e "${BLUE}Server PID:${NC} $SERVER_PID"
    echo -e "${BLUE}Logs:${NC} server.log"
    echo ""
    echo -e "${YELLOW}Next Steps:${NC}"
    echo "  1. Import Postman collection (homeWork_API.postman_collection.json)"
    echo "  2. Test API endpoints"
    echo "  3. Vector DB will be automatically set up on first use"
    echo ""
else
    echo -e "${RED}:: Server failed to start${NC}"
    echo "Check server.log for details:"
    tail -30 server.log
    exit 1
fi
