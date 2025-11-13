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
 * Get voice as base64 WAV for Gemini audio
 * @param {TelegramBot} bot - Bot instance
 * @param {string} fileId - Telegram file_id
 * @returns {Promise<string>} Base64 audio data (pure base64, no prefix)
 */
async function getVoiceAsBase64(bot, fileId) {
  try {
    const buffer = await downloadFile(bot, fileId);
    
    // Telegram sends voice as OGG Opus, but Gemini expects WAV
    // We need to convert OGG → WAV using ffmpeg
    const { exec } = require('child_process');
    const { promisify } = require('util');
    const execAsync = promisify(exec);
    const fs = require('fs');
    const path = require('path');
    const os = require('os');
    
    // Create temp files
    const tempDir = os.tmpdir();
    const inputPath = path.join(tempDir, `voice_${Date.now()}_${fileId}.ogg`);
    const outputPath = path.join(tempDir, `voice_${Date.now()}_${fileId}.wav`);
    
    try {
      // Write OGG to temp file
      fs.writeFileSync(inputPath, buffer);
      
      // Convert OGG to WAV using ffmpeg
      await execAsync(`ffmpeg -i "${inputPath}" -ar 16000 -ac 1 -c:a pcm_s16le "${outputPath}" -y`);
      
      // Read WAV file
      const wavBuffer = fs.readFileSync(outputPath);
      const base64 = wavBuffer.toString('base64');
      
      // Clean up temp files
      fs.unlinkSync(inputPath);
      fs.unlinkSync(outputPath);
      
      // Return pure base64 without prefix (Gemini expects this)
      return base64;
    } catch (conversionError) {
      // Clean up on error
      try {
        if (fs.existsSync(inputPath)) fs.unlinkSync(inputPath);
        if (fs.existsSync(outputPath)) fs.unlinkSync(outputPath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      logger.error('Audio conversion failed', { 
        fileId, 
        error: conversionError.message 
      });
      throw new Error('Failed to convert audio to WAV format');
    }
  } catch (error) {
    logger.error('Voice processing failed', { fileId, error: error.message });
    throw error;
  }
}

module.exports = {
  downloadFile,
  getImageAsBase64,
  getVoiceAsBase64
};