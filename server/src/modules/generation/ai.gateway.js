import { z } from 'zod';
import { config } from '../../platform/config.js';
import { logger } from '../../platform/logger.js';

// The one place that knows about the vendor. Domain code sees only
// generateFlashcards(); swapping providers means editing this file alone.
// Provider: Groq — OpenAI-compatible chat completions, so only the endpoint,
// key, and model differ from the wire format below.

export const rawCardSchema = z.object({
  question: z.string().min(5).max(500),
  answer: z.string().min(1).max(2000),
});

const PROMPT = `You are a study assistant creating flashcards from academic material.

Read the following excerpt and produce flashcards that test understanding, not
just recognition. Prefer "why" and "how" questions over bare definitions when
the material allows it. Cover the most important concepts; skip filler.

Rules:
- Each question must be answerable from the excerpt alone.
- Answers are concise (1–3 sentences).
- Questions must not reference "the excerpt" or "the text".

Return JSON only, in this exact shape:
{"cards": [{"question": "...", "answer": "..."}]}

Excerpt:
"""
{{TEXT}}
"""`;

export async function generateFlashcards(text, { maxCards = 20 } = {}) {
  if (!config.GROQ_API_KEY) {
    throw new Error('AI generation is not configured (GROQ_API_KEY is missing).');
  }

  // gpt-oss is a reasoning model: it emits a `reasoning` field before
  // `content`. If we don't give it room for both, it can spend its whole
  // budget reasoning and hand back an empty `content` — which looks like a
  // provider failure. Ask for enough tokens and retry once on empty output.
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch(`${config.GROQ_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: config.GROQ_MODEL,
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [{ role: 'user', content: PROMPT.replace('{{TEXT}}', text) }],
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      lastErr = new Error(`AI provider returned ${res.status}: ${body.slice(0, 200)}`);
      // only worth retrying transient statuses
      if (res.status === 429 || res.status >= 500) continue;
      throw lastErr;
    }

    const data = await res.json();
    const usage = data.usage ?? {};
    logger.info(
      { model: config.GROQ_MODEL, promptTokens: usage.prompt_tokens, completionTokens: usage.completion_tokens },
      'ai generation call',
    );

    const content = data.choices?.[0]?.message?.content;
    try {
      return parseCards(content, maxCards);
    } catch (err) {
      lastErr = err;
      logger.warn({ err: err.message, attempt }, 'unusable AI response, retrying');
    }
  }
  throw lastErr;
}

// Provider output is untrusted: parse defensively, validate, cap.
export function parseCards(content, maxCards) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    throw new Error('AI returned a malformed response (not JSON).');
  }

  const list = Array.isArray(parsed) ? parsed : parsed.cards;
  if (!Array.isArray(list)) throw new Error('AI response did not contain a cards array.');

  const cards = [];
  for (const item of list) {
    const result = rawCardSchema.safeParse(item);
    if (result.success) cards.push(result.data);
    // invalid entries are dropped, not fatal — one bad card shouldn't kill a run
    if (cards.length >= maxCards) break;
  }

  if (cards.length === 0) throw new Error('AI returned no usable cards for this section.');
  return cards;
}
