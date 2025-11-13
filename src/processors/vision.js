const openrouter = require('../services/openrouter');
const telegram = require('../services/telegram');
const config = require('../config');
const logger = require('../logger');

// Analyze image and return description
async function analyzeImage(bot, fileId, userId) {
  try {
    // Download file as base64
    const base64Image = await telegram.downloadFileAsBase64(bot, fileId);

    // Send typing status
    try {
      await bot.sendChatAction(userId, 'typing');
    } catch (error) {
      // Ignore - typing failures are non-critical
    }

    // Call OpenRouter vision API
    const response = await openrouter.chatCompletion({
      model: config.VISION_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Опиши изображение кратко на русском (1-2 предложения)'
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`
              }
            }
          ]
        }
      ]
    });

    const description = response.choices[0].message.content;
    return description;
  } catch (error) {
    logger.error('Image analysis failed', {
      fileId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  analyzeImage
};
