# feed2social

Implements the `#laco_feed` system on Twitter, Misskey and Bluesky using a Cloudflare Worker and a Notion data source.

![feed2social architecture](docs/archtecture.png)

Shared coding-agent instructions are in [AGENTS.md](AGENTS.md). Claude Code 2.1.277+ can read it directly, depending on its Project instructions setting and any ancestor `CLAUDE.md` files.

## Development setup

Use Node.js `^24.0.0` and pnpm `10.33.4`, as declared in `package.json`. Select Node 24 with your runtime manager and verify `node --version` and `pnpm --version` before installing:

```sh
pnpm install --frozen-lockfile
```

The runtime is Cloudflare Workers with `nodejs_compat`, configured in `wrangler.toml`.

For development server bindings, create an ignored `.dev.vars` containing these credential names with your authorized values:

- `NOTION_TOKEN`
- `MISSKEY_TOKEN`
- `BSKY_PASSWORD`
- `TWITTER_API_KEY`
- `TWITTER_API_SECRET`
- `TWITTER_ACCESS_TOKEN`
- `TWITTER_ACCESS_SECRET`

`wrangler.toml` supplies `NOTION_DATA_SOURCE_ID`, `BSKY_ID`, `SENTRY_DSN`, and `SENTRY_RELEASE`. Verify the intended resources before accessing external services; override bindings locally when appropriate. Do not print or commit credentials. Do not create credentials or change production configuration as part of routine setup.

## Verification

Offline unit tests and formatting checks:

```sh
pnpm exec vitest run --testNamePattern='^(?!.*integration tests)'
pnpm run lint
```

Tests are embedded in source files through `import.meta.vitest`; `vite.config.ts` enables `includeSource`. Twitter adapter tests mock `fetch` and do not post. The command above excludes the live HTTP integration test in `src/page-title.ts`.

To run the complete suite, including that external page read, or use watch mode:

```sh
pnpm run test:ci
pnpm test
pnpm exec vitest run src/page-title.ts
```

CI runs installation, formatting checks and the complete test suite. `pnpm run format` rewrites matched source files; review the resulting diff.

Optional type checking:

```sh
pnpm exec tsc --noEmit
```

The existing TypeScript 6 configuration uses deprecated `moduleResolution=node` and fails this command. Suppressing the deprecation also reveals an `@atproto/api` resolution error. For a diagnostic check without editing configuration:

```sh
pnpm exec tsc --noEmit --moduleResolution bundler
```

This override is not a persistent configuration fix and is not a CI step.

## Local server and external effects

```sh
pnpm start
```

This sets `NODE_ENV=development` and starts `wrangler dev --test-scheduled`. Development mode exposes `GET /_/execute`: it reads Notion and linked pages and sends Sentry telemetry, while skipping social posts and Notion status updates.

The scheduled handler does **not** enable dry-run mode. Invoking the scheduled test endpoint can post to Twitter, Misskey and Bluesky, update Notion, and send Sentry check-ins even in development mode. Do not invoke scheduled events during routine verification. A local server is not sufficient isolation from external services when real bindings are present.

Production cron is `*/5 * * * *` in `wrangler.toml`. Its entry point is `src/worker.ts`; Twitter posting is in `src/social/twitter.ts`, and Notion status updates are in `src/repository.ts`.

`pnpm run deploy` deploys the Worker and its configuration, including cron triggers. Deployment and production changes require explicit authorization and are not part of local setup.

## License

MIT License
