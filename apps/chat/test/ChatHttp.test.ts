import { assert, describe, it } from '@effect/vitest';
import { CHAT_PATH, ChatEvent } from '@marcsuesser/chat-contract';
import { AiError, LanguageModel, Prompt } from 'effect/ai';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as Ndjson from 'effect/encoding/Ndjson';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as HttpServerError from 'effect/http/HttpServerError';
import * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as HttpServerResponse from 'effect/http/HttpServerResponse';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';

import { chatRoutes } from '../src/ChatHttp.ts';
import { ChatThrottle } from '../src/ChatThrottle.ts';
import { Corpus, CorpusFile, CorpusKey } from '../src/Corpus.ts';

const corpusEntry = new CorpusFile({
	key: CorpusKey.make('origin.md'),
	content: '# The Trieste Incident\n\nMarc was precipitated from foam.'
});

/** A model that streams fixed text deltas, optionally failing after them, and records each prompt. */
const fakeModel = Effect.fnUntraced(function* (options: {
	readonly deltas: ReadonlyArray<string>;
	readonly isFailingAfterDeltas?: boolean;
	readonly isSendingErrorPartAfterDeltas?: boolean;
}) {
	const prompts = yield* Ref.make<ReadonlyArray<Prompt.Prompt>>([]);
	const deltas = Stream.fromIterable(
		Arr.map(options.deltas, (delta) => ({
			type: 'text-delta' as const,
			id: 'text-1',
			delta
		}))
	);
	const parts = options.isFailingAfterDeltas === true
		? Stream.concat(
			deltas,
			Stream.fail(
				AiError.make({
					module: 'Test',
					method: 'streamText',
					reason: new AiError.UnknownError({
						description: 'upstream reset'
					})
				})
			)
		)
		: options.isSendingErrorPartAfterDeltas === true
		? Stream.concat(
			deltas,
			Stream.succeed({ type: 'error' as const, error: 'overloaded' })
		)
		: deltas;
	const layer = Layer.effect(
		LanguageModel.LanguageModel,
		LanguageModel.make({
			generateText: () => Effect.succeed([]),
			streamText: (providerOptions) =>
				Stream.unwrap(
					Ref.update(prompts, Arr.append(providerOptions.prompt))
						.pipe(
							Effect.as(parts)
						)
				)
		})
	);
	return { layer, prompts };
});

/** Any JSON body shape, including ones `ChatRequest` rejects. */
const ChatBody = Schema.Struct({
	messages: Schema.Array(
		Schema.Struct({ role: Schema.String, content: Schema.String })
	)
});
type ChatBody = typeof ChatBody.Type;
const ChatBodyJson = Schema.fromJsonString(ChatBody);

const postChat = (body: ChatBody, path = '/api/chat') =>
	HttpServerRequest.fromWeb(
		new Request(`https://marcsuesser.com${path}`, {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				'cf-connecting-ip': '203.0.113.7'
			},
			body: Schema.encodeSync(ChatBodyJson)(body)
		})
	);

/** Serves one request through the chat routes, turning failures into responses as the Worker does. */
const run = Effect.fnUntraced(function* (
	request: HttpServerRequest.HttpServerRequest,
	options: {
		readonly throttle?: Layer.Layer<ChatThrottle>;
		readonly model?: Layer.Layer<LanguageModel.LanguageModel>;
		readonly corpus?: Layer.Layer<Corpus>;
	} = {}
) {
	const model = options.model ?? (yield* fakeModel({ deltas: [] })).layer;
	const handler = yield* HttpRouter.toHttpEffect(
		chatRoutes.pipe(Layer.provide(model))
	);
	const response = yield* handler.pipe(
		Effect.provideService(HttpServerRequest.HttpServerRequest, request),
		Effect.provide(
			Layer.merge(
				options.throttle ?? ChatThrottle.layerAllowAll,
				options.corpus ?? Corpus.layerFiles([corpusEntry])
			)
		),
		Effect.catchCause((cause) =>
			Effect.map(
				HttpServerError.causeResponse(cause),
				([failureResponse]) => failureResponse
			)
		)
	);
	return HttpServerResponse.toWeb(response);
}, Effect.scoped);

const readEvents = (response: Response) =>
	HttpClientResponse.fromWeb(HttpClientRequest.get(CHAT_PATH), response)
		.stream.pipe(
			Stream.pipeThroughChannel(Ndjson.decodeSchema(ChatEvent)()),
			Stream.runCollect,
			Effect.map(Arr.fromIterable)
		);

const question = { messages: [{ role: 'user', content: 'Who is Marc?' }] };

describe('chatRoutes', () => {
	it.effect('streams deltas, then Finished', () =>
		Effect.gen(function* () {
			const model = yield* fakeModel({
				deltas: ['Marc ', 'is ', 'precipitated.']
			});
			const response = yield* run(postChat(question), {
				model: model.layer
			});

			assert.strictEqual(response.status, 200);
			assert.include(
				response.headers.get('content-type') ?? '',
				'application/x-ndjson'
			);
			assert.deepStrictEqual(yield* readEvents(response), [
				ChatEvent.cases.Delta.make({ text: 'Marc ' }),
				ChatEvent.cases.Delta.make({ text: 'is ' }),
				ChatEvent.cases.Delta.make({ text: 'precipitated.' }),
				ChatEvent.cases.Finished.make({})
			]);
		}));

	it.effect('sends the system prompt ahead of the visitor conversation', () =>
		Effect.gen(function* () {
			const model = yield* fakeModel({ deltas: ['ok'] });
			const response = yield* run(postChat(question), {
				model: model.layer
			});
			yield* readEvents(response);

			const roles = Arr.flatMap(
				yield* Ref.get(model.prompts),
				(prompt) => Arr.map(prompt.content, (message) => message.role)
			);
			assert.deepStrictEqual(roles, ['system', 'user']);
		}));

	it.effect('puts the corpus into the system prompt', () =>
		Effect.gen(function* () {
			const model = yield* fakeModel({ deltas: ['ok'] });
			const response = yield* run(postChat(question), {
				model: model.layer
			});
			yield* readEvents(response);

			const systemText = Arr.flatMap(
				yield* Ref.get(model.prompts),
				(prompt) =>
					Arr.flatMap(
						prompt.content,
						(message) =>
							message.role === 'system' ? [message.content] : []
					)
			);
			assert.lengthOf(systemText, 1);
			assert.include(systemText[0], '<context path="origin.md">');
			assert.include(systemText[0], 'precipitated from foam');
		}));

	it.effect('ends a turn whose corpus cannot be read with Failed', () =>
		Effect.gen(function* () {
			const model = yield* fakeModel({ deltas: ['never sent'] });
			const response = yield* run(postChat(question), {
				model: model.layer,
				corpus: Corpus.layerUnavailable
			});

			assert.deepStrictEqual(yield* readEvents(response), [
				ChatEvent.cases.Failed.make({ reason: 'Unavailable' })
			]);
			assert.lengthOf(yield* Ref.get(model.prompts), 0);
		}));

	it.effect('ends a turn whose model fails midway with Failed', () =>
		Effect.gen(function* () {
			const model = yield* fakeModel({
				deltas: ['Half'],
				isFailingAfterDeltas: true
			});
			const response = yield* run(postChat(question), {
				model: model.layer
			});

			assert.deepStrictEqual(yield* readEvents(response), [
				ChatEvent.cases.Delta.make({ text: 'Half' }),
				ChatEvent.cases.Failed.make({ reason: 'Unavailable' })
			]);
		}));

	it.effect('ends a turn whose provider sends an error part with Failed', () =>
		Effect.gen(function* () {
			const model = yield* fakeModel({
				deltas: ['Half'],
				isSendingErrorPartAfterDeltas: true
			});
			const response = yield* run(postChat(question), {
				model: model.layer
			});

			assert.deepStrictEqual(yield* readEvents(response), [
				ChatEvent.cases.Delta.make({ text: 'Half' }),
				ChatEvent.cases.Failed.make({ reason: 'Unavailable' })
			]);
		}));

	it.effect('answers an address over its budget with 429 and RateLimited', () =>
		Effect.gen(function* () {
			const response = yield* run(postChat(question), {
				throttle: ChatThrottle.layerDenyAll
			});

			assert.strictEqual(response.status, 429);
			assert.deepStrictEqual(yield* readEvents(response), [
				ChatEvent.cases.Failed.make({ reason: 'RateLimited' })
			]);
		}));

	it.effect('rejects a malformed body with 400', () =>
		Effect.gen(function* () {
			const response = yield* run(postChat({ messages: [] }));
			assert.strictEqual(response.status, 400);
		}));

	it.effect('answers other methods with 404', () =>
		Effect.gen(function* () {
			const response = yield* run(
				HttpServerRequest.fromWeb(
					new Request('https://marcsuesser.com/api/chat')
				)
			);
			assert.strictEqual(response.status, 404);
		}));

	it.effect('answers other paths with 404', () =>
		Effect.gen(function* () {
			const response = yield* run(postChat(question, '/api/other'));
			assert.strictEqual(response.status, 404);
		}));
});
