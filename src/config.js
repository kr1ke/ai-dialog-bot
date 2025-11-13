require('dotenv').config();

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
