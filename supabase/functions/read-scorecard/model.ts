// The port between `read-scorecard` and whatever reads the photos (#384).
//
// In production that is Claude Haiku 5.5, through Anthropic's API with the function's
// own key, asked for the card in `CARD_SCHEMA`. On the local stack it's `fakeReader`,
// which needs no key and costs nothing: a test writes the reading it wants, as JSON,
// in place of the first photo's bytes. Either way the function checks what comes back
// (`draftFrom`), so the fake can hand it unreadable and out-of-range values too.
//
// The SDK's version is pinned: every merge to main deploys this function. Nothing moves
// the pin on its own (Dependabot reads only the app's package.json), so it moves by hand.
import Anthropic from 'npm:@anthropic-ai/sdk@1.14.0';
import { CARD_SCHEMA, TEE_CARD_PROMPT, type CardImage } from './card.ts';

/** Reads one card from its photos into the schema's shape, unchecked. */
export type CardReader = (images: CardImage[]) => Promise<unknown>;

/** The reader ran but gave no card: it declined, was cut short, or wrote something that isn't JSON. */
export class NoReading extends Error {}

/**
 * The request never reached the model, so nothing was read or billed: it couldn't
 * connect, or Anthropic turned it away (overloaded, rate limited, or a request it
 * refused before reading). Only this gives the golfer's scan back. A timeout or a
 * server error may have been billed, so those keep it, and the daily limit holds.
 */
export class ReaderDown extends Error {}

export const MODEL = 'claude-haiku-5-5';

/** Statuses Anthropic answers before the model runs. */
const TURNED_AWAY = new Set([400, 401, 403, 404, 413, 429, 529]);

export function claudeReader(apiKey: string): CardReader {
  // One retry, and a minute each: the golfer is waiting on the reply.
  const client = new Anthropic({ apiKey, maxRetries: 1, timeout: 60_000 });
  return async (images) => {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: MODEL,
        max_tokens: 8000,
        output_config: {
          effort: 'medium',
          format: { type: 'json_schema', schema: CARD_SCHEMA as unknown as Record<string, unknown> },
        },
        messages: [
          {
            role: 'user',
            content: [
              ...images.map((image) => ({
                type: 'image' as const,
                source: { type: 'base64' as const, media_type: image.mediaType, data: image.data },
              })),
              { type: 'text' as const, text: TEE_CARD_PROMPT },
            ],
          },
        ],
      });
    } catch (error) {
      if (error instanceof Anthropic.APIConnectionTimeoutError) throw error;
      if (error instanceof Anthropic.APIConnectionError) throw new ReaderDown('no connection');
      if (error instanceof Anthropic.APIError && TURNED_AWAY.has(error.status ?? 0)) throw new ReaderDown(`status ${error.status}`);
      throw error;
    }
    // A refusal or a cut-off reply may not match the schema: no card, rather than half of one.
    if (response.stop_reason !== 'end_turn') throw new NoReading(`stopped: ${response.stop_reason}`);
    const text = response.content.find((block) => block.type === 'text');
    if (!text || text.type !== 'text') throw new NoReading('no text');
    return parse(text.text);
  };
}

/**
 * The local stack's reader: the reading a test wrote, as JSON, in place of the first
 * photo. `{"readerDown": true}` stands for a model that can't be reached, so a test can
 * see the scan given back.
 */
export const fakeReader: CardReader = async (images) => {
  const reading = parse(new TextDecoder().decode(Uint8Array.from(atob(images[0].data), (c) => c.charCodeAt(0))));
  if ((reading as { readerDown?: unknown })?.readerDown === true) throw new ReaderDown('the fake is down');
  return reading;
};

function parse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new NoReading('not JSON');
  }
}
