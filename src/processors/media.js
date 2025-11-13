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
            data: audioData, // Pure base64 without prefix
            format: 'wav'    // Gemini expects WAV format
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

    // Build multimodal message with proper Gemini format
    const response = await openrouter.chatCompletion({
      model: config.UNIFIED_MODEL,
      messages: [
        { 
          role: 'system', 
          content: 'Ты помогаешь в переписках. Анализируй весь контекст: текст, изображения и голосовые сообщения.' 
        },
        { 
          role: 'user',
          type: 'message',  // Required for Gemini multimodal
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