import pino from 'pino';
import { config, isProd } from './config.js';

export const logger = pino({
  // LOG_LEVEL lets a test run surface server errors without editing code.
  level: process.env.LOG_LEVEL ?? (config.NODE_ENV === 'test' ? 'silent' : 'info'),
  ...(isProd
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
});
