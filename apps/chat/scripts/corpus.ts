/**
 * The corpus CLI: list, read, write, and delete the entries in a stage's
 * corpus bucket. Run it from the repository root:
 *
 *   bun run corpus list --stage prod
 *   bun run corpus get origin.md --stage prod
 *   bun run corpus put ./childhood-in-trieste.md --stage prod
 *   bun run corpus delete childhood-in-trieste.md --stage prod --yes
 *
 * Writes go live within a minute (`CORPUS_TTL`); no deploy is involved.
 */
import { BunRuntime } from '@effect/platform-bun';
import * as Arr from 'effect/Array';
import { Argument, CliError, Command, Flag } from 'effect/cli';
import * as Console from 'effect/Console';
import * as Effect from 'effect/Effect';
import * as FileSystem from 'effect/FileSystem';
import * as Option from 'effect/Option';
import * as Path from 'effect/Path';
import * as Schema from 'effect/Schema';

import { CorpusKey, isCorpusKey } from '../src/Corpus.ts';
import { corpusBucketName } from '../src/CorpusBucket.ts';
import {
	cloudflareApi,
	CorpusStoreError,
	openCorpusStore
} from './CorpusStore.ts';

const decodeKey = (key: string) =>
	Schema.decodeEffect(CorpusKey)(key).pipe(
		Effect.mapError((cause) =>
			new CorpusStoreError({
				message:
					`"${key}" isn't a corpus key: use a lowercase kebab-case slug ending in .md, such as childhood-in-trieste.md.`,
				cause
			})
		)
	);

const keyArguments = Argument.String('key').pipe(
	Argument.withDescription('Entry key, such as childhood-in-trieste.md'),
	Argument.atLeast(1)
);

const corpus = Command.make('corpus').pipe(
	Command.withDescription("Manage the chat corpus in a stage's R2 bucket."),
	Command.withSharedFlags({
		stage: Flag.String('stage').pipe(
			Flag.withAlias('s'),
			Flag.withDescription('Stage whose bucket to use: dev, prod, …')
		)
	})
);

/** The store over the bucket of the stage named by `--stage`. */
const openStore = Effect.flatMap(
	corpus,
	({ stage }) => openCorpusStore(corpusBucketName(stage))
);

const list = Command.make(
	'list',
	{},
	() =>
		Effect.gen(function* () {
			const store = yield* openStore;
			const objects = yield* store.list;
			yield* Console.log(
				`${Arr.length(objects)} objects in ${store.bucketName}`
			);
			yield* Effect.forEach(objects, (object) =>
				Console.log(
					[
						object.key,
						`${object.size} B`,
						Option.getOrElse(object.lastModified, () => ''),
						isCorpusKey(object.key)
							? ''
							: '(ignored: not a corpus key)'
					].join('\t')
				), { concurrency: 1 });
		})
).pipe(Command.withDescription('List the entries in the bucket.'));

const get = Command.make(
	'get',
	{ keys: keyArguments },
	({ keys }) =>
		Effect.gen(function* () {
			const store = yield* openStore;
			const isSingle = Arr.length(keys) === 1;
			yield* Effect.forEach(keys, (raw) =>
				Effect.gen(function* () {
					const key = yield* decodeKey(raw);
					const content = yield* store.get(key).pipe(
						Effect.flatMap(Effect.fromOption),
						Effect.catchTag('NoSuchElementError', () =>
							Effect.fail(
								new CorpusStoreError({
									message:
										`No entry ${key} in ${store.bucketName}.`,
									cause: key
								})
							))
					);
					yield* Console.log(
						isSingle ? content : `==> ${key} <==\n${content}\n`
					);
				}), { concurrency: 1 });
		})
).pipe(
	Command.withDescription(
		'Print entries. With several keys, each is headed by its key.'
	)
);

const put = Command.make(
	'put',
	{
		files: Argument.File('file', { mustExist: true }).pipe(
			Argument.withDescription(
				'Markdown file; its file name becomes the entry key'
			),
			Argument.atLeast(1)
		)
	},
	({ files }) =>
		Effect.gen(function* () {
			const store = yield* openStore;
			const fs = yield* FileSystem.FileSystem;
			const path = yield* Path.Path;
			yield* Effect.forEach(files, (file) =>
				Effect.gen(function* () {
					const key = yield* decodeKey(path.basename(file));
					const content = yield* fs.readFileString(file);
					yield* store.put(key, content);
					yield* Console.log(
						`put ${key} (${content.length} chars) in ${store.bucketName}`
					);
				}), { concurrency: 1 });
		})
).pipe(
	Command.withDescription(
		'Upload files as entries, replacing any entry with the same key.'
	)
);

const remove = Command.make(
	'delete',
	{
		keys: keyArguments,
		yes: Flag.Boolean('yes').pipe(
			Flag.withDescription('Confirm: deleted entries cannot be restored'),
			Flag.withDefault(false)
		)
	},
	({ keys }) =>
		Effect.gen(function* () {
			const store = yield* openStore;
			yield* Effect.forEach(keys, (raw) =>
				Effect.gen(function* () {
					const key = yield* decodeKey(raw);
					yield* store.delete(key);
					yield* Console.log(
						`deleted ${key} from ${store.bucketName}`
					);
				}), { concurrency: 1 });
		})
).pipe(
	Command.withDescription('Delete entries. Requires --yes.'),
	Command.validate(({ yes }) =>
		yes
			? Effect.void
			: Effect.fail(
				new CliError.ValidationError({
					message:
						'Deleted entries cannot be restored. Pass --yes to confirm.'
				})
			)
	)
);

corpus.pipe(
	Command.withSubcommands([list, get, put, remove]),
	Command.run({ version: '0.0.0' }),
	Effect.provide(cloudflareApi),
	BunRuntime.runMain
);
