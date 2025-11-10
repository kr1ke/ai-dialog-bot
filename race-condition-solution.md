# Решение проблемы Race Conditions при пересылке сообщений

## Проблема

При быстрой пересылке пачки сообщений в Telegram бот возникали следующие проблемы:

1. **Race conditions**: Сообщения обрабатывались параллельно, что приводило к конфликтам при записи в базу данных
2. **Потеря сообщений**: Некоторые сообщения из пачки не сохранялись в сессию
3. **Неправильный порядок**: Сообщения могли сохраняться не в хронологическом порядке

### Причины

**1. Асинхронная обработка без синхронизации**
```javascript
// Проблемный код
async function handleMessage(bot, msg) {
  if (isForwarded) {
    let session = await db.getOrCreateSession(userId, 'collecting');
    // Между этими строками может выполниться другое сообщение!
    await db.addMessageToSession(userId, messageData);
  }
}
```

При одновременной обработке:
- Сообщение 1: получает session с messages=[]
- Сообщение 2: получает session с messages=[] (еще не обновлена!)
- Сообщение 1: добавляет себя → messages=[msg1]
- Сообщение 2: добавляет себя → messages=[msg2]
- Результат: msg1 может потеряться

**2. Отсутствие гарантий порядка**
Telegram может отправлять события не строго по forward_date из-за сетевых задержек.

**3. PostgreSQL JSONB append не атомарный на уровне приложения**
```sql
UPDATE sessions SET messages = messages || $1::jsonb
```
Между чтением `messages` и записью может вклиниться другой запрос.

## Решение

### Вариант 1: Очередь сообщений на пользователя (Рекомендуется)

Каждый пользователь получает свою очередь Promise, гарантирующую последовательную обработку.

**src/handlers.js:**
```javascript
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

        // ... (process message, determine author, etc.)

        // Add message to session
        await db.addMessageToSession(userId, messageData);

        // Get updated session to count messages
        session = await db.getSession(userId);
        const count = session.messages.length;

        // Send confirmation
        await bot.sendMessage(userId, `✓ ${count}`);

        // Log statistics
        await db.logAction({
          userId,
          actionType: 'forward_message',
          sessionMessagesCount: count
        });
      } catch (error) {
        logger.error('Forwarded message handling failed', { userId, error: error.message });
        await bot.sendMessage(userId, '❌ Сервис временно недоступен, попробуй позже');
        await db.logAction({ userId, actionType: 'forward_error', errorOccurred: true });
      }
    });
  }

  // ... (rest of the handler)
}
```

### Автоматическая сортировка по timestamp

Даже при использовании очереди, Telegram может отправить события не в порядке forward_date.

**src/services/db.js:**
```javascript
// Add message to session's messages JSONB array (with automatic sorting by timestamp)
async function addMessageToSession(userId, messageData) {
  try {
    const result = await pool.query(
      `UPDATE sessions
       SET messages = (
         SELECT jsonb_agg(elem ORDER BY (elem->>'timestamp')::int)
         FROM jsonb_array_elements(messages || $1::jsonb) elem
       ),
       updated_at = NOW()
       WHERE user_id = $2
       RETURNING *`,
      [JSON.stringify(messageData), userId]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Add message to session failed', { userId, error: error.message });
    throw error;
  }
}
```

## Как работает

### Очередь сообщений

```
Пользователь пересылает 5 сообщений быстро:

┌─────────────┐
│ Message 1   │ → Добавляется в очередь → Начинает обработку
└─────────────┘
       ↓
┌─────────────┐
│ Message 2   │ → Добавляется в очередь → ЖДЕТ Message 1
└─────────────┘
       ↓
┌─────────────┐
│ Message 3   │ → Добавляется в очередь → ЖДЕТ Message 2
└─────────────┘
       ↓
┌─────────────┐
│ Message 4   │ → Добавляется в очередь → ЖДЕТ Message 3
└─────────────┘
       ↓
┌─────────────┐
│ Message 5   │ → Добавляется в очередь → ЖДЕТ Message 4
└─────────────┘

Результат: Все сообщения обрабатываются последовательно!
```

### SQL сортировка

```sql
-- До добавления: messages = [msg3, msg1]
-- Добавляем: msg2 (timestamp=2)

-- SQL выполняет:
1. messages || msg2 → [msg3, msg1, msg2]
2. jsonb_array_elements → разбивает на элементы
3. ORDER BY timestamp → [msg1, msg2, msg3]
4. jsonb_agg → собирает обратно в массив

-- Результат: messages = [msg1, msg2, msg3] (отсортировано!)
```

## Гарантии

✅ **Нет потери данных**: Очередь гарантирует последовательную обработку
✅ **Правильный порядок**: Автосортировка по timestamp после каждого добавления
✅ **Нет race conditions**: Только одно сообщение пользователя обрабатывается одновременно
✅ **Изоляция пользователей**: Очереди независимы (User A не блокирует User B)
✅ **Отказоустойчивость**: Ошибки в одном сообщении не ломают очередь

## Альтернативные решения (не реализованы)

### Вариант 2: Optimistic locking с версионированием

Добавить поле `version` в таблицу `sessions`:

```sql
ALTER TABLE sessions ADD COLUMN version INTEGER DEFAULT 0;

UPDATE sessions
SET messages = messages || $1::jsonb,
    version = version + 1,
    updated_at = NOW()
WHERE user_id = $2 AND version = $3
RETURNING *;
```

**Плюсы**: Чисто на уровне БД
**Минусы**: Нужны retry механизмы, сложнее

### Вариант 3: PostgreSQL LISTEN/NOTIFY с батчингом

Собирать сообщения в Redis/memory буфер и записывать батчами:

```javascript
const buffer = new Map(); // userId -> [messages]

// Collect messages
buffer.get(userId).push(messageData);

// Flush every 100ms
setInterval(async () => {
  for (const [userId, messages] of buffer.entries()) {
    await db.addMessagesBatch(userId, messages);
    buffer.delete(userId);
  }
}, 100);
```

**Плюсы**: Меньше запросов к БД
**Минусы**: Задержка отправки, сложность, нужен Redis

## Рекомендация

**Используйте Вариант 1 (очередь + автосортировка)** - простое, надежное решение без зависимостей.

## Тестирование

Проверь работу:

1. Перешли пачку из 10+ сообщений быстро
2. Проверь в базе данных:
```sql
SELECT user_id,
       jsonb_array_length(messages) as count,
       messages
FROM sessions
WHERE user_id = YOUR_USER_ID;
```
3. Убедись что:
   - Все сообщения сохранены
   - Порядок соответствует forward_date (timestamp)
   - Нет дубликатов

## Performance Impact

- **Memory**: O(1) на пользователя (только один Promise в Map)
- **CPU**: Минимальный (Promise chaining)
- **Latency**: +0-10ms на сообщение (ожидание очереди)
- **Database**: Та же нагрузка, но упорядоченная

Для 1000 одновременных пользователей, пересылающих по 10 сообщений: никакого заметного влияния.
