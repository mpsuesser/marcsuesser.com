import { assert, describe, it } from '@effect/vitest';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as HttpClient from 'effect/http/HttpClient';
import * as HttpClientRequest from 'effect/http/HttpClientRequest';
import * as HttpClientResponse from 'effect/http/HttpClientResponse';
import * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as Layer from 'effect/Layer';
import * as Ref from 'effect/Ref';
import * as Stream from 'effect/Stream';

import { streamReply } from '../src/chat-stream.ts';
import { Message } from '../src/message.ts';

const conversation = [{ role: 'user' as const, content: 'Who is Marc?' }];

/** An HttpClient that answers every request with one fixed response and records the requests. */
const fakeClient = Effect.fnUntraced(function* (
	body: string,
	init: ResponseInit
) {
	const requests = yield* Ref.make<
		ReadonlyArray<HttpClientRequest.HttpClientRequest>
	>([]);
	const client = HttpClient.make((request) =>
		Ref.update(requests, Arr.append(request)).pipe(
			Effect.as(
				HttpClientResponse.fromWeb(request, new Response(body, init))
			)
		)
	);
	return { layer: Layer.succeed(HttpClient.HttpClient, client), requests };
});

const ndjson = (status: number) => ({
	status,
	headers: { 'content-type': 'application/x-ndjson' }
});

const collect = (layer: Layer.Layer<HttpClient.HttpClient>) =>
	streamReply(conversation).pipe(
		Stream.runCollect,
		Effect.map(Arr.fromIterable),
		Effect.provide(layer)
	);

describe('streamReply', () => {
	it.effect('turns the event stream into reply Messages', () =>
		Effect.gen(function* () {
			const fake = yield* fakeClient(
				Arr.join(
					[
						'{"_tag":"Delta","text":"Precipi"}',
						'{"_tag":"Delta","text":"tated."}',
						'{"_tag":"Finished"}',
						''
					],
					'\n'
				),
				ndjson(200)
			);
			assert.deepStrictEqual(yield* collect(fake.layer), [
				Message.ReceivedReplyDelta({ text: 'Precipi' }),
				Message.ReceivedReplyDelta({ text: 'tated.' }),
				Message.FinishedReply()
			]);

			const request = yield* Effect.fromOption(
				Arr.head(yield* Ref.get(fake.requests))
			);
			assert.strictEqual(request.method, 'POST');
			assert.strictEqual(request.url, '/api/chat');
			const body = yield* HttpServerRequest.fromWeb(
				yield* HttpClientRequest.toWeb(
					HttpClientRequest.prependUrl(
						request,
						'https://marcsuesser.com'
					)
				)
			).json;
			assert.deepStrictEqual(body, { messages: conversation });
		}));

	it.effect('passes a rate-limit failure through', () =>
		Effect.gen(function* () {
			const fake = yield* fakeClient(
				'{"_tag":"Failed","reason":"RateLimited"}\n',
				ndjson(429)
			);
			assert.deepStrictEqual(yield* collect(fake.layer), [
				Message.FailedReply({ reason: 'RateLimited' })
			]);
		}));

	it.effect('ends a stream cut off mid-reply with a failure', () =>
		Effect.gen(function* () {
			const fake = yield* fakeClient(
				'{"_tag":"Delta","text":"Half"}\n',
				ndjson(200)
			);
			assert.deepStrictEqual(yield* collect(fake.layer), [
				Message.ReceivedReplyDelta({ text: 'Half' }),
				Message.FailedReply({ reason: 'Unavailable' })
			]);
		}));

	it.effect('treats a response that is not an event stream as a failure', () =>
		Effect.gen(function* () {
			const fake = yield* fakeClient('Bad gateway', {
				status: 502,
				headers: { 'content-type': 'text/plain' }
			});
			assert.deepStrictEqual(yield* collect(fake.layer), [
				Message.FailedReply({ reason: 'Unavailable' })
			]);
		}));

	it.effect('treats a garbled event line as a failure', () =>
		Effect.gen(function* () {
			const fake = yield* fakeClient(
				'{"_tag":"Delta","text":"Hi"}\nnot json\n',
				ndjson(200)
			);
			assert.deepStrictEqual(yield* collect(fake.layer), [
				Message.ReceivedReplyDelta({ text: 'Hi' }),
				Message.FailedReply({ reason: 'Unavailable' })
			]);
		}));
});
