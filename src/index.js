const TelegramBot = require('node-telegram-bot-api');
const config = require('./config');
const logger = require('./logger');
const db = require('./services/db');
const handlers = require('./handlers');
const commands = require('./commands');

async function start() {
  try {
    logger.info('Starting Telegram Context Assistant Bot...');

    // Run database migrations
    logger.info('Running database migrations...');
    await db.runMigrations();
    logger.info('Database migrations completed');

    // Create Telegram bot
    const bot = new TelegramBot(config.TELEGRAM_BOT_TOKEN, {
      polling: true
    });

    logger.info('Bot instance created');

    // Register message handler
    bot.on('message', (msg) => handlers.handleMessage(bot, msg));

    // Register callback query handler
    bot.on('callback_query', (query) => handlers.handleCallback(bot, query));

    // Register command handlers
    bot.onText(/\/analyze/, (msg) => commands.handleAnalyze(bot, msg));
    bot.onText(/\/clear/, (msg) => commands.handleClear(bot, msg));
    bot.onText(/\/help/, (msg) => commands.handleHelp(bot, msg));
    bot.onText(/\/start/, (msg) => commands.handleHelp(bot, msg));

    // Set bot commands menu
    await bot.setMyCommands([
      { command: 'analyze', description: 'Анализировать переписку' },
      { command: 'clear', description: 'Очистить буфер' },
      { command: 'help', description: 'Помощь' }
    ]);

    logger.info('Bot commands menu set');

    // Handle polling errors
    bot.on('polling_error', (error) => {
      logger.error('Polling error', { error: error.message });
    });

    logger.info('Bot is running...');

    // Graceful shutdown
    const shutdown = async () => {
      logger.info('Shutting down...');
      await bot.stopPolling();
      await db.close();
      logger.info('Shutdown complete');
      process.exit(0);
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

  } catch (error) {
    logger.error('Failed to start bot', { error: error.message });
    process.exit(1);
  }
}

// Start the bot
start();
