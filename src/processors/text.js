const openrouter = require('../services/openrouter');
const config = require('../config');
const logger = require('../logger');

// Instruction templates
const INSTRUCTION_TEMPLATES = {
  summary: 'Проанализируй переписку и представь структурированный ответ:\n\n📋 *Основная тема разговора:*\n[кратко о чем речь]\n\n🎯 *Цель собеседника:*\n[что он хочет добиться]\n\n💬 *Ключевые моменты:*\n• [важные моменты из текста]\n• [еще один момент]\n\n🎤 *Из голосовых сообщений:*\n[укажи что важного было сказано в голосовых, если они есть]\n\n🖼️ *Из изображений:*\n[опиши что важного видно на картинках, если они есть]\n\n📝 *Рекомендуемый ответ:*\n[конкретный вариант ответа]',
  formal: 'Учитывая весь контекст (текст, голосовые, изображения), предложи 3 варианта официального ответа:\n\n*Вариант 1 (строгий):*\n[формальный ответ с учетом медиа]\n\n*Вариант 2 (сбалансированный):*\n[вежливый ответ с учетом медиа]\n\n*Вариант 3 (мягкий):*\n[дипломатичный ответ с учетом медиа]',
  friendly: 'Учитывая весь контекст (текст, голосовые, изображения), предложи 3 варианта дружеского ответа:\n\n*Вариант 1 (прямой):*\n[прямой ответ с учетом медиа]\n\n*Вариант 2 (с юмором):*\n[ответ с юмором с учетом медиа]\n\n*Вариант 3 (поддерживающий):*\n[теплый ответ с учетом медиа]'
};

// Get instruction template or return custom instruction
function getInstruction(instructionKey) {
  return INSTRUCTION_TEMPLATES[instructionKey] || instructionKey;
}

// Format timestamp to time string
function formatTime(timestamp) {
  const date = new Date(timestamp * 1000);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

// Build conversation string from messages
function buildConversationString(messages) {
  return messages.map(msg => {
    const time = formatTime(msg.timestamp);
    const author = msg.author.isUser ? 'Ты' : msg.author.name;
    return `[${time}] ${author}: ${msg.text}`;
  }).join('\n');
}

// Process context and generate response
async function processContext(bot, messages, instruction, userId) {
  try {
    const startTime = Date.now();

    // Build conversation string
    const conversation = buildConversationString(messages);

    // Get actual instruction text
    const instructionText = getInstruction(instruction);

    // Build prompt
    const prompt = `Ты - ассистент для помощи в переписках.

КОНТЕКСТ ПЕРЕПИСКИ:
${conversation}

ВАЖНО: 'Ты' - это пользователь. Остальные - собеседники.

ЗАДАЧА: ${instructionText}`;

    // Send typing status
    try {
      await bot.sendChatAction(userId, 'typing');
    } catch (error) {
      // Ignore - typing failures are non-critical
    }

    // Call OpenRouter API
    const response = await openrouter.chatCompletion({
      model: config.UNIFIED_MODEL,
      messages: [
        { role: 'system', content: 'Ты помогаешь в переписках. Не используй таблицы, заголовки (# ## ###), ``` и цитаты (>) - они не поддерживаются в Telegram.' },
        { role: 'user', content: prompt }
      ]
    });

    const responseTime = Date.now() - startTime;
    const result = response.choices[0].message.content;

    // Store metadata for statistics
    const metadata = {
      model: config.UNIFIED_MODEL,
      tokens: response.usage?.total_tokens || null,
      responseTime
    };

    return { result, metadata };
  } catch (error) {
    logger.error('Text processing failed', {
      userId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  processContext,
  getInstruction,
  INSTRUCTION_TEMPLATES
};
