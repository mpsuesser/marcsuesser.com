/**
 * The Worker in front of the website's static build. Only `/api/*` reaches it
 * (see `runWorkerFirst` in `alchemy.run.ts`); it hands those requests to the
 * chat Worker over its service binding, so the browser talks to one origin
 * and the OpenAI key stays in the chat Worker. Everything else, including
 * deep links, is served from the static assets.
 *
 * It is a plain Workers module rather than an Effect Worker because
 * `Cloudflare.Website.Foldkit` bundles it as the site's custom `main`.
 */

interface Fetcher {
	readonly fetch: (request: Request) => Promise<Response>;
}

/** The bindings this Worker reads; `alchemy.run.ts` declares them. */
export interface WebsiteWorkerEnv {
	readonly ASSETS: Fetcher;
	readonly CHAT: Fetcher;
}

export default {
	fetch: (request: Request, env: WebsiteWorkerEnv): Promise<Response> =>
		new URL(request.url).pathname.startsWith('/api/')
			? env.CHAT.fetch(request)
			: env.ASSETS.fetch(request)
};
