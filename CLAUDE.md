# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Telegram Context Assistant Bot - An AI-powered Telegram bot that analyzes forwarded message conversations and generates contextually appropriate responses. Built with Node.js, PostgreSQL, and OpenRouter API.

**Tech Stack**: Node.js (CommonJS), PostgreSQL, Docker, Winston (logging), node-telegram-bot-api

## Development Commands

```bash
# Start the bot with Docker
docker-compose up

# Start in development (after dependencies installed)
npm start

# Install dependencies
npm install
```

## Architecture

### Core Flow

1. **Session Management**: Each user has a session that stores forwarded messages in PostgreSQL JSONB format
2. **State Machine**: `idle` → `collecting` → `waiting_action` → `conversation`
3. **Message Processing**: Text/Voice/Image → OpenRouter API → Contextual response generation

### Critical Business Rules

- **Forwarded message always DELETES old session and creates new one** - This ensures clean context boundaries
- **Author detection**: `msg.forward_from.id === userId` determines if message author is the user (`isUser: true`) or their conversation partner
- **No caching, no retries, no optimization** - MVP is intentionally simple
- **All actions must be tracked** in the `statistics` table for analytics

### File Structure

```
src/
├── index.js              # Entry point: DB init, bot setup, handler registration
├── handlers.js           # Core logic: handleMessage, handleCallback
├── commands.js           # Bot commands: /analyze, /clear, /help
├── processors/
│   ├── text.js          # Text analysis via OpenRouter
│   ├── vision.js        # Image recognition
│   └── voice.js         # Voice transcription
├── services/
│   ├── openrouter.js    # OpenRouter API wrapper
│   ├── telegram.js      # File download utilities
│   └── db.js            # All database operations
├── logger.js            # Winston configuration
└── config.js            # Environment variable loading
```

### Database Schema

**sessions table**:
- `user_id`: Telegram user ID (unique)
- `state`: Current state in the flow
- `messages`: JSONB array of conversation messages
- `last_instruction`: Last AI instruction for regeneration

**messages JSONB structure**:
```json
[{
  "text": "Message content or description",
  "author": {
    "isUser": false,
    "name": "Maria",
    "id": 12345
  },
  "timestamp": 1699887600,
  "type": "text|image|voice",
  "metadata": {}
}]
```

**statistics table**: Tracks all user actions, model usage, tokens, response times, errors

**logs table**: Stores error-level logs from Winston

### Message Handling Logic

**Forwarded messages** (`msg.forward_date` exists):
- Delete existing session (always reset)
- Create new session with state `'collecting'`
- Process message type (text/photo/voice)
- Append to session's `messages` JSONB array
- Reply with message count: "✓ {count}"

**Text messages** (not commands):
- If no session: prompt user to forward messages
- If state is `'collecting'`: suggest using `/analyze`
- If state is `'waiting_action'` or `'conversation'`: process as custom instruction via `text.processContext()`

### AI Integration

**OpenRouter Models** (configured via .env):
- `TEXT_MODEL`: Default `anthropic/claude-3.5-sonnet` for text analysis
- `VISION_MODEL`: Default `google/gemini-2.0-flash-exp:free` for images
- `VOICE_MODEL`: Default `openai/whisper-1` for transcription

**Instruction Templates**:
- `summary`: "Кратко резюмируй переписку: что хотел собеседник, что ответил пользователь, что лучше ответить дальше"
- `formal`: "Помоги составить официальный ответ. Вежливый и профессиональный"
- `friendly`: "Помоги составить дружеский ответ. Теплый и естественный"

### Error Handling Pattern

All operations follow this pattern:
```javascript
try {
  // operation
} catch (error) {
  logger.error('Operation failed', {userId, error: error.message});
  await bot.sendMessage(userId, '❌ Сервис временно недоступен, попробуй позже');
  await db.logAction({userId, actionType: '...', errorOccurred: true});
}
```

### Migration System

- Migrations stored in `migrations/*.sql`
- Run automatically on startup via `db.runMigrations()`
- `001_initial.sql` contains the base schema

### Inline Keyboard Structure

After `/analyze`:
```
[[📝 Резюме]]
[[💼 Официально][😊 Дружески]]
[[🗑 Очистить]]
```

After AI response:
```
[[🔄 Еще варианты]]
```

## Environment Variables

Required in `.env`:
- `TELEGRAM_BOT_TOKEN`: Bot token from @BotFather
- `OPENROUTER_API_KEY`: API key from OpenRouter
- `DATABASE_URL`: PostgreSQL connection string (format: `postgresql://user:pass@host:port/db`)
- `DB_PASSWORD`: Used in docker-compose for PostgreSQL

Optional:
- `TEXT_MODEL`, `VISION_MODEL`, `VOICE_MODEL`: Override default models
- `LOG_LEVEL`: Winston log level (default: `info`)

## Implementation Status

This is a **planned project** - implementation has not started. The codebase currently contains:
- `prd.md`: Product requirements and feature specifications
- `plan.md`: Detailed implementation plan with pseudocode
- `package.json`: Basic scaffold (no dependencies added yet)

When implementing, follow the step-by-step plan in `plan.md` sections starting from "Implementation Steps".

When necessary, ask clarifying questions before starting work on the task. Ask in any doubt, it's better to ask again than not to ask.
