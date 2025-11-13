const logger = require('../logger');

// Константы лимитов
const LIMITS = {
  MAX_MESSAGES_PER_SESSION: 50,
  MAX_IMAGES_PER_SESSION: 5,
  MAX_VOICE_PER_SESSION: 7,
  MAX_VOICE_DURATION_SECONDS: 60
};

// Сообщения об ошибках
const ERROR_MESSAGES = {
  MAX_MESSAGES: '⚠️ Достигнут лимит: максимум 50 сообщений в одной сессии.\nИспользуй /clear чтобы начать новую сессию.',
  MAX_IMAGES: '⚠️ Достигнут лимит: максимум 5 изображений в одной сессии.\nИспользуй /clear чтобы начать новую сессию.',
  MAX_VOICE: '⚠️ Достигнут лимит: максимум 7 голосовых сообщений в одной сессии.\nИспользуй /clear чтобы начать новую сессию.',
  VOICE_TOO_LONG: '⚠️ Голосовое сообщение слишком длинное.\nМаксимальная длительность: 1 минута (60 секунд).'
};

// Функция подсчета статистики сессии
function getSessionStats(session) {
  const messages = session.messages || [];
  return {
    totalMessages: messages.length,
    imagesCount: messages.filter(m => m.type === 'image').length,
    voiceCount: messages.filter(m => m.type === 'voice').length
  };
}

// Функция валидации нового сообщения
function validateNewMessage(session, messageData) {
  const stats = getSessionStats(session);
  
  // Проверка общего количества сообщений
  if (stats.totalMessages >= LIMITS.MAX_MESSAGES_PER_SESSION) {
    return {
      valid: false,
      error: ERROR_MESSAGES.MAX_MESSAGES,
      limitType: 'max_messages'
    };
  }
  
  // Проверка лимита изображений
  if (messageData.type === 'image') {
    if (stats.imagesCount >= LIMITS.MAX_IMAGES_PER_SESSION) {
      return {
        valid: false,
        error: ERROR_MESSAGES.MAX_IMAGES,
        limitType: 'max_images'
      };
    }
  }
  
  // Проверка лимита голосовых
  if (messageData.type === 'voice') {
    if (stats.voiceCount >= LIMITS.MAX_VOICE_PER_SESSION) {
      return {
        valid: false,
        error: ERROR_MESSAGES.MAX_VOICE,
        limitType: 'max_voice'
      };
    }
    
    // Проверка длительности голосового
    const duration = messageData.metadata?.duration || 0;
    if (duration > LIMITS.MAX_VOICE_DURATION_SECONDS) {
      return {
        valid: false,
        error: ERROR_MESSAGES.VOICE_TOO_LONG,
        limitType: 'voice_too_long'
      };
    }
  }
  
  return { valid: true, error: null, limitType: null };
}

// Функция форматирования подсказки со счетчиками
function formatProgressMessage(session) {
  const stats = getSessionStats(session);
  const parts = [];
  
  parts.push(`📝 Накоплено: ${stats.totalMessages}/${LIMITS.MAX_MESSAGES_PER_SESSION} сообщений`);
  
  if (stats.imagesCount > 0) {
    parts.push(`${stats.imagesCount}/${LIMITS.MAX_IMAGES_PER_SESSION} изображений`);
  }
  
  if (stats.voiceCount > 0) {
    parts.push(`${stats.voiceCount}/${LIMITS.MAX_VOICE_PER_SESSION} голосовых`);
  }
  
  const result = parts.join(', ');
  
  // Добавляем подсказку о возможности ввести свой запрос
  if (stats.totalMessages >= 1) {
    return result + '\n💡 Используй /analyze чтобы выбрать действие или ввести свой запрос';
  }
  
  return result;
}

module.exports = {
  LIMITS,
  validateNewMessage,
  getSessionStats,
  formatProgressMessage
};