import pino from 'pino';
import { config, isProd } from './config.js';

export const logger = pino({
  level: config.NODE_ENV === 'test' ? 'silent' : 'info',
  ...(isProd
    ? {}
    : { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }),
});
