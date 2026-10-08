# Agent instructions

Shared repository instructions for all coding agents. Claude Code 2.1.277+ can read this file directly, depending on its Project instructions setting and any ancestor `CLAUDE.md` files. No agent-specific CLI or personal skill is required. See [README.md](README.md) for development setup and commands.

## Working rules

- Preserve existing user changes and inspect the working tree before editing.
- Use the Node.js and pnpm versions declared in package.json and preserve pnpm-lock.yaml.
- Keep credentials in ignored local configuration; never print their values or commit them.
- Default to unit tests with mocked external APIs. The full test suite includes a live HTTP integration test.
- Treat scheduled execution as a write operation: it posts to social networks and updates Notion even in development mode. Do not invoke it without explicit authorization.
- The development `/_/execute` endpoint skips social posting and Notion updates, but reads external services and sends Sentry telemetry. It is not an offline test.
- Posting, production changes, billing, credential creation, commit, push, and deployment require authorization for the current task.
- Use the README verification commands. Report failures and skipped checks; do not change application configuration just to make a documentation check pass.

## Architecture Overview

### Core Purpose

This is a Cloudflare Workers application that automatically posts content from a Notion database to multiple social networks (Twitter, Misskey, Bluesky). It implements the `#laco_feed` system.

### Execution Flow

1. **Scheduled Trigger**: Runs every 5 minutes via cron trigger
2. **Data Fetching**: Fetches new feed items from Notion database
3. **Content Processing**: Extracts page titles from URLs with multi-encoding support
4. **Post Creation**: Creates social media posts with similarity detection
5. **Multi-Platform Posting**: Posts to Twitter, Misskey, and Bluesky
6. **Status Tracking**: Updates Notion database with completion status

### Main modules

#### Data Models (`src/models.ts`)

- `FeedItem`: Represents a Notion page with URL and completion tracking
- `PostData`: Social media post structure with title, URL, and optional note
- `SocialNetworkAdapter`: Interface for social network implementations

#### Core Modules

- `src/worker.ts`: Main entry point, handles cron scheduling and HTTP requests
- `src/repository.ts`: Notion database operations and feed item management
- `src/create-post.ts`: Post content generation with title similarity detection
- `src/page-title.ts`: Web page title extraction with multi-encoding support
- `src/encoding.ts`: Character encoding detection and conversion (UTF-8, Shift-JIS, EUC-JP)

#### Social Network Adapters (`src/social/`)

- `twitter.ts`: Twitter API integration with OAuth 1.0a
- `misskey.ts`: Misskey API integration
- `bluesky.ts`: Bluesky AT Protocol integration

### Technical Details

#### Character Encoding Support

- Uses `encoding-japanese` library for Japanese character set support
- Automatically detects charset from HTTP headers and HTML meta tags
- Supports UTF-8, Shift-JIS, EUC-JP, and ISO-2022-JP
- Requires `nodejs_compat` flag in Cloudflare Workers

#### Environment Configuration

- Development mode exposes `/_/execute`, which calls `execute` with `dryRun=true`.
- The scheduled handler calls `execute` without dry-run mode, regardless of NODE_ENV.
- Debug endpoint: `/_/execute` available in development
- Required environment variables: `NOTION_TOKEN`, social network credentials, Sentry configuration

#### Testing Strategy

- In-source testing with Vitest (`if (import.meta.vitest)`)
- Integration tests use real URLs for encoding validation
- Mock fetch API for unit tests
- Character encoding tests use actual Japanese content

#### Error Handling & Monitoring

- Sentry integration for error tracking and performance monitoring
- Breadcrumb tracking throughout execution flow
- Check-in monitoring for scheduled executions
- Graceful fallbacks for encoding detection failures

### Dependencies

- Node.js ^24.0.0 and pnpm 10.33.4 required (package.json is authoritative)
- Uses Cloudflare Workers runtime
- Key libraries: Hono (web framework), Notion client, Cheerio (HTML parsing), encoding-japanese
