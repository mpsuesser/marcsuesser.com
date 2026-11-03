/**
 * Markdown files import as their text. The Worker's `Text` module rule uploads
 * them as text modules (see `ChatWorker.ts`), and the root Vitest config loads
 * them the same way.
 */
declare module '*.md' {
	const text: string;
	export default text;
}
