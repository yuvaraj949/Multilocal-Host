#!/bin/bash

# Arcade Hub Auto-Deploy Script
# Run this on your Raspberry Pi to pull the latest changes and restart the server

echo "🔽 Pulling latest changes from GitHub..."
git pull origin main

echo "📦 Installing client dependencies and building..."
cd client
npm install
npm run build
cd ..

echo "📦 Installing server dependencies..."
cd server
npm install

echo "🔄 Restarting the server using PM2..."
# If arcade-hub is not running, PM2 will start it. If it is, PM2 will restart it.
pm2 restart arcade-hub || pm2 start index.js --name arcade-hub

echo "✅ Deployment complete! Arcade Hub is back online."
