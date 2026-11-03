import { assert, describe, it } from '@effect/vitest';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpServerRequest from 'effect/http/HttpServerRequest';
import * as Stream from 'effect/Stream';

import { streamReply } from '../src/chat-stream.ts';
import { Message } from '../src/message.ts';

const conversation = [{ role: 'user' as const, content: 'Who is Marc?' }];

const respondWith = (body: string, init: ResponseInit) => {
	const requests: Array<Request> = [];
	const fetch = Object.assign(
		(input: RequestInfo | URL, requestInit?: RequestInit) => {
			requests.push(new Request(input, requestInit));
			return Promise.resolve(new Response(body, init));
		},
		{ preconnect: globalThis.fetch.preconnect }
	);
	return { fetch, requests };
};

const ndjson = (status: number) => ({
	status,
	headers: { 'content-type': 'application/x-ndjson' }
});

const collect = (fake: ReturnType<typeof respondWith>) =>
	streamReply(conversation).pipe(
		Stream.provideService(FetchHttpClient.Fetch, fake.fetch),
		Stream.runCollect,
		Effect.map(Arr.fromIterable)
	);

describe('streamReply', () => {
	it.effect('turns the event stream into reply Messages', () =>
		Effect.gen(function* () {
			const fake = respondWith(
				[
					'{"_tag":"Delta","text":"Precipi"}',
					'{"_tag":"Delta","text":"tated."}',
					'{"_tag":"Finished"}',
					''
				].join('\n'),
				ndjson(200)
			);
			assert.deepStrictEqual(yield* collect(fake), [
				Message.ReceivedReplyDelta({ text: 'Precipi' }),
				Message.ReceivedReplyDelta({ text: 'tated.' }),
				Message.FinishedReply()
			]);

			const request = yield* Effect.fromOption(Arr.head(fake.requests));
			assert.strictEqual(request.method, 'POST');
			assert.strictEqual(new URL(request.url).pathname, '/api/chat');
			const body = yield* HttpServerRequest.fromWeb(request).json;
			assert.deepStrictEqual(body, { messages: conversation });
		}));

	it.effect('passes a rate-limit failure through', () =>
		Effect.gen(function* () {
			const fake = respondWith(
				'{"_tag":"Failed","reason":"RateLimited"}\n',
				ndjson(429)
			);
			assert.deepStrictEqual(yield* collect(fake), [
				Message.FailedReply({ reason: 'RateLimited' })
			]);
		}));

	it.effect('ends a stream cut off mid-reply with a failure', () =>
		Effect.gen(function* () {
			const fake = respondWith(
				'{"_tag":"Delta","text":"Half"}\n',
				ndjson(200)
			);
			assert.deepStrictEqual(yield* collect(fake), [
				Message.ReceivedReplyDelta({ text: 'Half' }),
				Message.FailedReply({ reason: 'Unavailable' })
			]);
		}));

	it.effect('treats a response that is not an event stream as a failure', () =>
		Effect.gen(function* () {
			const fake = respondWith('Bad gateway', {
				status: 502,
				headers: { 'content-type': 'text/plain' }
			});
			assert.deepStrictEqual(yield* collect(fake), [
				Message.FailedReply({ reason: 'Unavailable' })
			]);
		}));
});
