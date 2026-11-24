import {
	ChatEvent,
	ChatModel,
	type ChatRequest
} from '@marcsuesser/chat-contract';
import { LanguageModel, Prompt } from 'effect/ai';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as Match from 'effect/Match';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';

import { Corpus } from './Corpus.ts';
import { systemPrompt } from './SystemPrompt.ts';

/** The system prompt over the rendered corpus, then the visitor's conversation as it stands. */
export const toPrompt = (
	corpus: string,
	request: ChatRequest
): Prompt.Prompt =>
	Prompt.make([
		{ role: 'system', content: systemPrompt(corpus) },
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
 * then `Finished`. A corpus that can't be read, a model request that fails, or
 * a provider error part is logged and ends the turn with `Failed`.
 * Interruption (the visitor stopped or left) is not a failure and ends the
 * stream without an event; nobody is listening.
 */
export const streamChatTurn = (
	request: ChatRequest
): Stream.Stream<ChatEvent, never, LanguageModel.LanguageModel | Corpus> =>
	Stream.unwrap(
		Effect.map(
			Corpus.use((corpus) => corpus.rendered),
			(rendered) =>
				LanguageModel.streamText({
					prompt: toPrompt(rendered, request)
				})
		)
	).pipe(
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
				'chat.model': ChatModel.id,
				'chat.message_count': Arr.length(request.messages)
			}
		})
	);
