import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

/**
 * Loads Markdown as its text, the way the chat Worker's `Text` module rule
 * uploads it, so tests import the same corpus the deployed Worker serves.
 */
const markdownAsText: Plugin = {
	name: 'marcsuesser:markdown-as-text',
	enforce: 'pre',
	transform: (code, id) =>
		id.endsWith('.md')
			// oxlint-disable-next-line effect/avoid-direct-json -- A module's source must be a JavaScript string literal.
			? { code: `export default ${JSON.stringify(code)};`, map: null }
			: undefined
};

export default defineConfig({
	plugins: [markdownAsText],
	test: {
		name: 'chat',
		root: import.meta.dirname,
		include: ['test/**/*.test.ts'],
		exclude: ['**/node_modules/**']
	}
});
