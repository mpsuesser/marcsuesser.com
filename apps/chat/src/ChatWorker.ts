import * as Cloudflare from '@alchemy.run/cloudflare';
import { OpenAiClient, OpenAiLanguageModel } from '@effect/ai-openai';
import * as Config from 'effect/Config';
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as HttpRouter from 'effect/http/HttpRouter';
import * as Layer from 'effect/Layer';

import { chatRoutes } from './ChatHttp.ts';
import { CHAT_MODEL } from './ChatTurn.ts';

/**
 * The chat API. It has no public URL: the website's Worker forwards
 * `/api/chat` to it over a service binding, so it holds the only copy of the
 * OpenAI key and the per-address rate limit.
 */
export default Cloudflare.Worker(
	'Chat',
	{
		main: import.meta.url,
		workersDev: false,
		// `Corpus.ts` imports the `context/` Markdown files as text.
		rules: [{ type: 'Text', globs: ['../context/**/*.md'] }]
	},
	Effect.gen(function* () {
		const apiKey = yield* Config.Redacted('OPENAI_API_KEY');
		const rateLimit = yield* Cloudflare.RateLimit('CHAT_RATE_LIMIT', {
			namespaceId: 518_302_117,
			simple: { limit: 12, period: 60 }
		});

		const languageModel = OpenAiLanguageModel.layer({
			model: CHAT_MODEL,
			config: { max_output_tokens: 4_096 }
		}).pipe(
			Layer.provide(OpenAiClient.layer({ apiKey })),
			Layer.provide(FetchHttpClient.layer)
		);

		return {
			fetch: yield* chatRoutes({
				isAllowed: (clientKey) =>
					rateLimit.limit({ key: clientKey }).pipe(
						Effect.map(({ success }) => success),
						// Fail open: a broken limiter shouldn't take the site down.
						Effect.catchTag(
							'RateLimitError',
							(error) =>
								Effect.logWarning('Rate limiter failed', error)
									.pipe(
										Effect.as(true)
									)
						)
					)
			}).pipe(Layer.provide(languageModel), HttpRouter.toHttpEffect)
		};
	}).pipe(Effect.provide(Cloudflare.Workers.RateLimitBinding))
);
