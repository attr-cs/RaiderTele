# Raider Telebot - AI Image Generation Bot

A powerful Telegram bot that generates images using multiple AI models. Built with Node.js, Express, and MongoDB.

## Features

- Multiple AI Model Support:
  - Raider (Fastest) - Optimized for speed using WebSim AI
  - Flux - Balanced quality and speed via Pollinations AI
  - Turbo - Enhanced detail and creativity via Pollinations AI

- Smart Prompt Generation:
  - AI-powered random prompt generation using Google's Gemini API
  - Fallback mechanism between two API keys for reliability
  - Enhanced prompt processing for better results

- Real-time Dashboard:
  - Monitor bot status and operations
  - Track usage statistics
  - View user activity
  - Image generation history

## Commands

- `/start` - Initialize the bot and see available commands
- `/img <prompt>` - Generate an image using your default model
- `/model` - Change your default model (Raider/Flux/Turbo)
- `/rdm` - Receive an AI-generated creative prompt
- `/rnds` - Generate an image from a random AI-generated prompt
- `/status` - View current operational status

## Technical Details

- Image Generation APIs:
  - WebSim AI (Raider model)
  - Pollinations AI (Flux & Turbo models)

- Default Settings:
  - Default Model: Raider (Fastest)
  - Pollinations Settings: nologo=true, private=true, safe=false
  - Random seed generation for reproducible results
  - Supported aspect ratios: 1:1, 16:9, 9:16, 21:9, 9:21

## Environment Variables

```env
BOT_TOKEN=your_telegram_bot_token
PORT=4000
WEBHOOK_URL=your_webhook_url
BOT_USERNAME=@your_bot_username
GEMINI_API_KEY=your_gemini_api_key
GEMINI_API_KEY2=your_backup_gemini_api_key
DB_URL=your_mongodb_connection_string
```

## Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables in `.env` file
4. Start the server:
   ```bash
   npm start
   ```

## Dashboard Access

The admin dashboard is available at the root URL. Login required with admin password.

## Error Handling

- Automatic fallback between Gemini API keys
- Queue system for concurrent image generation
- Proper error messages for failed operations
- MongoDB connection retry mechanism

## Available Models
- Raider - Balanced quality and speed
- Flux - High Quality, Fast (Default)
- Imagen3 - High Quality, Multiple Images
- Turbo - Enhanced detail and creativity
- Gemini Flash - Basic image generation