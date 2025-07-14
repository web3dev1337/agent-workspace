#!/bin/bash

# Kill any existing servers
pkill -f "node.*orchestrator" || true

# Start orchestrator with explicit binding
echo "Starting orchestrator for mobile access..."
HOST=0.0.0.0 PORT=8888 npm start &

sleep 3

echo ""
echo "========================================="
echo "ORCHESTRATOR READY FOR MOBILE ACCESS!"
echo "========================================="
echo ""
echo "1. Make sure your PC's mobile hotspot is ON"
echo "2. Connect your phone to the PC hotspot"
echo "3. On your phone browser, go to:"
echo ""
echo "   http://192.168.137.1:8888/new"
echo ""
echo "========================================="
echo ""
echo "Press Ctrl+C to stop"

# Keep script running
wait