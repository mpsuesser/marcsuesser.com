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
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';
import { Http } from 'foldkit';

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
 * Posts the conversation to the chat Worker and turns its event stream into
 * Messages. The stream always ends with exactly one `FinishedReply` or
 * `FailedReply`, even when the connection drops or the response isn't an
 * event stream. Interrupting it, which closing the Subscription does, aborts
 * the request.
 */
export const streamReply = (
	messages: ReadonlyArray<ChatMessage>
): Stream.Stream<Message> =>
	Stream.unwrap(
		Effect.gen(function* () {
			const client = yield* HttpClient.HttpClient;
			const request = yield* HttpClientRequest.post(CHAT_PATH).pipe(
				HttpClientRequest.schemaBodyJson(ChatRequest)({
					messages: Arr.takeRight(messages, ChatLimits.maxMessages)
				})
			);
			const response = yield* client.execute(request);
			const isEventStream = (response.headers['content-type'] ?? '')
				.startsWith(NDJSON_CONTENT_TYPE);
			if (!isEventStream) {
				return Stream.succeed(unavailable);
			}
			return response.stream.pipe(
				Stream.pipeThroughChannel(Ndjson.decodeSchema(ChatEvent)()),
				Stream.map(toMessage)
			);
		})
	).pipe(
		Stream.catchCause(() => Stream.succeed(unavailable)),
		Stream.concat(Stream.succeed(unavailable)),
		Stream.takeUntil(isEndOfTurn),
		Stream.provide(Http.layer)
	);
