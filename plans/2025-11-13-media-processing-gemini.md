# Task: Добавление обработки изображений и голосовых сообщений

**Created**: 2025-11-13  
**Status**: ✅ Реализовано  
**Estimated Complexity**: Medium  
**Unified Model**: `google/gemini-2.0-flash-lite-001` (multimodal)

---

## 1. Контекст & Цель

### Что нужно сделать:
- **Добавить обработку изображений** из пересланных сообщений через Vision API
- **Добавить обработку голосовых сообщений** через транскрипцию в текст
- **Унифицировать на одну модель**: использовать `google/gemini-2.0-flash-lite-001` для всего (текст, vision, audio)

### Почему:
- Сейчас медиа-файлы игнорируются (хранятся как `[Изображение]`)
- Пользователи теряют важный контекст из картинок и голосовых
- Gemini 2.0 Flash Lite поддерживает все типы контента + дешевле

---

## 2. Анализ кодовой базы

### Существующие паттерны:

**Структура процессоров** (`src/processors/text.js`):
- Экспортирует `processContext(bot, messages, instruction, userId)`
- Возвращает `{ result, metadata }` с моделью, токенами, временем ответа
- Использует `openrouter.chatCompletion()` для API-вызовов
- Отправляет typing status перед обработкой

**Обработка медиа** (`src/handlers.js`, строки 68-100):
- Уже детектирует типы: `msg.photo`, `msg.voice`, `msg.video`, `msg.sticker`, `msg.document`, `msg.audio`, `msg.video_note`
- Сохраняет placeholder-текст в `messageData.text`
- Сохраняет тип в `messageData.type`
- Метаданные хранятся в `messageData.metadata = {}`

**Работа с OpenRouter** (`src/services/openrouter.js`):
- Функция `chatCompletion(params)` принимает `model`, `messages`, `temperature`, `max_tokens`
- Формат messages: `[{ role: 'system', content: '...' }, { role: 'user', content: '...' }]`

**Конфигурация** (`src/config.js`):
- Использует `TEXT_MODEL` для текстовой модели
- Можно переопределить через `.env`

### Зависимости:

**Прямые зависимости** (файлы, которые изменим):
- `src/config.js` - добавим унифицированную модель `UNIFIED_MODEL`
- `src/handlers.js` - сохраним file_id и metadata для медиа
- `src/processors/text.js` - адаптируем под multimodal-запросы
- `src/services/openrouter.js` - поддержим multimodal-контент

**Создадим новые файлы**:
- `src/services/telegram-media.js` - загрузка медиа-файлов через Telegram API
- `src/processors/media.js` - обработка изображений и голосовых через Gemini

**Внешние API**:
- Telegram Bot API (`bot.getFileLink(file_id)`) - загрузка файлов
- OpenRouter API - поддержка multimodal-запросов для Gemini

---

## 3. Предлагаемая реализация

### Ключевые решения:

1. **Унификация модели**: все запросы идут через `google/gemini-2.0-flash-lite-001`
2. **Multimodal messages**: Gemini принимает массив `content` частей (text + image_url + audio)
3. **Загрузка медиа**: через `bot.getFileLink()` → конвертация в base64 или URL
4. **Хранение metadata**: добавим `file_id`, `file_size` в JSONB для будущей обработки

---

### Файлы для создания:

```
📄 src/services/telegram-media.js (~80 строк)
Назначение: Загрузка медиа-файлов из Telegram
Методы:
  - downloadFile(bot, fileId) → возвращает Buffer
  - getImageAsBase64(bot, fileId) → возвращает data URI
  - getVoiceAsBase64(bot, fileId) → возвращает base64 для аудио
```

```
📄 src/processors/media.js (~120 строк)
Назначение: Обработка multimodal-контента через Gemini
Методы:
  - processMultimodalContext(bot, messages, instruction, userId)
  - buildMultimodalMessages(messages) → конвертирует в Gemini-формат
Паттерн: Следует структуре text.js
```

---

### Файлы для изменения:

#### 📝 `src/config.js`

**Строки**: 6-11  
**Изменения**: Добавить унифицированную модель

```javascript
// BEFORE:
module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  TEXT_MODEL: process.env.TEXT_MODEL || 'deepseek/deepseek-chat-v3.1',
  DATABASE_URL: process.env.DATABASE_URL,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};

// AFTER:
module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  // Unified multimodal model for text, images, and audio
  UNIFIED_MODEL: process.env.UNIFIED_MODEL || 'google/gemini-2.0-flash-lite-001',
  // Legacy support (deprecated - use UNIFIED_MODEL)
  TEXT_MODEL: process.env.TEXT_MODEL || process.env.UNIFIED_MODEL || 'google/gemini-2.0-flash-lite-001',
  DATABASE_URL: process.env.DATABASE_URL,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};
```

**Reasoning**: Обратная совместимость + новая переменная UNIFIED_MODEL

---

#### 📝 `src/handlers.js`

**Строки**: 68-100  
**Изменения**: Сохранять file_id и metadata для медиа

```javascript
// BEFORE (строка 68-71):
} else if (msg.photo) {
  // Photo message - store as placeholder
  messageData.text = '[Изображение]';
  messageData.type = 'image';

// AFTER:
} else if (msg.photo) {
  // Photo message - store file_id for processing
  const photo = msg.photo[msg.photo.length - 1]; // largest size
  messageData.text = '[Изображение]';
  messageData.type = 'image';
  messageData.metadata = {
    file_id: photo.file_id,
    file_size: photo.file_size,
    width: photo.width,
    height: photo.height
  };
```

**Аналогично для voice** (строки 72-75):
```javascript
// BEFORE:
} else if (msg.voice) {
  messageData.text = '[Голосовое сообщение]';
  messageData.type = 'voice';

// AFTER:
} else if (msg.voice) {
  messageData.text = '[Голосовое сообщение]';
  messageData.type = 'voice';
  messageData.metadata = {
    file_id: msg.voice.file_id,
    file_size: msg.voice.file_size,
    duration: msg.voice.duration,
    mime_type: msg.voice.mime_type
  };
```

---

#### 📝 `src/processors/text.js`

**Строки**: 62-69  
**Изменения**: Использовать UNIFIED_MODEL вместо TEXT_MODEL

```javascript
// BEFORE:
const response = await openrouter.chatCompletion({
  model: config.TEXT_MODEL,
  messages: [
    { role: 'system', content: 'Ты помогаешь в переписках' },
    { role: 'user', content: prompt }
  ]
});

// AFTER:
const response = await openrouter.chatCompletion({
  model: config.UNIFIED_MODEL,
  messages: [
    { role: 'system', content: 'Ты помогаешь в переписках' },
    { role: 'user', content: prompt }
  ]
});
```

**Строки**: 75-76  
**Изменения**: Обновить metadata

```javascript
// BEFORE:
const metadata = {
  model: config.TEXT_MODEL,

// AFTER:
const metadata = {
  model: config.UNIFIED_MODEL,
```

---

#### 📝 `src/services/openrouter.js`

**Строки**: 8-24  
**Изменения**: Поддержать multimodal content

```javascript
// BEFORE:
async function chatCompletion(params) {
  try {
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      {
        model: params.model,
        messages: params.messages,
        temperature: params.temperature || 0.7,
        max_tokens: params.max_tokens || 1000
      },

// AFTER:
async function chatCompletion(params) {
  try {
    const requestBody = {
      model: params.model,
      messages: params.messages,
      temperature: params.temperature || 0.7,
      max_tokens: params.max_tokens || 1000
    };

    // Support for multimodal content (images/audio)
    // Gemini accepts messages with content array instead of plain text
    const response = await axios.post(
      `${OPENROUTER_BASE_URL}/chat/completions`,
      requestBody,
```

**Reasoning**: OpenRouter уже поддерживает multimodal-формат, просто передаём content как есть

---

### Новые файлы - код:

#### 📄 `src/services/telegram-media.js`

```javascript
const axios = require('axios');
const logger = require('../logger');

/**
 * Download file from Telegram servers
 * @param {TelegramBot} bot - Bot instance
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<Buffer>} File buffer
 */
async function downloadFile(bot, fileId) {
  try {
    const fileLink = await bot.getFileLink(fileId);
    const response = await axios.get(fileLink, { responseType: 'arraybuffer' });
    return Buffer.from(response.data);
  } catch (error) {
    logger.error('File download failed', { fileId, error: error.message });
    throw new Error('Failed to download Telegram file');
  }
}

/**
 * Get image as base64 data URI for Gemini
 * @param {TelegramBot} bot - Bot instance
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<string>} Base64 data URI
 */
async function getImageAsBase64(bot, fileId) {
  try {
    const buffer = await downloadFile(bot, fileId);
    const base64 = buffer.toString('base64');
    // Gemini expects data:image/jpeg;base64,<data>
    return `data:image/jpeg;base64,${base64}`;
  } catch (error) {
    logger.error('Image conversion failed', { fileId, error: error.message });
    throw error;
  }
}

/**
 * Get voice as base64 for Gemini audio
 * @param {TelegramBot} bot - Bot instance
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<string>} Base64 audio data
 */
async function getVoiceAsBase64(bot, fileId) {
  try {
    const buffer = await downloadFile(bot, fileId);
    const base64 = buffer.toString('base64');
    // Gemini expects data:audio/ogg;base64,<data> for voice
    return `data:audio/ogg;base64,${base64}`;
  } catch (error) {
    logger.error('Voice conversion failed', { fileId, error: error.message });
    throw error;
  }
}

module.exports = {
  downloadFile,
  getImageAsBase64,
  getVoiceAsBase64
};
```

---

#### 📄 `src/processors/media.js`

```javascript
const openrouter = require('../services/openrouter');
const telegramMedia = require('../services/telegram-media');
const config = require('../config');
const logger = require('../logger');
const { getInstruction, INSTRUCTION_TEMPLATES } = require('./text');

/**
 * Format timestamp to time string
 */
function formatTime(timestamp) {
  const date = new Date(timestamp * 1000);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

/**
 * Build multimodal messages for Gemini
 * Converts session messages to OpenAI-compatible multimodal format
 */
async function buildMultimodalMessages(bot, messages) {
  const parts = [];

  for (const msg of messages) {
    const time = formatTime(msg.timestamp);
    const author = msg.author.isUser ? 'Ты' : msg.author.name;
    const prefix = `[${time}] ${author}: `;

    if (msg.type === 'text') {
      // Regular text message
      parts.push(`${prefix}${msg.text}`);
    } else if (msg.type === 'image' && msg.metadata?.file_id) {
      // Image message - include actual image
      try {
        const imageData = await telegramMedia.getImageAsBase64(bot, msg.metadata.file_id);
        parts.push({
          type: 'text',
          text: `${prefix}[отправил изображение]`
        });
        parts.push({
          type: 'image_url',
          image_url: {
            url: imageData
          }
        });
      } catch (error) {
        logger.warn('Failed to load image, using placeholder', { 
          fileId: msg.metadata.file_id,
          error: error.message 
        });
        parts.push(`${prefix}[Изображение - не удалось загрузить]`);
      }
    } else if (msg.type === 'voice' && msg.metadata?.file_id) {
      // Voice message - include audio for transcription
      try {
        const audioData = await telegramMedia.getVoiceAsBase64(bot, msg.metadata.file_id);
        parts.push({
          type: 'text',
          text: `${prefix}[отправил голосовое сообщение]`
        });
        parts.push({
          type: 'input_audio',
          input_audio: {
            data: audioData.split(',')[1], // remove data:audio/ogg;base64, prefix
            format: 'ogg'
          }
        });
      } catch (error) {
        logger.warn('Failed to load voice, using placeholder', {
          fileId: msg.metadata.file_id,
          error: error.message
        });
        parts.push(`${prefix}[Голосовое сообщение - не удалось загрузить]`);
      }
    } else {
      // Other media types - use placeholder
      parts.push(`${prefix}${msg.text}`);
    }
  }

  return parts;
}

/**
 * Process context with multimodal support (images + voice + text)
 */
async function processMultimodalContext(bot, messages, instruction, userId) {
  try {
    const startTime = Date.now();

    // Check if session has media files
    const hasMedia = messages.some(msg => 
      (msg.type === 'image' || msg.type === 'voice') && msg.metadata?.file_id
    );

    // If no media, fall back to simple text processing
    if (!hasMedia) {
      // Build simple text conversation
      const conversationText = messages.map(msg => {
        const time = formatTime(msg.timestamp);
        const author = msg.author.isUser ? 'Ты' : msg.author.name;
        return `[${time}] ${author}: ${msg.text}`;
      }).join('\n');

      const instructionText = getInstruction(instruction);
      const prompt = `Ты - ассистент для помощи в переписках.

КОНТЕКСТ ПЕРЕПИСКИ:
${conversationText}

ВАЖНО: 'Ты' - это пользователь. Остальные - собеседники.

ЗАДАЧА: ${instructionText}`;

      // Send typing status
      try {
        await bot.sendChatAction(userId, 'typing');
      } catch (error) {
        // Ignore
      }

      const response = await openrouter.chatCompletion({
        model: config.UNIFIED_MODEL,
        messages: [
          { role: 'system', content: 'Ты помогаешь в переписках' },
          { role: 'user', content: prompt }
        ]
      });

      const responseTime = Date.now() - startTime;
      const result = response.choices[0].message.content;

      return {
        result,
        metadata: {
          model: config.UNIFIED_MODEL,
          tokens: response.usage?.total_tokens || null,
          responseTime,
          hasMedia: false
        }
      };
    }

    // Process with multimodal content
    const contentParts = await buildMultimodalMessages(bot, messages);
    const instructionText = getInstruction(instruction);

    // Send typing status (or upload_photo if has images)
    try {
      await bot.sendChatAction(userId, hasMedia ? 'upload_photo' : 'typing');
    } catch (error) {
      // Ignore
    }

    // Build multimodal message
    const response = await openrouter.chatCompletion({
      model: config.UNIFIED_MODEL,
      messages: [
        { 
          role: 'system', 
          content: 'Ты помогаешь в переписках. Анализируй весь контекст: текст, изображения и голосовые сообщения.' 
        },
        { 
          role: 'user', 
          content: [
            { type: 'text', text: 'КОНТЕКСТ ПЕРЕПИСКИ:' },
            ...contentParts,
            { type: 'text', text: `\n\nВАЖНО: 'Ты' - это пользователь. Остальные - собеседники.\n\nЗАДАЧА: ${instructionText}` }
          ]
        }
      ],
      max_tokens: 2000 // Увеличим лимит для multimodal
    });

    const responseTime = Date.now() - startTime;
    const result = response.choices[0].message.content;

    return {
      result,
      metadata: {
        model: config.UNIFIED_MODEL,
        tokens: response.usage?.total_tokens || null,
        responseTime,
        hasMedia: true
      }
    };
  } catch (error) {
    logger.error('Multimodal processing failed', {
      userId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  processMultimodalContext,
  buildMultimodalMessages
};
```

---

## 4. Оценка влияния

### Риск: 🟡 Средний

**Причины среднего риска**:
- Изменяем обработку сообщений (критичный путь)
- Добавляем внешние API-вызовы (загрузка файлов)
- Изменяем схему metadata (но JSONB гибкий)

**Минимизация рисков**:
- Graceful degradation: если медиа не загружается, используем placeholder
- Обратная совместимость через fallback на text-only обработку
- Не меняем схему БД (используем существующий JSONB metadata)

---

### Затронутые области:

- [x] **Конфигурация** - новая переменная UNIFIED_MODEL
- [ ] **Database schema** - не меняется (используем существующий JSONB)
- [ ] **API endpoints** - не применимо (это Telegram bot)
- [x] **Environment variables** - опциональная `UNIFIED_MODEL`
- [ ] **Dependencies** - нет новых (axios уже есть)

---

### Breaking Changes:

**Нет** - полная обратная совместимость:
- Старые сессии без file_id будут работать как раньше (placeholder text)
- TEXT_MODEL fallback на UNIFIED_MODEL
- Media processor проверяет наличие file_id перед обработкой

---

### Зависимости от других задач:

**Нет** - можно реализовать независимо

---

## 5. План выполнения

### Этап 1: Подготовка инфраструктуры
- [ ] Создать `src/services/telegram-media.js`
- [ ] Обновить `src/config.js` с UNIFIED_MODEL
- [ ] Обновить `.env.example` с новой переменной

### Этап 2: Обработка медиа
- [ ] Создать `src/processors/media.js`
- [ ] Обновить `src/handlers.js` для сохранения file_id
- [ ] Обновить `src/services/openrouter.js` для multimodal

### Этап 3: Интеграция
- [ ] Обновить `src/commands.js` для использования media processor
- [ ] Обновить `src/processors/text.js` для использования UNIFIED_MODEL
- [ ] Обновить вызовы в `src/handlers.js` (callback handlers)

### Этап 4: Тестирование
- [ ] Тест с текстовыми сообщениями (регрессия)
- [ ] Тест с изображениями
- [ ] Тест с голосовыми
- [ ] Тест с комбинированным контекстом
- [ ] Тест graceful degradation (файл не загружается)

---

## 6. Вопросы для уточнения

1. **Лимиты файлов**: Какой максимальный размер изображения/голосового загружать? (рекомендую 5MB)
2. **Стоимость**: Gemini 2.0 Flash Lite дешевле deepseek для текста ($0.15 vs $0.20 за 1M input tokens). Переключаем полностью?
3. **Обработка старых сессий**: Нужно ли мигрировать старые сообщения (добавить пустой metadata)?
4. **Video support**: Добавить также обработку видео? (Gemini поддерживает, но файлы больше)

---

## 7. Ожидаемый результат

После реализации:

✅ Пересланные изображения анализируются AI (текст на картинках, содержимое, контекст)  
✅ Голосовые сообщения транскрибируются и включаются в контекст  
✅ Единая модель Gemini 2.0 Flash Lite для всего бота  
✅ Fallback на placeholder если загрузка медиа не удалась  
✅ Полная обратная совместимость со старыми сессиями  
✅ Улучшенное понимание контекста переписок  

---

## 8. Журнал выполнения

**Начато**: 2025-11-13  
**Завершено**: 2025-11-13

**Применённые изменения**:
- [x] Создан src/services/telegram-media.js
- [x] Создан src/processors/media.js
- [x] Обновлён src/config.js
- [x] Обновлён src/handlers.js
- [x] Обновлён src/processors/text.js
- [x] Обновлён src/services/openrouter.js
- [x] Обновлён src/commands.js (не требовалось изменений)
- [x] Обновлён .env.example

**Встреченные проблемы**:
- Нет критических проблем

**Финальные заметки**:
- Все файлы прошли синтаксическую проверку
- Graceful degradation реализован через try-catch в media processor
- Обратная совместимость сохранена через fallback на TEXT_MODEL
- Multimodal контент поддерживается через content array в OpenRouter API

**Исправления для голосовых сообщений** (2025-11-13):
- Добавлена конвертация OGG → WAV через ffmpeg (Gemini требует WAV)
- Исправлен формат payload: добавлен `type: "message"` для multimodal
- Убран префикс `data:audio/...` из base64 (Gemini ожидает чистый base64)
- Изменён формат с `ogg` на `wav` в `input_audio.format`
- Добавлен ffmpeg в Dockerfile для конвертации аудио
- Бот готов к тестированию с голосовыми сообщениями
