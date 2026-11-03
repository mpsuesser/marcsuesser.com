import {
	CHAT_PATH,
	ChatEvent,
	ChatRequest,
	NDJSON_CONTENT_TYPE
} from '@marcsuesser/chat-contract';
import { LanguageModel } from 'effect/ai';
import * as Effect from 'effect/Effect';
import * as Ndjson from 'effect/encoding/Ndjson';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import * as Option from 'effect/Option';
import * as Stream from 'effect/Stream';

import { streamChatTurn } from './ChatTurn.ts';

/** Decides whether a client address may start another chat turn now. */
export interface ChatThrottle<R> {
	readonly isAllowed: (clientKey: string) => Effect.Effect<boolean, never, R>;
}

const streamHeaders = { 'cache-control': 'no-store' };

const ndjsonResponse = <E>(
	events: Stream.Stream<ChatEvent, E>,
	status: number
): HttpServerResponse.HttpServerResponse =>
	HttpServerResponse.stream(
		events.pipe(
			Stream.pipeThroughChannel(Ndjson.encodeSchema(ChatEvent)())
		),
		{ status, contentType: NDJSON_CONTENT_TYPE, headers: streamHeaders }
	);

const clientKeyOf = (request: HttpServerRequest.HttpServerRequest): string =>
	request.headers['cf-connecting-ip'] ?? 'unknown';

/**
 * One chat turn: a {@link ChatRequest} body in, a stream of {@link ChatEvent}
 * lines out. An address over its budget gets one `Failed` event with status
 * 429.
 */
const chatTurn = <R>(
	throttle: ChatThrottle<R>,
	languageModel: LanguageModel.LanguageModel
) => Effect.fnUntraced(
	function* (request: HttpServerRequest.HttpServerRequest) {
		const isAllowed = yield* throttle.isAllowed(clientKeyOf(request));
		if (!isAllowed) {
			return ndjsonResponse(
				Stream.succeed(
					ChatEvent.cases.Failed.make({ reason: 'RateLimited' })
				),
				429
			);
		}

		const maybeChatRequest = yield* HttpServerRequest.schemaBodyJson(
			ChatRequest
		).pipe(Effect.option);
		if (Option.isNone(maybeChatRequest)) {
			return HttpServerResponse.text('Malformed chat request', {
				status: 400
			});
		}

		// The body streams after this handler returns, so it carries the model
		// it needs rather than reaching back into the handler's context.
		return ndjsonResponse(
			streamChatTurn(maybeChatRequest.value).pipe(
				Stream.provideService(
					LanguageModel.LanguageModel,
					languageModel
				)
			),
			200
		);
	}
);

/**
 * The chat Worker's routes: only `POST /api/chat`. The router answers every
 * other path with 404.
 */
export const chatRoutes = <R>(throttle: ChatThrottle<R>) =>
	HttpRouter.use((router) =>
		Effect.gen(function* () {
			const languageModel = yield* LanguageModel.LanguageModel;
			yield* router.add(
				'POST',
				CHAT_PATH,
				chatTurn(throttle, languageModel)
			);
		})
	);
