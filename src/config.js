require('dotenv').config();

module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  // Model options (can override via .env):
  // Text: deepseek/deepseek-chat-v3.1 ($0.20/M in, $0.80/M out, 131K context)
  // Vision: qwen/qwen3-vl-30b-a3b-instruct (visual understanding)
  TEXT_MODEL: process.env.TEXT_MODEL || 'deepseek/deepseek-chat-v3.1',
  VISION_MODEL: process.env.VISION_MODEL || 'qwen/qwen3-vl-30b-a3b-instruct',
  VOICE_MODEL: process.env.VOICE_MODEL || 'openai/whisper-1',
  DATABASE_URL: process.env.DATABASE_URL,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};
