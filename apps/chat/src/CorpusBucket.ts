import * as Cloudflare from '@alchemy.run/cloudflare';
import * as Alchemy from 'alchemy';
import * as RemovalPolicy from 'alchemy/RemovalPolicy';
import type { RuntimeContext } from 'alchemy/RuntimeContext';
import { Stack } from 'alchemy/Stack';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as Option from 'effect/Option';

import { CorpusFile, CorpusUnavailable, isCorpusKey } from './Corpus.ts';

/**
 * The corpus bucket's name in a stage. It is derived rather than generated so
 * the corpus CLI (`scripts/corpus.ts`) can find the bucket without reading
 * stack state. R2 names are per account, so forks don't collide.
 */
export const corpusBucketName = (stage: string): string =>
	`marcsuesser-corpus-${stage}`;

/**
 * The private R2 bucket holding the corpus, one Markdown object per entry.
 * It is the corpus's only home: nothing is committed or bundled.
 *
 * - `remote()` keeps it live under `alchemy dev`, so a dev session answers
 *   from the stage's real entries instead of an empty local simulator.
 * - `retain()` keeps the bucket and its entries if the stack is destroyed
 *   or the resource replaced; deleting the corpus is never a side effect.
 */
export const CorpusBucket = Effect.gen(function* () {
	const { stage } = yield* Stack;
	return yield* Cloudflare.R2.Bucket('Corpus', {
		name: corpusBucketName(stage)
	}).pipe(Alchemy.remote(), RemovalPolicy.retain());
});

/** Every key in the bucket, across list pages. */
const listKeys = (
	bucket: Cloudflare.R2.ReadBucketClient,
	cursor: Option.Option<string> = Option.none()
): Effect.Effect<
	ReadonlyArray<string>,
	Cloudflare.R2.R2Error,
	RuntimeContext
> => Effect.flatMap(
	bucket.list(Option.match(cursor, {
		onNone: () => ({}),
		onSome: (value) => ({ cursor: value })
	})),
	(page) => {
		const keys = Arr.map(page.objects, (object) => object.key);
		return page.truncated
			? Effect.map(
				listKeys(bucket, Option.some(page.cursor)),
				(rest) => Arr.appendAll(keys, rest)
			)
			: Effect.succeed(keys);
	}
);

/**
 * Reads every corpus entry from the bucket. Objects whose keys aren't corpus
 * keys are skipped, as is an object deleted between the list and the read.
 */
export const readCorpusFiles = (
	bucket: Cloudflare.R2.ReadBucketClient
): Effect.Effect<
	ReadonlyArray<CorpusFile>,
	CorpusUnavailable,
	RuntimeContext
> => listKeys(bucket).pipe(
	Effect.map(Arr.filter(isCorpusKey)),
	Effect.flatMap((keys) =>
		Effect.forEach(
			keys,
			(key) =>
				bucket.get(key).pipe(
					Effect.flatMap((object) =>
						object === null
							? Effect.succeedNone
							: Effect.map(
								object.text(),
								(content) =>
									Option.some(
										new CorpusFile({ key, content })
									)
							)
					)
				),
			{ concurrency: 8 }
		)
	),
	Effect.map(Arr.getSomes),
	Effect.mapError((cause) => new CorpusUnavailable({ cause })),
	Effect.withSpan('CorpusBucket.read')
);
