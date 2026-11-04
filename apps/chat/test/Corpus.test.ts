import { assert, describe, it } from '@effect/vitest';
import * as Duration from 'effect/Duration';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Ref from 'effect/Ref';
import { TestClock } from 'effect/testing';

import {
	CorpusFile,
	CorpusKey,
	isCorpusKey,
	renderCorpus,
	reuseFor
} from '../src/Corpus.ts';

const entry = (key: string, content: string) =>
	new CorpusFile({ key: CorpusKey.make(key), content });

describe('CorpusKey', () => {
	it('accepts kebab-case Markdown slugs', () => {
		assert.isTrue(isCorpusKey('childhood-in-trieste.md'));
		assert.isTrue(isCorpusKey('01-origin.md'));
	});

	it('rejects anything else', () => {
		assert.isFalse(isCorpusKey('Notes.md'));
		assert.isFalse(isCorpusKey('drafts/origin.md'));
		assert.isFalse(isCorpusKey('origin.txt'));
		assert.isFalse(isCorpusKey('-origin.md'));
	});
});

describe('renderCorpus', () => {
	it('wraps each entry in a context element, sorted by key', () => {
		assert.strictEqual(
			renderCorpus([
				entry('yodel-duel.md', '  The duel.\n'),
				entry('origin.md', 'The foam.')
			]),
			'<context path="origin.md">\nThe foam.\n</context>\n\n'
				+ '<context path="yodel-duel.md">\nThe duel.\n</context>'
		);
	});

	it('leaves out blank entries', () => {
		assert.strictEqual(
			renderCorpus([entry('blank.md', ' \n'), entry('origin.md', 'x')]),
			'<context path="origin.md">\nx\n</context>'
		);
	});
});

describe('reuseFor', () => {
	const counting = Effect.gen(function* () {
		const reads = yield* Ref.make(0);
		const read = Ref.updateAndGet(reads, (n) => n + 1);
		return { reads, read };
	});

	it.effect('reuses a read within the window and rereads after it', () =>
		Effect.gen(function* () {
			const { reads, read } = yield* counting;
			const reused = yield* reuseFor(read, Duration.minutes(1));

			assert.strictEqual(yield* reused, 1);
			yield* TestClock.adjust(Duration.seconds(59));
			assert.strictEqual(yield* reused, 1);
			yield* TestClock.adjust(Duration.seconds(1));
			assert.strictEqual(yield* reused, 2);
			assert.strictEqual(yield* Ref.get(reads), 2);
		}));

	it.effect('never keeps a failure', () =>
		Effect.gen(function* () {
			const attempts = yield* Ref.make(0);
			const flaky = Ref.updateAndGet(attempts, (n) => n + 1).pipe(
				Effect.filterOrFail((n) => n > 1, () => 'down')
			);
			const reused = yield* reuseFor(flaky, Duration.minutes(1));

			assert.isTrue(Exit.isFailure(yield* Effect.exit(reused)));
			assert.strictEqual(yield* reused, 2);
			assert.strictEqual(yield* reused, 2);
		}));
});
