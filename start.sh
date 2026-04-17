#!/bin/bash
# Quick start script for Voice Agent

echo "Starting Voice Form-Filling Agent..."
echo "=================================="

# Kill existing processes
pkill -f "uvicorn api.main" 2>/dev/null
pkill -f "python main.py" 2>/dev/null  
pkill -f "vite" 2>/dev/null

# Start Backend API
echo "[1/3] Starting Backend API on :8000..."
cd /d/qwenbuilday_agent
source venv/Scripts/activate 2>/dev/null || source venv/bin/activate 2>/dev/null
uvicorn api.main:app --port 8000 &

# Start LiveKit Agent
echo "[2/3] Starting LiveKit Agent..."
python main.py dev &

# Start Frontend
echo "[3/3] Starting Frontend on :5173..."
cd /d/qwenbuilday_agent/frontend
npm run dev &

echo ""
echo "=================================="
echo "All services started!"
echo ""
echo "Open in browser:"
echo "  - Dashboard:  http://localhost:5173"
echo "  - Calls:      http://localhost:5173/calls"
echo "  - Phone:      http://localhost:5173/phone"
echo ""
echo "Press Ctrl+C to stop all services"

wait
