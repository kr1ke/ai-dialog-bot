-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY,
  user_id BIGINT UNIQUE NOT NULL,
  state VARCHAR(50) NOT NULL,
  messages JSONB DEFAULT '[]',
  last_instruction TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Statistics table
CREATE TABLE IF NOT EXISTS statistics (
  id SERIAL PRIMARY KEY,
  user_id BIGINT NOT NULL,
  action_type VARCHAR(100) NOT NULL,
  action_data JSONB,
  session_messages_count INT,
  model_used VARCHAR(100),
  tokens_used INT,
  response_time_ms INT,
  error_occurred BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Logs table
CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY,
  level VARCHAR(20) NOT NULL,
  message TEXT NOT NULL,
  context JSONB,
  created_at TIMESTAMP DEFAULT NOW()
);
