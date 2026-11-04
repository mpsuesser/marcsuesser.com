# marcsuesser.com

Marc Suesser's personal site: one page, one chat box, answering questions about Marc from a corpus of Markdown entries kept in a private Cloudflare R2 bucket.

Built with Effect, Foldkit, and Alchemy on Cloudflare Workers.

```sh
bun install
cp .env.example .env   # add OPENAI_API_KEY
bun run check
bun run dev            # whole stack via alchemy dev
bun run deploy:dev     # workers.dev; creates the dev corpus bucket
bun run corpus put apps/chat/corpus.example/*.md --stage dev   # seed it
```

The corpus never enters the repository: the chat Worker reads it from R2 on each turn, and `bun run corpus` (`list`, `get`, `put`, `delete`) edits it using your Alchemy Cloudflare login. To run your own copy, deploy, then `put` your own entries.

See `AGENTS.md` for how the pieces fit.
