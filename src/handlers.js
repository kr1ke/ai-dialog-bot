const db = require('./services/db');
const textProcessor = require('./processors/text');
const mediaProcessor = require('./processors/media');
const limitsValidator = require('./validators/limits');
const logger = require('./logger');

// Message processing queue per user (prevents race conditions)
const userQueues = new Map();

// Process message with queue to ensure sequential handling
async function processWithQueue(userId, handler) {
  if (!userQueues.has(userId)) {
    userQueues.set(userId, Promise.resolve());
  }

  const currentQueue = userQueues.get(userId);
  const newQueue = currentQueue.then(handler).catch(err => {
    logger.error('Queue processing failed', { userId, error: err.message });
  });

  userQueues.set(userId, newQueue);
  return newQueue;
}

// Handle incoming messages
async function handleMessage(bot, msg) {
  const userId = msg.from.id;
  const isForwarded = !!msg.forward_date;

  // Handle forwarded messages with queue to prevent race conditions
    if (isForwarded) {
      return processWithQueue(userId, async () => {
        try {
          // Get or create session atomically
          let session = await db.getOrCreateSession(userId, 'collecting');

          // If session is not in collecting state, reset it (new conversation)
          if (session.state !== 'collecting') {
            session = await db.resetSession(userId, 'collecting');
          }

          // Determine author
          let author;
          if (msg.forward_from) {
            author = {
              isUser: msg.forward_from.id === userId,
              name: msg.forward_from.first_name || 'Unknown',
              id: msg.forward_from.id
            };
          } else {
            // Forwarded from channel or hidden user
            author = {
              isUser: false,
              name: msg.forward_sender_name || 'Unknown',
              id: null
            };
          }

          // Process message type
          let messageData = {
            author,
            timestamp: msg.forward_date,
            metadata: {}
          };

          if (msg.text) {
            // Text message
            messageData.text = msg.text;
            messageData.type = 'text';
          } else if (msg.photo) {
            // Photo message - store file_id for processing
            const photo = msg.photo[msg.photo.length - 1]; // largest size
            messageData.text = '[Изображение]';
            messageData.type = 'image';
            messageData.metadata = {
              file_id: photo.file_id,
              file_size: photo.file_size,
              width: photo.width,
              height: photo.height
            };
          } else if (msg.voice) {
            // Voice message - store file_id for processing
            messageData.text = '[Голосовое сообщение]';
            messageData.type = 'voice';
            messageData.metadata = {
              file_id: msg.voice.file_id,
              file_size: msg.voice.file_size,
              duration: msg.voice.duration,
              mime_type: msg.voice.mime_type
            };
          } else if (msg.video) {
            // Video message - store as placeholder
            messageData.text = '[Видео]';
            messageData.type = 'video';
          } else if (msg.sticker) {
            // Sticker - store as placeholder
            messageData.text = '[Стикер]';
            messageData.type = 'sticker';
          } else if (msg.document) {
            // Document - store as placeholder
            messageData.text = '[Документ]';
            messageData.type = 'document';
          } else if (msg.audio) {
            // Audio file - store as placeholder
            messageData.text = '[Аудиофайл]';
            messageData.type = 'audio';
          } else if (msg.video_note) {
            // Video note (circle) - store as placeholder
            messageData.text = '[Видеосообщение]';
            messageData.type = 'video_note';
          } else {
            // Unsupported message type - skip silently
            logger.debug('Unsupported forwarded message type', { userId, msg });
            return;
          }

          // Validate limits BEFORE adding message
          const validation = limitsValidator.validateNewMessage(session, messageData);
          if (!validation.valid) {
            await bot.sendMessage(userId, validation.error);
            await db.logAction({
              userId,
              actionType: 'limit_exceeded',
              actionData: { limitType: validation.limitType },
              sessionMessagesCount: session.messages.length
            });
            return; // Stop processing
          }

          // Add message to session
          await db.addMessageToSession(userId, messageData);

          // Get updated session to count messages
          session = await db.getSession(userId);

          // Format progress message with limits
          const messageText = limitsValidator.formatProgressMessage(session);

          try {
            // Add /analyze button if there are messages
            const replyMarkup = session.messages.length > 0 ? {
              reply_markup: {
                inline_keyboard: [
                  [{ text: '📊 Анализировать', callback_data: '/analyze' }]
                ]
              }
            } : {};

            if (session.last_message_id) {
              // Try to edit existing message
              await bot.editMessageText(messageText, {
                chat_id: userId,
                message_id: session.last_message_id,
                ...replyMarkup
              });
            } else {
              // Send new message and save its ID
              const sentMessage = await bot.sendMessage(userId, messageText, replyMarkup);
              await db.updateSession(userId, { last_message_id: sentMessage.message_id });
            }
          } catch (error) {
            // Handle editing errors
            if (error.message.includes('message to edit not found') ||
                error.message.includes('message can\'t be edited') ||
                error.message.includes('MESSAGE_ID_INVALID')) {
              // Message was deleted or too old, send new one
              logger.warn('Message edit failed, sending new message', {
                userId,
                error: error.message,
                oldMessageId: session.last_message_id
              });
              const sentMessage = await bot.sendMessage(userId, messageText, {
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '📊 Анализировать', callback_data: '/analyze' }]
                  ]
                }
              });
              await db.updateSession(userId, { last_message_id: sentMessage.message_id });
            } else if (error.message.includes('message is not modified')) {
              // Text hasn't changed, ignore (shouldn't happen with counter but just in case)
              logger.debug('Message text not modified', { userId, messagesCount: session.messages.length });
            } else {
              // Unknown error, re-throw to outer catch
              throw error;
            }
          }

          // Log statistics
          await db.logAction({
            userId,
            actionType: 'forward_message',
            sessionMessagesCount: session.messages.length
          });
        } catch (error) {
          logger.error('Forwarded message handling failed', { userId, error: error.message });
          await bot.sendMessage(userId, '❌ Сервис временно недоступен, попробуй позже');
          await db.logAction({
            userId,
            actionType: 'forward_error',
            errorOccurred: true,
            errorMessage: error.message
          });
        }
      });
    }

  try {

    // Handle text messages (not commands, not forwarded)
    if (msg.text && !msg.text.startsWith('/')) {
      const session = await db.getSession(userId);

      if (!session) {
        await bot.sendMessage(userId, 'Переслай сообщения и используй /analyze');
        return;
      }

      if (session.state === 'collecting') {
        await bot.sendMessage(userId, '💡 Используй /analyze');
        return;
      }

      if (session.state === 'waiting_action' || session.state === 'conversation') {
        // Send typing indicator
        try {
          await bot.sendChatAction(userId, 'typing');
        } catch (error) {
          // Ignore - typing failures are non-critical
        }

        // Process custom request with multimodal support
        const { result, metadata } = await mediaProcessor.processMultimodalContext(
          bot,
          session.messages,
          msg.text,
          userId
        );

        // Send response with regenerate button
        await bot.sendMessage(userId, result, {
          reply_markup: {
            inline_keyboard: [
              [{ text: '🔄 Еще варианты', callback_data: 'regenerate' }]
            ]
          }
        });

        // Update session
        await db.updateSession(userId, {
          state: 'conversation',
          last_instruction: msg.text
        });

        // Log statistics
        await db.logAction({
          userId,
          actionType: 'custom_request',
          sessionMessagesCount: session.messages.length,
          modelUsed: metadata.model,
          tokensUsed: metadata.tokens,
          responseTimeMs: metadata.responseTime
        });
      }
    }
  } catch (error) {
    logger.error('Message handling failed', { userId, error: error.message });
    await bot.sendMessage(userId, '❌ Сервис временно недоступен, попробуй позже');
    await db.logAction({
      userId,
      actionType: 'message_error',
      errorOccurred: true,
      errorMessage: error.message
    });
  }
}

// Handle callback queries (button clicks)
async function handleCallback(bot, query) {
  const userId = query.from.id;
  const action = query.data;

  try {
    const session = await db.getSession(userId);

    if (!session) {
      await bot.answerCallbackQuery(query.id, {
        text: '❌ Сессия истекла',
        show_alert: true
      });
      return;
    }

    // Handle /analyze button
    if (action === '/analyze') {
      // Call analyze command handler
      const commands = require('./commands');
      await commands.handleAnalyze(bot, { from: { id: userId } });
      await bot.answerCallbackQuery(query.id);
      return;
    }

    // Handle different actions
    if (action === 'summary' || action === 'formal' || action === 'friendly') {
      // Send typing indicator
      try {
        await bot.sendChatAction(userId, 'typing');
      } catch (error) {
        // Ignore - typing failures are non-critical
      }

      // Process with predefined instruction using multimodal processor
      const { result, metadata } = await mediaProcessor.processMultimodalContext(
        bot,
        session.messages,
        action,
        userId
      );

      // Send response
      await bot.sendMessage(userId, result, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Еще варианты', callback_data: 'regenerate' }]
          ]
        }
      });

      // Update session
      await db.updateSession(userId, {
        state: 'conversation',
        last_instruction: action
      });

      // Log statistics
      await db.logAction({
        userId,
        actionType: `button_${action}`,
        sessionMessagesCount: session.messages.length,
        modelUsed: metadata.model,
        tokensUsed: metadata.tokens,
        responseTimeMs: metadata.responseTime
      });

      await bot.answerCallbackQuery(query.id);
    } else if (action === 'clear') {
      // Clear session
      await db.deleteSession(userId);
      await bot.sendMessage(userId, '🗑 Буфер очищен');
      await db.logAction({
        userId,
        actionType: 'button_clear'
      });

      await bot.answerCallbackQuery(query.id);
    } else if (action === 'regenerate') {
      // Regenerate with last instruction
      if (!session.last_instruction) {
        await bot.answerCallbackQuery(query.id, {
          text: '❌ Нет предыдущей инструкции',
          show_alert: true
        });
        return;
      }

      // Send typing indicator
      try {
        await bot.sendChatAction(userId, 'typing');
      } catch (error) {
        // Ignore - typing failures are non-critical
      }

      const { result, metadata } = await mediaProcessor.processMultimodalContext(
        bot,
        session.messages,
        session.last_instruction,
        userId
      );

      // Send response
      await bot.sendMessage(userId, result, {
        reply_markup: {
          inline_keyboard: [
            [{ text: '🔄 Еще варианты', callback_data: 'regenerate' }]
          ]
        }
      });

      // Log statistics
      await db.logAction({
        userId,
        actionType: 'regenerate',
        sessionMessagesCount: session.messages.length,
        modelUsed: metadata.model,
        tokensUsed: metadata.tokens,
        responseTimeMs: metadata.responseTime
      });

      await bot.answerCallbackQuery(query.id);
    }
  } catch (error) {
    logger.error('Callback handling failed', { userId, action, error: error.message });
    await bot.answerCallbackQuery(query.id, {
      text: '❌ Сервис временно недоступен',
      show_alert: true
    });
    await db.logAction({
      userId,
      actionType: 'callback_error',
      errorOccurred: true,
      errorMessage: error.message
    });
  }
}

module.exports = {
  handleMessage,
  handleCallback
};
