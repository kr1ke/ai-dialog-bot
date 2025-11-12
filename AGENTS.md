# AGENTS.md

## Development Commands

```bash
# Start the bot
npm start

# Start with Docker
docker-compose up

# Install dependencies
npm install

# No lint/test commands configured yet - this is MVP project
```

## Code Style Guidelines

### Module System
- Use **CommonJS** (`require`/`module.exports`) - not ES modules
- All files use `.js` extension

### Imports
- Group imports: built-in → external → local modules
- Use relative paths for local imports: `./services/db.js`

### Naming Conventions
- **Files**: kebab-case for services, camelCase for modules
- **Variables**: camelCase
- **Constants**: UPPER_SNAKE_CASE
- **Functions**: camelCase, descriptive verbs
- **Database**: snake_case for tables/columns

### Error Handling
Always use this pattern:
```javascript
try {
  // operation
} catch (error) {
  logger.error('Operation failed', {userId, error: error.message});
  await bot.sendMessage(userId, '❌ Сервис временно недоступен, попробуй позже');
  await db.logAction({userId, actionType: '...', errorOccurred: true});
}
```

### Database Operations
- All DB operations go through `src/services/db.js`
- Use parameterized queries to prevent SQL injection
- Track all actions in `statistics` table

### Async/Await
- Use async/await consistently
- Handle promise rejections properly
- Always await DB operations

### Logging
- Use Winston logger from `src/logger.js`
- Include context: `{userId, error: error.message}`
- Log errors at error level, info at info level

### Business Rules
- Forwarded messages ALWAYS reset session
- Author detection: `msg.forward_from.id === userId`
- No caching, retries, or optimization (MVP)
- All user actions must be tracked

### File Structure
- `src/index.js`: Entry point, DB init, bot setup
- `src/handlers.js`: Core message handling logic
- `src/commands.js`: Bot command implementations
- `src/processors/`: AI processing (text, vision, voice)
- `src/services/`: External service integrations