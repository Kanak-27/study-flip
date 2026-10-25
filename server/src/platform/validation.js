import { z } from 'zod';
import { badRequest } from './errors.js';

// One way to validate a request body across the API: throw a 400 with the
// first message the user can actually act on.
export function parseBody(schema, body) {
  const result = schema.safeParse(body);
  if (!result.success) throw badRequest(result.error.issues[0].message);
  return result.data;
}

export { z };
