import {
	CHAT_PATH,
	ChatEvent,
	ChatLimits,
	ChatRequest,
	NDJSON_CONTENT_TYPE,
	type ChatMessage
} from '@marcsuesser/chat-contract';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as Ndjson from 'effect/encoding/Ndjson';
import * as Headers from 'effect/http/Headers';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import type * as HttpClientResponse from 'effect/http/HttpClientResponse';
import * as Option from 'effect/Option';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import * as Str from 'effect/String';

import { Message } from './message.ts';

const toMessage = ChatEvent.match({
	Delta: ({ text }) => Message.ReceivedReplyDelta({ text }),
	Finished: () => Message.FinishedReply(),
	Failed: ({ reason }) => Message.FailedReply({ reason })
});

const isEndOfTurn = Schema.is(
	Schema.Union([Message.FinishedReply, Message.FailedReply])
);

const unavailable = Message.FailedReply({ reason: 'Unavailable' });

/**
 * The chat Worker answers with an event stream on 200 and 429 alike; anything
 * else (a 400, an edge error page) is not a turn the page can render.
 */
const isEventStream = (response: HttpClientResponse.HttpClientResponse) =>
	Headers.get(response.headers, 'content-type').pipe(
		Option.exists(Str.startsWith(NDJSON_CONTENT_TYPE))
	);

/**
 * Posts the conversation to the chat Worker and turns its event stream into
 * Messages. The stream always ends with exactly one `FinishedReply` or
 * `FailedReply`, even when the connection drops or the response isn't an
 * event stream. Interrupting it, which closing the Subscription does, aborts
 * the request.
 */
export const streamReply = (
	messages: ReadonlyArray<ChatMessage>
): Stream.Stream<Message, never, HttpClient.HttpClient> =>
	Stream.unwrap(
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const chatRequest = yield* ChatRequest.makeEffect({
				messages: Arr.takeRight(messages, ChatLimits.maxMessages)
			});
			const response = yield* HttpClientRequest.post(CHAT_PATH).pipe(
				HttpClientRequest.schemaBodyJson(ChatRequest)(chatRequest),
				Effect.flatMap(client.execute)
			);
			if (!isEventStream(response)) {
				return Stream.succeed(unavailable);
			}
			return response.stream.pipe(
				Stream.pipeThroughChannel(Ndjson.decodeSchema(ChatEvent)()),
				Stream.map(toMessage)
			);
		})
	).pipe(
		Stream.catch((error) =>
			Stream.fromEffect(
				Effect.logWarning('Chat reply failed', error).pipe(
					Effect.as(unavailable)
				)
			)
		),
		Stream.concat(Stream.succeed(unavailable)),
		Stream.takeUntil(isEndOfTurn)
	);
