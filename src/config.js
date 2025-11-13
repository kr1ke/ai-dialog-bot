require('dotenv').config();

module.exports = {
  TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
  OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
  // Model options (can override via .env):
  // Text: deepseek/deepseek-chat-v3.1 ($0.20/M in, $0.80/M out, 131K context)
  TEXT_MODEL: process.env.TEXT_MODEL || 'deepseek/deepseek-chat-v3.1',
  DATABASE_URL: process.env.DATABASE_URL,
  LOG_LEVEL: process.env.LOG_LEVEL || 'info'
};
