# marcsuesser.com Agent Instructions

The site is a single page with a chat box that answers questions about Marc from a fixed corpus. It is an Effect-first Bun monorepo deployed to Cloudflare Workers with Alchemy; the page is a Foldkit app.

```
alchemy.run.ts             the one stack: the chat Worker plus the website, joined by a service binding
apps/chat/                 chat Worker: corpus, system prompt, model call, rate limit, NDJSON stream
  context/                 the corpus, one Markdown file per topic
apps/website/              Foldkit page and its thin Worker, which forwards /api/* to the chat Worker
packages/chat-contract/    the wire contract both sides decode through: ChatRequest, ChatEvent
```

## Request path

The browser POSTs the visible conversation to `/api/chat`. The website Worker runs only for `/api/*` (`assets.runWorkerFirst`), and forwards over the `CHAT` service binding, so the chat Worker has no public URL. The chat Worker rate-limits by `cf-connecting-ip`, prepends the system prompt, and streams `ChatEvent`s as NDJSON. Every turn ends with exactly one `Finished` or `Failed`; the client enforces the same end-of-turn invariant when the connection drops. Conversation history lives only in the visitor's localStorage.

The chat Worker serves an Effect `HttpRouter` (`chatRoutes` in `apps/chat/src/ChatHttp.ts`) and streams with `HttpServerResponse.stream` through `Ndjson.encodeSchema`; the client decodes with `HttpClient` and `Ndjson.decodeSchema`. Effect RPC is left out on purpose: on workerd it has a cross-request fiber bug (see `RequestOwnedRpcProtocol.ts` in CurationSpace); revisit once that is fixed upstream.

The website Worker (`apps/website/src/worker/WebsiteWorker.ts`) is a Workers module rather than an Effect Worker, because `Cloudflare.Website.Foldkit` bundles it as the site's custom `main`; it only forwards `/api/*` to `CHAT`.

## Corpus

Each file in `apps/chat/context/` is imported explicitly in `apps/chat/src/Corpus.ts`; the Worker bundles them through a `Text` module rule, and tests load them through the `markdownAsText` plugin in `apps/chat/vitest.config.ts`. Adding a file means adding its import and entry there; `test/Corpus.test.ts` goes red when the directory and the manifest disagree. Replace the corpus by swapping the files, not the mechanism.

The model id is `CHAT_MODEL` in `apps/chat/src/ChatTurn.ts`.

## Commands

Run from the repository root.

- `bun run check` runs typecheck, lint, and tests through Turborepo. It must be green before any deploy.
- `bun run --cwd apps/website dev` serves the page alone with Vite; chat requests fail, which is enough for UI work.
- `bun run dev` runs the whole stack with `alchemy dev`, reading `.env` (copy `.env.example`).
- `bun run deploy:dev` deploys the `dev` stage to workers.dev. `bun run deploy:prod` reads `.env.prod` and updates the live site at `marcsuesser.com` (with `www` redirecting to it); confirm with Marc before running it.

## Conventions

The `enfect` plugin is enabled for Claude Code (`.claude/settings.json`) and OpenCode (`opencode.jsonc`); load its Effect skills before writing Effect code.

Lint and type rules come from CurationSpace's configuration (`.oxlintrc.json`, `tsconfig.base.json`, the Effect language service). Fix the code to satisfy a rule; a disable comment carries a `--` reason. In tests, assert with `assert` from `@effect/vitest`.

Framework source and docs are checked out under `~/.local/share/opencode/repos/github.com/`: `Effect-TS/effect@main`, `foldkit/foldkit@main`, `alchemy-run/alchemy-effect@main`, and scraped docs in `mpsuesser/scraped-docs-foldkit@main` and `mpsuesser/scraped-docs-alchemy@main`. Settle API questions there.
