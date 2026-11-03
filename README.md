# marcsuesser.com

Marc Suesser's personal site: one page, one chat box, answering questions about Marc from the material in `apps/chat/context/`.

Built with Effect, Foldkit, and Alchemy on Cloudflare Workers.

```sh
bun install
cp .env.example .env   # add OPENAI_API_KEY
bun run check
bun run dev            # whole stack via alchemy dev
bun run deploy:dev     # workers.dev
```

See `AGENTS.md` for how the pieces fit and how to change the corpus.
