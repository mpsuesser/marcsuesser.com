import { ChatEvent, type ChatRequest } from '@marcsuesser/chat-contract';
import { LanguageModel, Prompt } from 'effect/ai';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as Match from 'effect/Match';
import * as Schema from 'effect/Schema';
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

/** The provider sent an `error` part in the middle of a reply. */
export class ReplyErrorPart extends Schema.TaggedError<
	ReplyErrorPart,
	{ readonly brand: unique symbol }
>()(
	'ReplyErrorPart',
	{ cause: Schema.Defect() },
	{ description: 'The model provider reported an error mid-reply.' }
) {}

const finished = ChatEvent.cases.Finished.make({});
const unavailable = ChatEvent.cases.Failed.make({ reason: 'Unavailable' });

/**
 * One chat turn as the events the browser renders: a `Delta` per text chunk,
 * then `Finished`. A model failure, whether the request fails or the provider
 * sends an error part, is logged and ends the turn with `Failed`.
 * Interruption (the visitor stopped or left) is not a failure and ends the
 * stream without an event; nobody is listening.
 */
export const streamChatTurn = (
	request: ChatRequest
): Stream.Stream<ChatEvent, never, LanguageModel.LanguageModel> =>
	LanguageModel.streamText({ prompt: toPrompt(request) }).pipe(
		Stream.flatMap((part) =>
			Match.value(part).pipe(
				Match.when(
					{ type: 'text-delta' },
					({ delta }) =>
						Stream.succeed(
							ChatEvent.cases.Delta.make({ text: delta })
						)
				),
				Match.when(
					{ type: 'error' },
					({ error }) =>
						Stream.fail(new ReplyErrorPart({ cause: error }))
				),
				Match.when(
					{ type: 'finish', reason: 'length' },
					() =>
						Stream.fromEffect(
							Effect.logWarning(
								'Chat reply hit the output token limit'
							)
						).pipe(Stream.drain)
				),
				Match.orElse(() => Stream.empty)
			)
		),
		Stream.concat(Stream.succeed(finished)),
		Stream.catch((error) =>
			Stream.fromEffect(
				Effect.logError('Chat turn failed', error).pipe(
					Effect.as(unavailable)
				)
			)
		),
		Stream.withSpan('ChatTurn.stream', {
			attributes: {
				'chat.model': CHAT_MODEL,
				'chat.message_count': Arr.length(request.messages)
			}
		})
	);
