import { defineConfig } from 'vitest/config';

/** Runs every workspace's own Vitest config, so `vitest` at the root matches `bun run test`. */
export default defineConfig({
	test: {
		projects: ['apps/chat', 'apps/website', 'packages/chat-contract']
	}
});
