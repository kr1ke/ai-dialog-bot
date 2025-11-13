const FormData = require('form-data');
const openrouter = require('../services/openrouter');
const telegram = require('../services/telegram');
const config = require('../config');
const logger = require('../logger');

// Transcribe voice message
async function transcribe(bot, fileId, userId) {
  try {
    // Download file as buffer
    const buffer = await telegram.downloadFile(bot, fileId);

    // Create FormData
    const formData = new FormData();
    formData.append('file', buffer, 'audio.ogg');
    formData.append('model', config.VOICE_MODEL);
    formData.append('language', 'ru');

    // Send typing status
    try {
      await bot.sendChatAction(userId, 'typing');
    } catch (error) {
      // Ignore - typing failures are non-critical
    }

    // Call OpenRouter audio transcription
    const response = await openrouter.transcribeAudio(formData);

    return response.text;
  } catch (error) {
    logger.error('Voice transcription failed', {
      fileId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  transcribe
};
