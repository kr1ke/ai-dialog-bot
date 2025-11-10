const db = require('./services/db');
const logger = require('./logger');

// Handle /analyze command
async function handleAnalyze(bot, msg) {
  const userId = msg.from.id;

  try {
    const session = await db.getSession(userId);

    if (!session || session.messages.length === 0) {
      await bot.sendMessage(userId, '❌ Нет сообщений в буфере');
      return;
    }

    // Update session state
    await db.updateSession(userId, { state: 'waiting_action' });

    // Send message with action buttons
    await bot.sendMessage(
      userId,
      `📊 В буфере ${session.messages.length} сообщений.\n\nВыбери действие:`,
      {
        reply_markup: {
          inline_keyboard: [
            [{ text: '📝 Резюме', callback_data: 'summary' }],
            [
              { text: '💼 Официально', callback_data: 'formal' },
              { text: '😊 Дружески', callback_data: 'friendly' }
            ],
            [{ text: '🗑 Очистить', callback_data: 'clear' }]
          ]
        }
      }
    );

    // Log statistics
    await db.logAction({
      userId,
      actionType: 'analyze_clicked',
      sessionMessagesCount: session.messages.length
    });
  } catch (error) {
    logger.error('Analyze command failed', { userId, error: error.message });
    await bot.sendMessage(userId, '❌ Сервис временно недоступен, попробуй позже');
    await db.logAction({ userId, actionType: 'analyze_error', errorOccurred: true });
  }
}

// Handle /clear command
async function handleClear(bot, msg) {
  const userId = msg.from.id;

  try {
    await db.deleteSession(userId);
    await bot.sendMessage(userId, '🗑 Буфер очищен');

    // Log statistics
    await db.logAction({
      userId,
      actionType: 'clear_command'
    });
  } catch (error) {
    logger.error('Clear command failed', { userId, error: error.message });
    await bot.sendMessage(userId, '❌ Сервис временно недоступен, попробуй позже');
    await db.logAction({ userId, actionType: 'clear_error', errorOccurred: true });
  }
}

// Handle /help command
async function handleHelp(bot, msg) {
  const userId = msg.from.id;

  try {
    const helpText = `🤖 Telegram Context Assistant Bot

Я помогаю анализировать переписки и составлять ответы.

📖 Как пользоваться:

1️⃣ Перешли мне сообщения из диалога (один или несколько)
2️⃣ Используй команду /analyze
3️⃣ Выбери действие:
   • 📝 Резюме - краткое содержание переписки
   • 💼 Официально - помощь с формальным ответом
   • 😊 Дружески - помощь с дружеским ответом
   • Или напиши свою инструкцию

4️⃣ Получи результат и используй 🔄 для других вариантов

⚙️ Команды:
/analyze - Анализировать собранные сообщения
/clear - Очистить буфер сообщений
/help - Показать это сообщение

💡 Совет: Я определяю, какие сообщения написал ты, а какие - собеседник.`;

    await bot.sendMessage(userId, helpText);

    // Log statistics
    await db.logAction({
      userId,
      actionType: 'help_command'
    });
  } catch (error) {
    logger.error('Help command failed', { userId, error: error.message });
    await db.logAction({ userId, actionType: 'help_error', errorOccurred: true });
  }
}

module.exports = {
  handleAnalyze,
  handleClear,
  handleHelp
};
