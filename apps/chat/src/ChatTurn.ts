import { ChatEvent, type ChatRequest } from '@marcsuesser/chat-contract';
import { LanguageModel, Prompt } from 'effect/ai';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as Stream from 'effect/Stream';

import { systemPrompt } from './SystemPrompt.ts';

/** The OpenAI model that answers visitors. */
export const CHAT_MODEL = 'gpt-6.1-terra';

/** The system prompt, then the visitor's conversation as it stands. */
export const toPrompt = (request: ChatRequest): Prompt.Prompt =>
	Prompt.make([
		{ role: 'system', content: systemPrompt },
		...Arr.map(request.messages, (message) => ({
			role: message.role,
			content: [{ type: 'text' as const, text: message.content }]
		}))
	]);

const finished = ChatEvent.cases.Finished.make({});
const unavailable = ChatEvent.cases.Failed.make({ reason: 'Unavailable' });

/**
 * One chat turn as the events the browser renders: a `Delta` per text chunk,
 * then `Finished`. Any model failure, whether a failed request or an error
 * part mid-stream, is logged and ends the turn with `Failed`, so the stream
 * itself never fails.
 */
export const streamChatTurn = (
	request: ChatRequest
): Stream.Stream<ChatEvent, never, LanguageModel.LanguageModel> =>
	LanguageModel.streamText({ prompt: toPrompt(request) }).pipe(
		Stream.flatMap((part) => {
			if (part.type === 'text-delta') {
				return Stream.succeed(
					ChatEvent.cases.Delta.make({ text: part.delta })
				);
			}
			if (part.type === 'error') {
				return Stream.fail(part.error);
			}
			return Stream.empty;
		}),
		Stream.concat(Stream.succeed(finished)),
		Stream.catchCause((cause) =>
			Stream.fromEffect(
				Effect.logError('Chat turn failed', cause).pipe(
					Effect.as(unavailable)
				)
			)
		),
		Stream.withSpan('ChatTurn.stream', {
			attributes: {
				'chat.model': CHAT_MODEL,
				'chat.message_count': request.messages.length
			}
		})
	);
