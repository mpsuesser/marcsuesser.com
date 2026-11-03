import { defineConfig } from 'vitest/config';

export default defineConfig({
	test: {
		name: 'website',
		root: import.meta.dirname,
		environment: 'happy-dom',
		setupFiles: ['./test/setup.ts'],
		include: ['test/**/*.test.ts'],
		exclude: ['**/node_modules/**', 'dist/**'],
		server: {
			deps: {
				inline: ['foldkit', '@foldkit/ui']
			}
		}
	}
});
