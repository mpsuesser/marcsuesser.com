import { assert, describe, it } from '@effect/vitest';
import * as Arr from 'effect/Array';
import * as Order from 'effect/Order';
import * as R from 'effect/Record';
import * as Str from 'effect/String';

import { corpus, corpusBlock } from '../src/Corpus.ts';
import { systemPrompt } from '../src/SystemPrompt.ts';

/** Every Markdown file under context/, listed by Vite without loading them. */
const onDisk = Arr.sort(
	Arr.map(
		R.keys(import.meta.glob('../context/**/*.md')),
		Str.replace('../context/', '')
	),
	Order.String
);

describe('corpus', () => {
	it('includes every Markdown file in context/', () => {
		assert.deepStrictEqual(Arr.map(corpus, (file) => file.path), onDisk);
	});

	it('wraps each file in a context element in the system prompt', () => {
		assert.include(corpusBlock, '<context path="01-origin.md">');
		assert.include(corpusBlock, 'The Trieste Incident');
		assert.include(systemPrompt, corpusBlock);
	});
});
