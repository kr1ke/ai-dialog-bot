# Реализация редактирования сообщений при пересылке

## Цель
Вместо отправки нового сообщения при каждой пересылке, отправлять ОДНО сообщение и редактировать его при последующих пересылках с обновленным счетчиком.

## Текущее поведение
**Проблема**: При каждой пересылке сообщения бот отправляет новое сообщение `"✓ {count}"` (handlers.js:97), что засоряет чат.

**Пример сейчас:**
```
User: [пересылает сообщение 1]
Bot: ✓ 1

User: [пересылает сообщение 2]
Bot: ✓ 2

User: [пересылает сообщение 3]
Bot: ✓ 3
```

## Желаемое поведение
**Решение**: Отправить одно сообщение и редактировать его при последующих пересылках.

**Пример после реализации:**
```
User: [пересылает сообщение 1]
Bot: 📝 Накоплено сообщений: 1

User: [пересылает сообщение 2]
Bot: 📝 Накоплено сообщений: 2  ← редактируется предыдущее сообщение

User: [пересылает сообщение 3]
Bot: 📝 Накоплено сообщений: 3  ← редактируется то же сообщение
```

## Технический план

### 1. База данных

#### 1.1 Статус миграции
✅ **Миграция уже применена**: `migrations/002_add_message_id.sql.applied`
- Файл существует, но имеет расширение `.applied` (не будет применяться повторно)
- Содержит: `ALTER TABLE sessions ADD COLUMN last_message_id INTEGER;`
- Поле `last_message_id` уже добавлено в таблицу sessions

#### 1.2 Схема таблицы sessions
```sql
CREATE TABLE sessions (
  id SERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE NOT NULL,
  state VARCHAR(50) NOT NULL,
  messages JSONB DEFAULT '[]',
  last_instruction TEXT,
  last_message_id INTEGER,  -- ← уже добавлено миграцией
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### 1.3 Обновление функций базы данных

**Файл**: `src/services/db.js`

**Изменения в функции `updateSession()` (строки 135-164)**:

Текущий код:
```javascript
async function updateSession(userId, data) {
  const updates = [];
  const values = [];
  let paramIndex = 1;

  if (data.state !== undefined) {
    updates.push(`state = $${paramIndex++}`);
    values.push(data.state);
  }
  if (data.messages !== undefined) {
    updates.push(`messages = $${paramIndex++}`);
    values.push(JSON.stringify(data.messages));
  }
  if (data.last_instruction !== undefined) {
    updates.push(`last_instruction = $${paramIndex++}`);
    values.push(data.last_instruction);
  }

  updates.push(`updated_at = NOW()`);
  values.push(userId);

  const sql = `UPDATE sessions SET ${updates.join(', ')} WHERE user_id = $${paramIndex} RETURNING *`;
  const result = await pool.query(sql, values);
  return result.rows[0];
}
```

Добавить поддержку `last_message_id`:
```javascript
// После строки 152 (после last_instruction) добавить:
if (data.last_message_id !== undefined) {
  updates.push(`last_message_id = $${paramIndex++}`);
  values.push(data.last_message_id);
}
```

**Изменения в функции `resetSession()` (строки 94-108)**:

Текущий SQL:
```sql
UPDATE sessions
SET state = $1, messages = '[]', last_instruction = NULL, updated_at = NOW()
WHERE user_id = $2
RETURNING *
```

Добавить сброс `last_message_id`:
```sql
UPDATE sessions
SET state = $1, messages = '[]', last_instruction = NULL, last_message_id = NULL, updated_at = NOW()
WHERE user_id = $2
RETURNING *
```

**Изменения в функции `ensureSession()` (строки 72-91)**:

Текущий SQL:
```sql
INSERT INTO sessions (user_id, state, messages, created_at, updated_at)
VALUES ($1, $2, '[]', NOW(), NOW())
ON CONFLICT (user_id)
DO UPDATE SET
  state = EXCLUDED.state,
  messages = '[]',
  last_instruction = NULL,
  updated_at = NOW()
RETURNING *
```

Добавить сброс `last_message_id`:
```sql
INSERT INTO sessions (user_id, state, messages, created_at, updated_at)
VALUES ($1, $2, '[]', NOW(), NOW())
ON CONFLICT (user_id)
DO UPDATE SET
  state = EXCLUDED.state,
  messages = '[]',
  last_instruction = NULL,
  last_message_id = NULL,  -- ← добавить
  updated_at = NOW()
RETURNING *
```

### 2. Обработчики сообщений

#### 2.1 Изменения в handlers.js

**Файл**: `src/handlers.js`
**Строки для изменения**: 90-97

**Текущая логика (строки 90-97):**
```javascript
// Add message to session
await db.addMessageToSession(userId, messageData);

// Get updated session to count messages
session = await db.getSession(userId);
const count = session.messages.length;

// Send confirmation
await bot.sendMessage(userId, `✓ ${count}`);
```

**Новая логика:**
```javascript
// Add message to session
await db.addMessageToSession(userId, messageData);

// Get updated session to count messages
session = await db.getSession(userId);
const count = session.messages.length;

// Send or edit confirmation message
const messageText = `📝 Накоплено сообщений: ${count}`;

try {
  if (session.last_message_id) {
    // Try to edit existing message
    await bot.editMessageText(messageText, {
      chat_id: userId,
      message_id: session.last_message_id
    });
  } else {
    // Send new message and save its ID
    const sentMessage = await bot.sendMessage(userId, messageText);
    await db.updateSession(userId, { last_message_id: sentMessage.message_id });
  }
} catch (error) {
  // Handle editing errors
  if (error.message.includes('message to edit not found') ||
      error.message.includes('message can\'t be edited') ||
      error.message.includes('MESSAGE_ID_INVALID')) {
    // Message was deleted or too old, send new one
    const sentMessage = await bot.sendMessage(userId, messageText);
    await db.updateSession(userId, { last_message_id: sentMessage.message_id });
  } else if (error.message.includes('message is not modified')) {
    // Text hasn't changed, ignore (shouldn't happen with counter)
    // Do nothing
  } else {
    // Unknown error, re-throw
    throw error;
  }
}
```

### 3. Сценарии работы

#### 3.1 Первое пересланное сообщение
1. User пересылает сообщение
2. Session создается в состоянии `'collecting'`
3. Сообщение добавляется в JSONB массив
4. `session.last_message_id === null`
5. Bot отправляет новое сообщение: `"📝 Накоплено сообщений: 1"`
6. ID сообщения сохраняется в `session.last_message_id`

#### 3.2 Последующие пересланные сообщения
1. User пересылает еще одно сообщение
2. Session уже существует в состоянии `'collecting'`
3. Сообщение добавляется в JSONB массив
4. `session.last_message_id` содержит ID предыдущего сообщения
5. Bot редактирует предыдущее сообщение: `"📝 Накоплено сообщений: 2"`
6. ID сообщения остается прежним

#### 3.3 Новая сессия (новый собеседник)
1. User пересылает сообщение от другого автора
2. В `handlers.js:37-40` проверяется состояние сессии
3. Если `session.state !== 'collecting'`, вызывается `resetSession()`
4. `resetSession()` сбрасывает `last_message_id = NULL`
5. Bot отправляет НОВОЕ сообщение: `"📝 Накоплено сообщений: 1"`
6. Новый ID сохраняется

#### 3.4 Сообщение удалено пользователем
1. User пересылает сообщение
2. Bot пытается редактировать `session.last_message_id`
3. Telegram API возвращает ошибку: `"message to edit not found"`
4. В `catch` блоке отправляется новое сообщение
5. Новый ID сохраняется в `session.last_message_id`

#### 3.5 Сообщение слишком старое (>48 часов)
1. User пересылает сообщение после 48+ часов
2. Bot пытается редактировать старое сообщение
3. Telegram API возвращает ошибку: `"message can't be edited"`
4. В `catch` блоке отправляется новое сообщение
5. Новый ID сохраняется

### 4. Обработка ошибок Telegram API

#### 4.1 Типы ошибок `bot.editMessageText()`

| Ошибка | Причина | Решение |
|--------|---------|---------|
| `message to edit not found` | Сообщение удалено пользователем | Отправить новое |
| `message can't be edited` | Сообщение старше 48 часов | Отправить новое |
| `MESSAGE_ID_INVALID` | Невалидный ID | Отправить новое |
| `message is not modified` | Текст не изменился | Игнорировать |
| Other | Неизвестная ошибка | Пробросить выше |

#### 4.2 Логирование ошибок

При отправке нового сообщения после ошибки редактирования:
```javascript
logger.warn('Message edit failed, sent new message', {
  userId,
  error: error.message,
  oldMessageId: session.last_message_id,
  newMessageId: sentMessage.message_id
});
```

### 5. Текст сообщений

#### 5.1 Формат
```
📝 Накоплено сообщений: {count}
```

#### 5.2 Обоснование
- **Эмодзи 📝**: Визуально выделяет сообщение, понятный символ "документ/заметка"
- **"Накоплено"**: Показывает процесс аккумуляции
- **"сообщений"**: Явно указывает единицу измерения
- **Счетчик**: Динамически обновляется

#### 5.3 Варианты (для обсуждения)
- `📨 Собрано сообщений: {count}`
- `💬 Сообщений в памяти: {count}`
- `📥 Добавлено сообщений: {count}`

### 6. Влияние на race conditions

#### 6.1 Текущая защита (handlers.js:7-23)
```javascript
const userQueues = new Map();

async function processWithQueue(userId, handler) {
  if (!userQueues.has(userId)) {
    userQueues.set(userId, Promise.resolve());
  }
  const currentQueue = userQueues.get(userId);
  const newQueue = currentQueue.then(handler).catch(err => {...});
  userQueues.set(userId, newQueue);
  return newQueue;
}
```

#### 6.2 Совместимость с редактированием
✅ **Полная совместимость**:
- Все операции выполняются последовательно для каждого пользователя
- `bot.editMessageText()` вызывается внутри `processWithQueue()`
- Невозможна ситуация, когда два редактирования происходят одновременно
- База данных обновляется атомарно через `updateSession()`

### 7. Порядок реализации

#### Шаг 1: Обновить db.js
1. ✅ Убедиться, что миграция применена (поле `last_message_id` существует)
2. Обновить `updateSession()` - добавить поддержку `last_message_id`
3. Обновить `resetSession()` - сбрасывать `last_message_id = NULL`
4. Обновить `ensureSession()` - сбрасывать `last_message_id = NULL`

#### Шаг 2: Обновить handlers.js
1. Изменить логику в строках 90-97
2. Заменить `bot.sendMessage()` на логику send/edit с try-catch
3. Добавить обработку ошибок редактирования

#### Шаг 3: Тестирование
1. Запустить бот: `docker-compose up`
2. Переслать 1 сообщение → проверить новое сообщение
3. Переслать 2-е сообщение → проверить редактирование
4. Удалить сообщение бота → переслать 3-е → проверить новое сообщение
5. Переслать сообщение от другого автора → проверить сброс и новое сообщение
6. Быстро переслать 10 сообщений → проверить корректность счетчика

#### Шаг 4: Верификация
1. Проверить логи Winston на ошибки
2. Проверить таблицу `statistics` на наличие записей
3. Проверить таблицу `sessions` - поле `last_message_id` обновляется
4. Проверить UI чата - только одно сообщение со счетчиком

### 8. Риски и ограничения

#### 8.1 Telegram API лимиты
- ⚠️ **48 часов**: Сообщения старше 48 часов нельзя редактировать
- ✅ **Решение**: Отправка нового сообщения при ошибке

#### 8.2 Удаление сообщения пользователем
- ⚠️ **Проблема**: User может удалить сообщение бота
- ✅ **Решение**: Обработка ошибки и отправка нового

#### 8.3 Производительность
- ✅ **Улучшение**: Меньше сообщений = меньше нагрузка на API
- ✅ **Улучшение**: Редактирование быстрее отправки

#### 8.4 UX
- ✅ **Улучшение**: Чат не засоряется множеством сообщений
- ✅ **Улучшение**: Понятный счетчик накопленных сообщений

### 9. Дальнейшие улучшения (optional)

#### 9.1 Расширенная информация
```
📝 Накоплено сообщений: 5
👤 Собеседник: Maria
📅 Последнее: 13:45
```

#### 9.2 Прогресс-бар
```
📝 Накоплено: 3 ▰▰▰▱▱▱▱▱▱▱
```

#### 9.3 Анимация (не рекомендуется)
- Telegram API не поддерживает анимацию текста
- Избыточные редактирования могут вызвать rate limit

### 10. Код для копирования

#### 10.1 db.js - updateSession() (вставить после строки 152)
```javascript
if (data.last_message_id !== undefined) {
  updates.push(`last_message_id = $${paramIndex++}`);
  values.push(data.last_message_id);
}
```

#### 10.2 db.js - resetSession() (заменить строку 98)
```javascript
`UPDATE sessions
 SET state = $1, messages = '[]', last_instruction = NULL, last_message_id = NULL, updated_at = NOW()
 WHERE user_id = $2
 RETURNING *`,
```

#### 10.3 db.js - ensureSession() (заменить строки 75-82)
```javascript
`INSERT INTO sessions (user_id, state, messages, created_at, updated_at)
 VALUES ($1, $2, '[]', NOW(), NOW())
 ON CONFLICT (user_id)
 DO UPDATE SET
   state = EXCLUDED.state,
   messages = '[]',
   last_instruction = NULL,
   last_message_id = NULL,
   updated_at = NOW()
 RETURNING *`,
```

#### 10.4 handlers.js - полная замена строк 90-97
```javascript
// Add message to session
await db.addMessageToSession(userId, messageData);

// Get updated session to count messages
session = await db.getSession(userId);
const count = session.messages.length;

// Send or edit confirmation message
const messageText = `📝 Накоплено сообщений: ${count}`;

try {
  if (session.last_message_id) {
    // Try to edit existing message
    await bot.editMessageText(messageText, {
      chat_id: userId,
      message_id: session.last_message_id
    });
  } else {
    // Send new message and save its ID
    const sentMessage = await bot.sendMessage(userId, messageText);
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
    const sentMessage = await bot.sendMessage(userId, messageText);
    await db.updateSession(userId, { last_message_id: sentMessage.message_id });
  } else if (error.message.includes('message is not modified')) {
    // Text hasn't changed, ignore (shouldn't happen with counter but just in case)
    logger.debug('Message text not modified', { userId, count });
  } else {
    // Unknown error, re-throw to outer catch
    throw error;
  }
}
```

## Резюме

**Что меняется:**
1. ✅ База данных уже готова (миграция применена)
2. 🔧 Обновить 3 функции в `db.js` для поддержки `last_message_id`
3. 🔧 Заменить 8 строк в `handlers.js` на 30 строк с логикой send/edit
4. ✅ Race conditions уже защищены очередью
5. ✅ Все ошибки обрабатываются корректно

**Преимущества:**
- Чище UI (одно сообщение вместо множества)
- Меньше нагрузка на API
- Понятный текст со счетчиком
- Полная обратная совместимость

**Риски:**
- Минимальные (все ошибки обрабатываются)
- Fallback на отправку нового сообщения всегда работает
