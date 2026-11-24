import * as Cloudflare from '@alchemy.run/cloudflare';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import { ChatModel } from '@marcsuesser/chat-contract';
import type { RuntimeContext } from 'alchemy/RuntimeContext';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as Layer from 'effect/Layer';

import { chatRoutes } from './ChatHttp.ts';
import { ChatThrottle } from './ChatThrottle.ts';
import { Corpus, CORPUS_TTL, renderCorpus, reuseFor } from './Corpus.ts';
import { CorpusBucket, readCorpusFiles } from './CorpusBucket.ts';

/**
 * The chat API. It has no public URL: the website's Worker forwards
 * `/api/chat` to it over a service binding, so it holds the only copy of the
 * OpenAI key and the per-address rate limit, and the only (read-only) binding
 * to the corpus bucket.
 */
export default Cloudflare.Worker(
	'Chat',
	{
		main: import.meta.url,
		workersDev: false
	},
	Effect.gen(function* () {
		const apiKey = yield* Config.Redacted('OPENAI_API_KEY');
		const rateLimit = yield* Cloudflare.RateLimit('CHAT_RATE_LIMIT', {
			namespaceId: 518_302_117,
			simple: { limit: 12, period: 60 }
		});
		const corpusBucket = yield* Cloudflare.R2.ReadBucket(
			yield* CorpusBucket
		);
		const readCorpus = yield* reuseFor(
			Effect.map(readCorpusFiles(corpusBucket), renderCorpus),
			CORPUS_TTL
		);

		const languageModel = OpenAiLanguageModel.layer({
			model: ChatModel.id,
			config: {
				service_tier: ChatModel.serviceTier,
				max_output_tokens: ChatModel.maxOutputTokens,
				reasoning: { effort: ChatModel.reasoningEffort }
			}
		}).pipe(
			Layer.provide(OpenAiClient.layer({ apiKey })),
			Layer.provide(FetchHttpClient.layer)
		);

		/**
		 * The throttle over the Cloudflare rate limit. The binding is only usable
		 * inside a request, so this runs per request, closing over its context.
		 * It fails open: a broken limiter shouldn't take the site down.
		 */
		const throttle = Effect.map(
			Effect.context<RuntimeContext>(),
			(context) =>
				ChatThrottle.of({
					isAllowed: (clientKey) =>
						rateLimit.limit({ key: clientKey }).pipe(
							Effect.map(({ success }) => success),
							Effect.catchTag('RateLimitError', (error) =>
								Effect.logWarning('Rate limiter failed', error)
									.pipe(
										Effect.as(true)
									)),
							Effect.provide(context)
						)
				})
		);

		/**
		 * The corpus, read from the bucket. Like the throttle, the binding is
		 * only usable inside a request; the rendered text is reused across
		 * requests for `CORPUS_TTL`, so an edit goes live within that window.
		 */
		const corpus = Effect.map(
			Effect.context<RuntimeContext>(),
			(context) =>
				Corpus.of({
					rendered: readCorpus.pipe(Effect.provide(context))
				})
		);

		const handler = yield* HttpRouter.toHttpEffect(
			chatRoutes.pipe(Layer.provide(languageModel))
		);

		return {
			fetch: handler.pipe(
				Effect.provideServiceEffect(ChatThrottle, throttle),
				Effect.provideServiceEffect(Corpus, corpus)
			)
		};
	}).pipe(
		Effect.provide(
			Layer.mergeAll(
				Cloudflare.Workers.RateLimitBinding,
				Cloudflare.R2.ReadBucketBinding
			)
		)
	)
);
