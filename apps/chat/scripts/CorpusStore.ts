import * as Cloudflare from '@alchemy.run/cloudflare';
import type { CloudflareOpContext } from '@distilled.cloud/cloudflare';
import * as r2 from '@distilled.cloud/cloudflare/r2';
import { BunServices } from '@effect/platform-bun';
import { AuthProvidersLive } from 'alchemy/Auth/Registry';
import * as Arr from 'effect/Array';
import * as Effect from 'effect/Effect';
import * as FetchHttpClient from 'effect/http/FetchHttpClient';
import * as Layer from 'effect/Layer';
import * as Option from 'effect/Option';
import * as P from 'effect/Predicate';
import * as Schema from 'effect/Schema';
import * as Stream from 'effect/Stream';

import type { CorpusKey } from '../src/Corpus.ts';

/**
 * Cloudflare credentials resolved the way the Alchemy CLI resolves them
 * (`alchemy login`, or `CLOUDFLARE_API_TOKEN`), outside a stack.
 * `AuthProvidersLive` is the registry a stack normally supplies; the
 * Cloudflare layer registers its auth provider into it.
 */
export const cloudflareApi = Cloudflare.CloudflareApiLive().pipe(
	Layer.provideMerge(AuthProvidersLive),
	Layer.provideMerge(FetchHttpClient.layer),
	Layer.provideMerge(BunServices.layer)
);

/** A corpus store operation failed; `message` says what to do about it. */
export class CorpusStoreError extends Schema.TaggedError<
	CorpusStoreError,
	{ readonly brand: unique symbol }
>()(
	'CorpusStoreError',
	{ message: Schema.String, cause: Schema.Defect() },
	{ description: 'A corpus bucket operation failed.' }
) {}

/** One object in the corpus bucket, as listed. */
export class StoredObject extends Schema.Class<
	StoredObject,
	{ readonly brand: unique symbol }
>('StoredObject')({
	key: Schema.String,
	size: Schema.Finite,
	lastModified: Schema.Option(Schema.String)
}) {}

/**
 * Read and write access to one stage's corpus bucket from a terminal, over
 * Cloudflare's R2 API with the credentials `alchemy deploy` uses, so it needs
 * no keys of its own. The deployed Worker only ever reads the bucket.
 */
export interface CorpusStore {
	readonly bucketName: string;
	readonly list: Effect.Effect<ReadonlyArray<StoredObject>, CorpusStoreError>;
	readonly get: (
		key: CorpusKey
	) => Effect.Effect<Option.Option<string>, CorpusStoreError>;
	readonly put: (
		key: CorpusKey,
		content: string
	) => Effect.Effect<void, CorpusStoreError>;
	readonly delete: (key: CorpusKey) => Effect.Effect<void, CorpusStoreError>;
}

/** Opens the store over the bucket named `bucketName`. */
export const openCorpusStore = Effect.fn('CorpusStore.open')(function* (
	bucketName: string
) {
	const environment = yield* Cloudflare.CloudflareEnvironment;
	const { accountId } = yield* environment;
	const bucket = { accountId, bucketName };
	const context = yield* Effect.context<CloudflareOpContext>();

	/** Turns an R2 API failure into a message a person can act on. */
	const failed =
		(operation: string) => <A, E, R>(effect: Effect.Effect<A, E, R>) =>
			effect.pipe(
				Effect.mapError((cause) =>
					new CorpusStoreError({
						message: P.isTagged(cause, 'NoSuchBucket')
							? `Bucket ${bucketName} doesn't exist yet. Deploy its stage first.`
							: `Couldn't ${operation} in ${bucketName}.`,
						cause
					})
				)
			);

	const list = r2.listObjects.items(bucket).pipe(
		Stream.map((object) =>
			new StoredObject({
				key: object.key ?? '',
				size: object.size ?? 0,
				lastModified: Option.fromNullishOr(object.lastModified)
			})
		),
		Stream.runCollect,
		Effect.map(Arr.fromIterable),
		failed('list objects'),
		Effect.provideContext(context)
	);

	const get = (key: CorpusKey) =>
		r2.getObject({ ...bucket, objectName: key }).pipe(
			Effect.flatMap((object) =>
				object.body.pipe(Stream.decodeText(), Stream.mkString)
			),
			Effect.asSome,
			Effect.catchTag('NoSuchKey', () => Effect.succeedNone),
			failed(`read ${key}`),
			Effect.provideContext(context)
		);

	const put = (key: CorpusKey, content: string) =>
		r2.putObject({
			...bucket,
			objectName: key,
			body: content,
			contentType: 'text/markdown; charset=utf-8'
		}).pipe(
			Effect.asVoid,
			failed(`write ${key}`),
			Effect.provideContext(context)
		);

	const remove = (key: CorpusKey) =>
		r2.deleteObject({ ...bucket, objectName: key }).pipe(
			Effect.asVoid,
			Effect.catchTag('NoSuchKey', () => Effect.void),
			failed(`delete ${key}`),
			Effect.provideContext(context)
		);

	return {
		bucketName,
		list,
		get,
		put,
		delete: remove
	} satisfies CorpusStore;
});
