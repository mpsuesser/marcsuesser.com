import {
	CHAT_PATH,
	ChatEvent,
	ChatRequest,
	NDJSON_CONTENT_TYPE
} from '@marcsuesser/chat-contract';
import { LanguageModel } from 'effect/ai';
import * as Effect from 'effect/Effect';
import * as Ndjson from 'effect/encoding/Ndjson';
import * as Headers from 'effect/http/Headers';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import * as HttpStatus from 'effect/http/HttpStatus';
import * as Option from 'effect/Option';
import * as Stream from 'effect/Stream';

import { ChatThrottle } from './ChatThrottle.ts';
import { streamChatTurn } from './ChatTurn.ts';
import { Corpus } from './Corpus.ts';

const ndjsonResponse = <E>(
	events: Stream.Stream<ChatEvent, E>,
	status: number
): HttpServerResponse.HttpServerResponse =>
	HttpServerResponse.stream(
		events.pipe(
			Stream.pipeThroughChannel(Ndjson.encodeSchema(ChatEvent)())
		),
		{
			status,
			contentType: NDJSON_CONTENT_TYPE,
			headers: { 'cache-control': 'no-store' }
		}
	);

/** A turn refused by the throttle: one `Failed` event, status 429. */
const rateLimited = ndjsonResponse(
	Stream.succeed(ChatEvent.cases.Failed.make({ reason: 'RateLimited' })),
	HttpStatus.fromLiteral('TooManyRequests')
);

/** The visitor's address as Cloudflare reports it; the throttle keys on it. */
const clientKeyOf = (request: HttpServerRequest.HttpServerRequest): string =>
	Headers.get(request.headers, 'cf-connecting-ip').pipe(
		Option.getOrElse(() => 'unknown')
	);

/** A body that isn't a {@link ChatRequest}. */
const malformed = HttpServerResponse.text('Malformed chat request', {
	status: HttpStatus.fromLiteral('BadRequest')
});

/**
 * One chat turn: a {@link ChatRequest} body in, a stream of {@link ChatEvent}
 * lines out. A body that doesn't decode is answered with 400; a body that
 * can't be read at all fails with `HttpServerError`, which the HTTP boundary
 * answers the same way.
 */
const chatTurn = (languageModel: LanguageModel.LanguageModel) =>
	Effect.fnUntraced(
		function* (request: HttpServerRequest.HttpServerRequest) {
			const throttle = yield* ChatThrottle;
			if (!(yield* throttle.isAllowed(clientKeyOf(request)))) {
				return rateLimited;
			}

			const chatRequest = yield* HttpServerRequest.schemaBodyJson(
				ChatRequest
			);

			// The body streams after this handler returns, so it carries the model
			// and corpus it needs rather than reaching back into the handler's
			// context.
			const corpus = yield* Corpus;
			return ndjsonResponse(
				streamChatTurn(chatRequest).pipe(
					Stream.provideService(
						LanguageModel.LanguageModel,
						languageModel
					),
					Stream.provideService(Corpus, corpus)
				),
				HttpStatus.fromLiteral('OK')
			);
		},
		Effect.catchTag('SchemaError', () => Effect.succeed(malformed))
	);

/**
 * The chat Worker's routes: only `POST /api/chat`; the router answers every
 * other method and path with 404. The model is resolved once, when the routes
 * are built; the throttle and corpus are read per request.
 */
export const chatRoutes = HttpRouter.use(
	Effect.fnUntraced(function* (router) {
		const languageModel = yield* LanguageModel.LanguageModel;
		yield* router.add('POST', CHAT_PATH, chatTurn(languageModel));
	})
);
