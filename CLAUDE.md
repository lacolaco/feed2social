# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Essential Commands

- `pnpm install` - Install dependencies (uses pnpm 10.7.0)
- `npm run start` - Start development server with scheduled event testing
- `npm run deploy` - Deploy to Cloudflare Workers
- `npm test` - Run tests in watch mode
- `npm run test:ci` - Run tests once (for CI)
- `npm run lint` - Check code formatting with Prettier
- `npm run format` - Auto-format code with Prettier

### Testing

- `npm test src/page-title.ts` - Run tests for a specific file
- `npm test -- --run` - Run tests once without watch mode
- Tests use Vitest with in-source testing enabled (`import.meta.vitest`)
- Integration tests may take longer (10s timeout configured)

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

### Key Components

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

- Development mode: `NODE_ENV=development` skips actual posting
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

- Node.js 22.0.0+ required
- Uses Cloudflare Workers runtime
- Key libraries: Hono (web framework), Notion client, Cheerio (HTML parsing), encoding-japanese
