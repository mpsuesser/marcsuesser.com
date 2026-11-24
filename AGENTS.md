# marcsuesser.com Agent Instructions

The site is a single page with a chat box that answers questions about Marc from a corpus kept in a private R2 bucket, so the repository holds none of it. It is an Effect-first Bun monorepo deployed to Cloudflare Workers with Alchemy; the page is a Foldkit app.

```
alchemy.run.ts             the one stack: the chat Worker plus the website, joined by a service binding
apps/chat/                 chat Worker: corpus, system prompt, model call, rate limit, NDJSON stream
  scripts/corpus.ts        the corpus CLI (`bun run corpus`)
  corpus.example/          a fictional corpus for seeding a dev stage
apps/website/              Foldkit page and its thin Worker, which forwards /api/* to the chat Worker
packages/chat-contract/    the wire contract both sides decode through: ChatRequest, ChatEvent
```

## Request path

The browser POSTs the visible conversation to `/api/chat`. The website Worker runs only for `/api/*` (`assets.runWorkerFirst`), and forwards over the `CHAT` service binding, so the chat Worker has no public URL. The chat Worker rate-limits by `cf-connecting-ip`, prepends the system prompt with the corpus, and streams `ChatEvent`s as NDJSON. Every turn ends with exactly one `Finished` or `Failed`; the client enforces the same end-of-turn invariant when the connection drops. Conversation history lives only in the visitor's localStorage.

The chat Worker serves an Effect `HttpRouter` (`chatRoutes` in `apps/chat/src/ChatHttp.ts`) and streams with `HttpServerResponse.stream` through `Ndjson.encodeSchema`; the client decodes with `HttpClient` and `Ndjson.decodeSchema`. Effect RPC is left out on purpose: on workerd it has a cross-request fiber bug (see `RequestOwnedRpcProtocol.ts` in CurationSpace); revisit once that is fixed upstream.

Rate limiting sits behind the `ChatThrottle` service and the corpus behind the `Corpus` service. `ChatWorker.ts` provides both per request, because Cloudflare bindings need the request's `RuntimeContext`. The throttle fails open when the limiter errors; a corpus that can't be read ends the turn with `Failed`. Tests use `ChatThrottle.layerAllowAll` / `layerDenyAll` and `Corpus.layerFiles` / `layerUnavailable`.

On the page, `HttpClient` and `KeyValueStore` are Foldkit `resources` in `apps/website/src/entry.ts`, so commands and subscriptions require them and tests provide fakes.

`ChatLimits` keeps two caps: `maxDraftChars` bounds what a visitor types, `maxMessageChars` bounds every message on the wire. Assistant replies are sent back as history, so the wire cap must exceed the longest reply `ChatModel.maxOutputTokens` allows; reasoning tokens count against that cap too.

The website Worker (`apps/website/src/worker/WebsiteWorker.ts`) is a Workers module rather than an Effect Worker, because `Cloudflare.Website.Foldkit` bundles it as the site's custom `main`; it only forwards `/api/*` to `CHAT`.

## Corpus

The corpus lives only in the stage's R2 bucket, `marcsuesser-corpus-<stage>` (`CorpusBucket.ts`): one Markdown object per entry, keyed by a kebab-case slug ending in `.md` (`CorpusKey`). The bucket is `remote()`, so `alchemy dev` reads the dev stage's real bucket, and `retain()`, so no stack operation deletes it.

Each turn sends the whole corpus to the model, sorted by key so the prompt prefix stays cacheable; at this size that retrieves better than search. If the corpus outgrows the context, put Cloudflare AI Search over the same bucket behind the `Corpus` service. The Worker reuses one read for `CORPUS_TTL` (`reuseFor` in `Corpus.ts`, which explains why it isn't `Effect.cachedWithTTL`), so edits go live within a minute without a deploy.

Entries change through `bun run corpus` (`list`, `get`, `put`, `delete`; see `--help`), which signs in with the same Cloudflare credentials as `alchemy deploy`. A new stage's bucket exists after its first deploy and starts empty; seed a dev stage with `bun run corpus put apps/chat/corpus.example/*.md --stage <stage>`. Turning Marc's dictation into entries is the `corpus-dictation` skill.

The model, its service tier, its reasoning effort, its output-token cap, and the label the page shows under the composer are `ChatModel` in `packages/chat-contract`, so the page always names what the Worker calls.

## Commands

Run from the repository root.

- `bun run check` runs typecheck, lint, and tests through Turborepo. It must be green before any deploy.
- `bun run --cwd apps/website dev` serves the page alone with Vite; chat requests fail, which is enough for UI work.
- `bun run corpus <command> --stage <stage>` reads and writes a stage's corpus.
- `bun run dev` runs the whole stack with `alchemy dev`, reading `.env` (copy `.env.example`).
- `bun run deploy:dev` deploys the `dev` stage to workers.dev; pass `--yes` when no terminal can answer Alchemy's approval prompt. `bun run deploy:prod` reads `.env.prod` and updates the live site at `marcsuesser.com` (with `www` redirecting to it); confirm with Marc before running it.

## Conventions

The `enfect` plugin is enabled for Claude Code (`.claude/settings.json`) and OpenCode (`opencode.jsonc`); load its Effect skills before writing Effect code.

Lint and type rules come from CurationSpace's configuration (`.oxlintrc.json`, `tsconfig.base.json`, the Effect language service). Fix the code to satisfy a rule; a disable comment carries a `--` reason. In tests, assert with `assert` from `@effect/vitest`.

Framework source and docs are checked out under `~/.local/share/opencode/repos/github.com/`: `Effect-TS/effect@main`, `foldkit/foldkit@main`, `alchemy-run/alchemy-effect@main`, and scraped docs in `mpsuesser/scraped-docs-foldkit@main` and `mpsuesser/scraped-docs-alchemy@main`. Settle API questions there.
