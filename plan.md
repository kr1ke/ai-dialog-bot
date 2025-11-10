# Implementation Plan for Telegram Context Assistant Bot (MVP)

## 📋 Project Overview

Simple Telegram bot that analyzes forwarded messages and helps craft responses. Node.js + PostgreSQL + Docker. MVP version - no caching, no retries, no optimization.

---

## 🏗️ Project Structure

```
telegram-context-bot/
├── src/
│   ├── index.js              # Entry point
│   ├── handlers.js           # Message/callback handlers
│   ├── commands.js           # /analyze, /clear, /help
│   ├── processors/
│   │   ├── text.js           # Text analysis via OpenRouter
│   │   ├── vision.js         # Image recognition
│   │   └── voice.js          # Voice transcription
│   ├── services/
│   │   ├── openrouter.js     # OpenRouter API calls
│   │   ├── telegram.js       # File download helpers
│   │   └── db.js             # All database operations
│   ├── logger.js             # Winston setup
│   └── config.js             # Load from .env
├── migrations/
│   └── 001_initial.sql       # Database schema
├── docker-compose.yml
├── Dockerfile
├── package.json
└── .env.example
```

---

## 🗄️ Database Schema

### migrations/001_initial.sql

```sql
-- Sessions table
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE NOT NULL,
  state VARCHAR(50) NOT NULL,
  messages JSONB DEFAULT '[]',
  last_instruction TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Statistics table
CREATE TABLE statistics (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  action_data JSONB,
  session_messages_count INT,
  model_used VARCHAR(100),
  tokens_used INT,
  response_time_ms INT,
  error_occurred BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Logs table
CREATE TABLE logs (
  id SERIAL PRIMARY KEY,
  level VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
```

**messages JSONB format:**
```json
[{
  "text": "Hello",
  "author": {
    "isUser": false,
    "name": "Maria",
    "id": 12345
  },
  "timestamp": 1699887600,
  "type": "text",
  "metadata": {}
}]
```

---

## 📝 Implementation Guidelines

### src/index.js
```
1. Load config from .env
2. Connect to PostgreSQL
3. Run migrations from migrations/ folder
4. Initialize Winston logger
5. Create TelegramBot(token, {polling: true})
6. Register handlers:
   - bot.on('message', handlers.handleMessage)
   - bot.on('callback_query', handlers.handleCallback)
   - bot.onText(/\/analyze/, commands.handleAnalyze)
   - bot.onText(/\/clear/, commands.handleClear)
   - bot.onText(/\/help/, commands.handleHelp)
7. Set bot commands menu
8. Handle SIGINT for graceful shutdown
```

### src/handlers.js

**handleMessage(bot, msg)**
```
1. Get userId from msg.from.id
2. Check if forwarded: msg.forward_date exists

IF FORWARDED:
  - Get current session from DB
  - If session exists → DELETE it (always reset on forward)
  - INSERT new session with state='collecting'
  - Determine author:
    * If msg.forward_from.id === userId → isUser: true
    * Else → isUser: false, name from forward_from.first_name
  - Process message type:
    * text → save msg.text
    * photo → call vision.analyzeImage(), save description
    * voice → call voice.transcribe(), save transcription
  - INSERT message into session.messages JSONB
  - Send reply: "✓ {count}"
  - INSERT into statistics (action_type: 'forward_message')

ELSE IF TEXT (not command):
  - Get session from DB
  - If no session → reply "Переслай сообщения и используй /analyze"
  - If state == 'collecting' → reply "💡 Используй /analyze"
  - If state == 'waiting_action' OR 'conversation':
    * Call text.processContext(messages, msg.text, userId)
    * Send response with [🔄 Еще варианты] button
    * UPDATE session state='conversation', last_instruction=msg.text
    * INSERT into statistics (action_type: 'custom_request')
```

**handleCallback(bot, query)**
```
1. Parse query.data
2. Get session from DB
3. If no session → reply "❌ Сессия истекла"

IF action:summary|formal|friendly:
  - Get instruction template
  - Call text.processContext()
  - Send response with [🔄 Еще варианты] button
  - UPDATE session state='conversation', last_instruction
  - INSERT into statistics (action_type: 'button_{action}')

IF action:clear:
  - DELETE session
  - Reply "🗑 Буфер очищен"
  - INSERT into statistics

IF regenerate:
  - Get session.last_instruction
  - Call text.processContext() with same instruction
  - Send response with [🔄 Еще варианты] button
  - INSERT into statistics (action_type: 'regenerate')
```

### src/commands.js

**handleAnalyze(bot, msg)**
```
1. Get session from DB
2. If no session OR messages.length == 0:
   - Reply "❌ Нет сообщений в буфере"
3. Else:
   - UPDATE session state='waiting_action'
   - Send message with inline keyboard:
     [[📝 Резюме]]
     [[💼 Официально][😊 Дружески]]
     [[🗑 Очистить]]
     + hint text
   - INSERT into statistics (action_type: 'analyze_clicked')
```

**handleClear(bot, msg)**
```
1. DELETE session from DB
2. Reply "🗑 Буфер очищен"
3. INSERT into statistics
```

**handleHelp(bot, msg)**
```
1. Send help text with instructions
2. INSERT into statistics
```

### src/processors/text.js

**processContext(messages, instruction, userId)**
```
1. Build conversation string:
   Loop through messages:
     - Format time from timestamp
     - Label: msg.author.isUser ? "Ты" : msg.author.name
     - Add text or metadata description
     - Result: "[14:20] Ты: Hello\n[14:25] Maria: Hi"

2. Build prompt:
   "Ты - ассистент для помощи в переписках.
    
    КОНТЕКСТ ПЕРЕПИСКИ:
    {conversation}
    
    ВАЖНО: 'Ты' - это пользователь. Остальные - собеседники.
    
    ЗАДАЧА: {instruction}"

3. Call openrouter.chatCompletion({
     model: config.TEXT_MODEL,
     messages: [
       {role: 'system', content: 'Ты помогаешь в переписках'},
       {role: 'user', content: prompt}
     ]
   })

4. Return response.choices[0].message.content
5. Store lastModelUsed, lastTokensUsed for stats
```

**Instruction templates:**
- summary: "Кратко резюмируй переписку: что хотел собеседник, что ответил пользователь, что лучше ответить дальше"
- formal: "Помоги составить официальный ответ. Вежливый и профессиональный"
- friendly: "Помоги составить дружеский ответ. Теплый и естественный"

### src/processors/vision.js

**analyzeImage(bot, fileId)**
```
1. Call telegram.downloadFileAsBase64(bot, fileId)
2. Call openrouter.chatCompletion({
     model: config.VISION_MODEL,
     messages: [{
       role: 'user',
       content: [
         {type: 'text', text: 'Опиши изображение кратко на русском (1-2 предложения)'},
         {type: 'image_url', image_url: {url: 'data:image/jpeg;base64,{base64}'}}
       ]
     }]
   })
3. Return description text
```

### src/processors/voice.js

**transcribe(bot, fileId)**
```
1. Call telegram.downloadFile(bot, fileId) → Buffer
2. Create FormData:
   - formData.append('file', buffer, 'audio.ogg')
   - formData.append('model', config.VOICE_MODEL)
   - formData.append('language', 'ru')
3. POST to OpenRouter audio/transcriptions endpoint
4. Return transcription.text
```

### src/services/openrouter.js

**chatCompletion(params)**
```
POST https://openrouter.ai/api/v1/chat/completions
Headers:
  - Authorization: Bearer {apiKey}
  - Content-Type: application/json
Body:
  - model
  - messages
  - temperature: 0.7
  - max_tokens: 1000

Return response.data
If error → throw new Error('OpenRouter API failed')
```

**transcribeAudio(formData)**
```
POST https://openrouter.ai/api/v1/audio/transcriptions
Headers:
  - Authorization: Bearer {apiKey}
  - ...formData.getHeaders()
Body: formData

Return response.data
If error → throw error
```

### src/services/telegram.js

**downloadFile(bot, fileId)**
```
1. file = await bot.getFile(fileId)
2. fileUrl = https://api.telegram.org/file/bot{token}/{file.file_path}
3. response = await axios.get(fileUrl, {responseType: 'arraybuffer'})
4. return Buffer.from(response.data)
```

**downloadFileAsBase64(bot, fileId)**
```
1. buffer = await downloadFile(bot, fileId)
2. return buffer.toString('base64')
```

### src/services/db.js

```
Initialize pool from pg library
Export functions:

- query(sql, params) → pool.query()
- runMigrations() → read migrations/*.sql, execute
- getSession(userId) → SELECT
- createSession(userId) → INSERT
- updateSession(userId, data) → UPDATE
- deleteSession(userId) → DELETE
- addMessageToSession(userId, messageData) → UPDATE messages JSONB
- logAction(statsData) → INSERT into statistics
- logToDb(level, message, context) → INSERT into logs
- close() → pool.end()
```

### src/logger.js

```
Winston configuration:
- Console transport (always)
- File transport: logs/app-%DATE%.log (daily rotation)
- On error level → also call db.logToDb()

Export logger instance
```

### src/config.js

```javascript
require('dotenv').config();

module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  TEXT_MODEL: process.env.TEXT_MODEL || 'anthropic/claude-3.5-sonnet',
  VISION_MODEL: process.env.VISION_MODEL || 'google/gemini-2.0-flash-exp:free',
  VOICE_MODEL: process.env.VOICE_MODEL || 'openai/whisper-1',
  DATABASE_URL: process.env.DATABASE_URL,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};
```

---

## 🐳 Docker Setup

### Dockerfile
```dockerfile
FROM node:18-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install
COPY . .
CMD ["node", "src/index.js"]
```

### docker-compose.yml
```yaml
version: '3.8'

services:
  bot:
    build: .
    env_file: .env
    depends_on:
      - db
    restart: unless-stopped
    volumes:
      - ./logs:/app/logs

  db:
    image: postgres:15-alpine
    environment:
      POSTGRES_DB: telegram_bot
      POSTGRES_USER: botuser
      POSTGRES_PASSWORD: ${DB_PASSWORD}
    volumes:
      - db_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

volumes:
  db_data:
```

---

## 📦 package.json

```json
{
  "name": "telegram-context-bot",
  "version": "1.0.0",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js"
  },
  "dependencies": {
    "node-telegram-bot-api": "^0.66.0",
    "pg": "^8.11.3",
    "axios": "^1.6.2",
    "form-data": "^4.0.0",
    "winston": "^3.11.0",
    "winston-daily-rotate-file": "^4.7.1",
    "dotenv": "^16.3.1"
  }
}
```

---

## 🔑 .env.example

```env
TELEGRAM_BOT_TOKEN=
OPENROUTER_API_KEY=

TEXT_MODEL=anthropic/claude-3.5-sonnet
VISION_MODEL=google/gemini-2.0-flash-exp:free
VOICE_MODEL=openai/whisper-1

DATABASE_URL=postgresql://botuser:password@db:5432/telegram_bot
DB_PASSWORD=your_secure_password

LOG_LEVEL=info
```

---

## 🚀 Implementation Steps

1. Create project structure
2. Setup package.json, install dependencies
3. Create migration file with schema
4. Implement config.js + logger.js
5. Implement services/db.js with migrations runner
6. Implement services/openrouter.js
7. Implement services/telegram.js
8. Implement processors (text, vision, voice)
9. Implement handlers.js
10. Implement commands.js
11. Implement index.js
12. Create Dockerfile + docker-compose.yml
13. Test with `docker-compose up`

---

## 🎯 Core Rules

1. **Forwarded message = DELETE old session, create new**
2. **Author detection: msg.forward_from.id === userId**
3. **States: idle → collecting → waiting_action → conversation**
4. **No caching, no retries, no optimization**
5. **All errors → log + send user friendly message**
6. **Track all actions in statistics table**

---

## ⚠️ Error Handling

```
try {
  // operation
} catch (error) {
  logger.error('Operation failed', {userId, error: error.message});
  await bot.sendMessage(userId, '❌ Сервис временно недоступен, попробуй позже');
  await db.logAction({userId, actionType: '...', errorOccurred: true});
}
```

---

**This is a minimal MVP plan. Implement straightforward, no clever optimizations.**