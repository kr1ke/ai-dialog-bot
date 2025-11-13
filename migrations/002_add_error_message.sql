-- Add error_message field to statistics table
ALTER TABLE statistics ADD COLUMN IF NOT EXISTS error_message TEXT;

-- Add last_message_id to sessions table (used for message editing)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS last_message_id BIGINT;
