const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');
const config = require('../config');
const logger = require('../logger');

const pool = new Pool({
  connectionString: config.DATABASE_URL
});

// Generic query function
async function query(sql, params = []) {
  try {
    const result = await pool.query(sql, params);
    return result;
  } catch (error) {
    logger.error('Database query failed', { sql, error: error.message });
    throw error;
  }
}

// Run migrations from migrations/ folder
async function runMigrations() {
  try {
    const migrationsDir = path.join(__dirname, '../../migrations');
    const files = await fs.readdir(migrationsDir);
    const sqlFiles = files.filter(f => f.endsWith('.sql')).sort();

    for (const file of sqlFiles) {
      const filePath = path.join(migrationsDir, file);
      const sql = await fs.readFile(filePath, 'utf-8');
      await pool.query(sql);
      logger.info(`Migration ${file} executed successfully`);
    }
  } catch (error) {
    logger.error('Migration failed', { error: error.message });
    throw error;
  }
}

// Get session for a user
async function getSession(userId) {
  try {
    const result = await pool.query(
      'SELECT * FROM sessions WHERE user_id = $1',
      [userId]
    );
    return result.rows[0] || null;
  } catch (error) {
    logger.error('Get session failed', { userId, error: error.message });
    throw error;
  }
}

// Create new session
async function createSession(userId, state = 'collecting') {
  try {
    const result = await pool.query(
      `INSERT INTO sessions (user_id, state, messages, created_at, updated_at)
       VALUES ($1, $2, '[]', NOW(), NOW())
       RETURNING *`,
      [userId, state]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Create session failed', { userId, error: error.message });
    throw error;
  }
}

// Ensure session exists (upsert - handles race conditions)
async function ensureSession(userId, state = 'collecting') {
  try {
    const result = await pool.query(
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
      [userId, state]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Ensure session failed', { userId, error: error.message });
    throw error;
  }
}

// Reset existing session (clears all messages)
async function resetSession(userId, state = 'collecting') {
  try {
    const result = await pool.query(
      `UPDATE sessions
       SET state = $1, messages = '[]', last_instruction = NULL, last_message_id = NULL, updated_at = NOW()
       WHERE user_id = $2
       RETURNING *`,
      [state, userId]
    );
    return result.rows[0];
  } catch (error) {
    logger.error('Reset session failed', { userId, error: error.message });
    throw error;
  }
}

// Get or create session atomically
async function getOrCreateSession(userId, state = 'collecting') {
  try {
    const result = await pool.query(
      `INSERT INTO sessions (user_id, state, messages, created_at, updated_at)
       VALUES ($1, $2, '[]', NOW(), NOW())
       ON CONFLICT (user_id)
       DO NOTHING
       RETURNING *`,
      [userId, state]
    );

    // If inserted, return new session, otherwise get existing
    if (result.rows.length > 0) {
      return result.rows[0];
    } else {
      return await getSession(userId);
    }
  } catch (error) {
    logger.error('Get or create session failed', { userId, error: error.message });
    throw error;
  }
}

// Update session
async function updateSession(userId, data) {
  try {
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
    if (data.last_message_id !== undefined) {
      updates.push(`last_message_id = $${paramIndex++}`);
      values.push(data.last_message_id);
    }

    updates.push(`updated_at = NOW()`);
    values.push(userId);

    const sql = `UPDATE sessions SET ${updates.join(', ')} WHERE user_id = $${paramIndex} RETURNING *`;
    const result = await pool.query(sql, values);
    return result.rows[0];
  } catch (error) {
    logger.error('Update session failed', { userId, error: error.message });
    throw error;
  }
}

// Delete session
async function deleteSession(userId) {
  try {
    await pool.query('DELETE FROM sessions WHERE user_id = $1', [userId]);
  } catch (error) {
    logger.error('Delete session failed', { userId, error: error.message });
    throw error;
  }
}

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

// Log action to statistics table
async function logAction(statsData) {
  try {
    const {
      userId,
      actionType,
      actionData = null,
      sessionMessagesCount = null,
      modelUsed = null,
      tokensUsed = null,
      responseTimeMs = null,
      errorOccurred = false,
      errorMessage = null
    } = statsData;

    await pool.query(
      `INSERT INTO statistics
       (user_id, action_type, action_data, session_messages_count, model_used, tokens_used, response_time_ms, error_occurred, error_message)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        userId,
        actionType,
        actionData ? JSON.stringify(actionData) : null,
        sessionMessagesCount,
        modelUsed,
        tokensUsed,
        responseTimeMs,
        errorOccurred,
        errorMessage
      ]
    );
  } catch (error) {
    logger.error('Log action failed', { statsData, error: error.message });
    // Don't throw - logging shouldn't break the main flow
  }
}

// Log to database logs table
async function logToDb(level, message, context = {}) {
  try {
    await pool.query(
      'INSERT INTO logs (level, message, context) VALUES ($1, $2, $3)',
      [level, message, JSON.stringify(context)]
    );
  } catch (error) {
    logger.error('Log to DB failed', { error: error.message });
    // Don't throw - logging shouldn't break the main flow
  }
}

// Close database connection
async function close() {
  await pool.end();
  logger.info('Database connection closed');
}

module.exports = {
  query,
  runMigrations,
  getSession,
  createSession,
  ensureSession,
  resetSession,
  getOrCreateSession,
  updateSession,
  deleteSession,
  addMessageToSession,
  logAction,
  logToDb,
  close
};
