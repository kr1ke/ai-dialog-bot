const axios = require('axios');
const config = require('../config');
const logger = require('../logger');

// Download file from Telegram as Buffer
async function downloadFile(bot, fileId) {
  try {
    const file = await bot.getFile(fileId);
    const fileUrl = `https://api.telegram.org/file/bot${config.TELEGRAM_BOT_TOKEN}/${file.file_path}`;

    const response = await axios.get(fileUrl, {
      responseType: 'arraybuffer'
    });

    return Buffer.from(response.data);
  } catch (error) {
    logger.error('Telegram file download failed', {
      fileId,
      error: error.message
    });
    throw error;
  }
}

// Download file from Telegram as Base64 string
async function downloadFileAsBase64(bot, fileId) {
  try {
    const buffer = await downloadFile(bot, fileId);
    return buffer.toString('base64');
  } catch (error) {
    logger.error('Telegram file download as base64 failed', {
      fileId,
      error: error.message
    });
    throw error;
  }
}

module.exports = {
  downloadFile,
  downloadFileAsBase64
};
