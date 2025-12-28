#!/bin/bash

# homeWork Server - Stop Script
# This script stops all services (Node.js server, PostgreSQL, Redis, Qdrant)

set -e  # Exit on any error

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  homeWork Server - Stopping Services${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""

# Step 1: Stop Node.js server
echo -e "${YELLOW}[1/3]${NC} Stopping Node.js server..."
if [ -f server.pid ]; then
    SERVER_PID=$(cat server.pid)
    if ps -p $SERVER_PID > /dev/null 2>&1; then
        kill $SERVER_PID
        echo -e "${GREEN}:: Server stopped (PID: $SERVER_PID)${NC}"
    else
        echo -e "${YELLOW}⚠️  Server was not running${NC}"
    fi
    rm server.pid
else
    echo -e "${YELLOW}⚠️  No PID file found${NC}"
    
    # Try to find and kill by port
    PORT=$(grep "^PORT=" .env 2>/dev/null | cut -d '=' -f2 | tr -d '"' || echo "3001")
    if lsof -ti:$PORT > /dev/null 2>&1; then
        echo "Found process on port $PORT, killing..."
        kill $(lsof -ti:$PORT) > /dev/null 2>&1 || true
        echo -e "${GREEN}:: Server stopped${NC}"
    fi
fi

# Step 2: Stop Docker containers
echo -e "${YELLOW}[2/3]${NC} Stopping Docker containers..."
if docker-compose ps | grep -q "Up"; then
    docker-compose stop
    echo -e "${GREEN}:: Docker containers stopped${NC}"
else
    echo -e "${YELLOW}⚠️  No containers were running${NC}"
fi

# Step 3: Option to remove containers and volumes
echo ""
echo -e "${YELLOW}[3/3]${NC} Cleanup options:"
echo "  1) Keep containers (can restart with 'docker-compose start')"
echo "  2) Remove containers but keep data (volumes)"
echo "  3) Remove everything (containers + data - DESTRUCTIVE!)"
echo ""
read -p "Choose option (1-3) [default: 1]: " choice
choice=${choice:-1}

case $choice in
    1)
        echo -e "${GREEN}:: Containers stopped but preserved${NC}"
        echo "   Restart with: docker-compose start"
        ;;
    2)
        docker-compose down
        echo -e "${GREEN}:: Containers removed, data preserved${NC}"
        echo "   Restart with: ./start.sh"
        ;;
    3)
        docker-compose down -v
        echo -e "${RED}:: All containers and data removed${NC}"
        echo "   Fresh start with: ./start.sh"
        ;;
    *)
        echo -e "${RED}Invalid option${NC}"
        exit 1
        ;;
esac

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  Services Stopped Successfully${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "${BLUE}Service Status:${NC}"
docker-compose ps

echo ""
echo -e "${BLUE}To restart:${NC}"
echo "  • Full setup:    ./start.sh"
echo "  • Just Docker:   docker-compose start"
echo "  • Just server:   npm run dev"
echo ""
