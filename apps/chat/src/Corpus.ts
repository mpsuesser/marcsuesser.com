import * as Arr from 'effect/Array';
import * as Clock from 'effect/Clock';
import * as Context from 'effect/Context';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import { pipe } from 'effect/Function';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as Order from 'effect/Order';
import * as Ref from 'effect/Ref';
import * as Schema from 'effect/Schema';
import * as Str from 'effect/String';

/**
 * The key of one corpus entry in the bucket: a lowercase kebab-case slug
 * ending in `.md`, such as `childhood-in-trieste.md`. The Worker ignores
 * objects whose keys don't match, and the corpus CLI refuses to write them.
 */
export const CorpusKey = Schema.String.check(
	Schema.isPattern(/^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/, {
		identifier: 'CorpusKeyCheck',
		title: 'Corpus Key',
		description: 'A lowercase kebab-case slug ending in .md.',
		message: 'Corpus keys are lowercase kebab-case slugs ending in .md'
	})
).pipe(Schema.brand('CorpusKey'));
export type CorpusKey = typeof CorpusKey.Type;

/** Whether a bucket key names a corpus entry. */
export const isCorpusKey = Schema.is(CorpusKey);

/** One entry of the source material the chat answers from. */
export class CorpusFile extends Schema.Class<
	CorpusFile,
	{ readonly brand: unique symbol }
>('CorpusFile')({
	key: CorpusKey,
	content: Schema.String
}) {}

const byKey = Order.mapInput(Order.String, (file: CorpusFile) => file.key);

/**
 * The corpus as the system prompt carries it: each non-empty entry wrapped in
 * a `<context path="…">` element, sorted by key so the prompt prefix stays
 * byte-identical between turns and the provider's prompt cache keeps hitting.
 */
export const renderCorpus = (files: ReadonlyArray<CorpusFile>): string =>
	pipe(
		files,
		Arr.filter((file) => Str.isNonEmpty(Str.trim(file.content))),
		Arr.sort(byKey),
		Arr.map((file) =>
			`<context path="${file.key}">\n${
				Str.trim(file.content)
			}\n</context>`
		),
		Arr.join('\n\n')
	);

/** The corpus couldn't be read, so the turn can't be answered. */
export class CorpusUnavailable extends Schema.TaggedError<
	CorpusUnavailable,
	{ readonly brand: unique symbol }
>()(
	'CorpusUnavailable',
	{ cause: Schema.Defect() },
	{ description: 'The corpus store could not be read.' }
) {}

/**
 * The rendered corpus a chat turn answers from. The Worker reads it from the
 * corpus bucket per request (see `ChatWorker.ts`); tests supply fixed entries.
 */
export class Corpus extends Context.Service<Corpus, {
	readonly rendered: Effect.Effect<string, CorpusUnavailable>;
}>()('marcsuesser.com/Corpus') {
	/** A corpus of fixed entries. */
	static readonly layerFiles = (
		files: ReadonlyArray<CorpusFile>
	): Layer.Layer<Corpus> =>
		Layer.succeed(
			Corpus,
			Corpus.of({ rendered: Effect.succeed(renderCorpus(files)) })
		);

	/** A corpus whose store is down. */
	static readonly layerUnavailable: Layer.Layer<Corpus> = Layer.succeed(
		Corpus,
		Corpus.of({
			rendered: Effect.fail(
				new CorpusUnavailable({ cause: 'store unreachable' })
			)
		})
	);
}

/** How long a corpus read is reused before the bucket is read again. */
export const CORPUS_TTL = Duration.minutes(1);

interface Reading<A> {
	readonly value: A;
	readonly readAt: number;
}

/**
 * Reuses `read`'s last success for `ttl`; a failure is never kept.
 *
 * Not `Effect.cachedWithTTL`: that lets a caller wait on another caller's
 * in-flight read, and on workerd the waiting request's fiber would then be
 * resumed from the other request's I/O. Here concurrent misses each read
 * for themselves, and only the settled value is shared.
 */
export const reuseFor = <A, E, R>(
	read: Effect.Effect<A, E, R>,
	ttl: Duration.Duration
): Effect.Effect<Effect.Effect<A, E, R>> =>
	Effect.map(
		Ref.make(Option.none<Reading<A>>()),
		(last) =>
			Effect.gen(function* () {
				const now = yield* Clock.currentTimeMillis;
				const fresh = Option.filter(
					yield* Ref.get(last),
					(reading) => now - reading.readAt < Duration.toMillis(ttl)
				);
				if (Option.isSome(fresh)) {
					return fresh.value.value;
				}
				const value = yield* read;
				yield* Ref.set(last, Option.some({ value, readAt: now }));
				return value;
			})
	);
