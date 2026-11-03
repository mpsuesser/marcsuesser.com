import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		name: 'chat-contract',
		root: import.meta.dirname,
		include: ['test/**/*.test.ts'],
		exclude: ['**/node_modules/**']
	}
});
