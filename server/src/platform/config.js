import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

// Load .env manually so we don't add a dependency for it. Node >= 20.12 could
// use --env-file, but loading here keeps `npm test` and scripts uniform.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
try {
  for (const line of readFileSync(envPath, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (match && process.env[match[1]] === undefined) {
      process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
    }
  }
} catch {
  // no .env file — process.env alone must be enough
}

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  SESSION_SECRET: z.string().min(16, 'SESSION_SECRET must be at least 16 characters'),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Groq speaks the OpenAI wire format, so the gateway stays generic —
  // these are just the endpoint, key, and model (GroqDocs: OpenAI Compatibility).
  GROQ_API_KEY: z.string().optional(),
  GROQ_BASE_URL: z.string().url().default('https://api.groq.com/openai/v1'),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
});

const result = schema.safeParse(process.env);
if (!result.success) {
  console.error('Invalid configuration:');
  for (const issue of result.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = result.data;
export const isProd = config.NODE_ENV === 'production';
