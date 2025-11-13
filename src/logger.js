const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const config = require('./config');

// Custom transport for logging to database
class DatabaseTransport extends winston.Transport {
  constructor(opts) {
    super(opts);
    this.name = 'database';
    this.level = opts.level || 'error';
  }

  log(info, callback) {
    setImmediate(() => {
      this.emit('logged', info);
    });

    // Only log errors to database
    if (info.level === 'error') {
      // Lazy load db to avoid circular dependency
      const db = require('./services/db');

      const context = {
        ...info,
        timestamp: info.timestamp,
        stack: info.stack
      };

      // Remove redundant fields
      delete context.level;
      delete context.message;

      db.logToDb(info.level, info.message, context).catch(err => {
        // Silently fail - don't want to break the app if DB logging fails
        console.error('Failed to log to database:', err.message);
      });
    }

    callback();
  }
}

const logger = winston.createLogger({
  level: config.LOG_LEVEL,
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple()
      )
    }),
    // Daily rotating file transport
    new DailyRotateFile({
      dirname: 'logs',
      filename: 'app-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxFiles: '14d',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    // Database transport (only errors)
    new DatabaseTransport({ level: 'error' })
  ]
});

module.exports = logger;
