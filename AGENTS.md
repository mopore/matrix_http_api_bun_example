# AGENTS.md - AI Coding Agent Instructions

## Project Overview

Matrix HTTP API example using Bun runtime. A bot that communicates with Matrix homeserver
via direct HTTP API calls (no SDK) in an unencrypted room.

**Why no SDK?** This project avoids the official Matrix JS SDK due to compatibility issues between the SDK's crypto sublibraries and the Bun runtime. It is **not** a general restriction on 3rd party libraries. You are free to use other libraries (e.g., for environment variables, logging, or state management) as needed. **Prefer native Bun features (e.g. `Bun.env`, `Bun.sqlite`, `Bun.password`) where available over 3rd party libraries.**

**Runtime:** Bun (not Node.js)
**Language:** TypeScript (strict mode)
**Module System:** ESM (`"type": "module"`)

---

## Build/Run Commands

```bash
# Install dependencies
bun install

# Run the application
bun run src/index.ts

# Type check (no emit)
bun run tsc --noEmit

# Lint
bun lint

# Run with env file
bun --env-file=.env run src/index.ts
```

### Testing

No test framework configured yet. When adding tests:

```bash
# Run all tests
bun test

# Run single test file
bun test path/to/file.test.ts

# Run tests matching pattern
bun test --filter "pattern"

# Watch mode
bun test --watch
```

Test files should use `*.test.ts` or `*.spec.ts` suffix.

---

## Environment Variables

Required in `.env`:
- `MATRIX_HOMESERVER` - Matrix server URL (default: https://matrix.mopore.org)
- `MATRIX_BOT_ACCESS_TOKEN` - Bot's access token (required)
- `MATRIX_ROOM_ID` - Target room ID (required)
- `MATRIX_USER_ID` - Human user ID to respond to

---

## TypeScript Configuration

Strict mode enabled with these key flags:
- `strict: true`
- `noUncheckedIndexedAccess: true` - Index access returns `T | undefined`
- `noFallthroughCasesInSwitch: true`
- `noImplicitOverride: true`
- `verbatimModuleSyntax: true` - Use `import type` for type-only imports

---

## Code Style Guidelines

### Formatting

- **Indentation:** Tabs (not spaces)
- **Quotes:** Double quotes for strings
- **Semicolons:** Required
- **Line length:** ~100 chars soft limit
- **Trailing commas:** Use in multiline

### Naming Conventions

- **Variables/Functions:** camelCase (`sendMessageAsync`, `syncOnceAsync`)
- **Async functions:** Suffix with `Async` (`whoamiAsync`, `syncOnceAsync`)
- **Types/Interfaces:** PascalCase (`MatrixEvent`, `SyncResponse`)
- **Constants:** UPPER_SNAKE_CASE for env-derived (`SERVER_URL`, `BOT_TOKEN`, `ROOM_ID`)
- **Files:** camelCase for TypeScript files (`matrixHttpApi.ts`)

### Function Definitions

Use arrow functions, not classical function declarations:

```typescript
// Correct - arrow function
const processEventsAsync = async (events: MatrixEvent[]): Promise<void> => {
    for (const ev of events) {
        // process event
    }
};

// Correct - arrow function with parameters
const sendTextAsync = async (roomId: string, body: string): Promise<void> => {
    const txnId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    await apiAsync(`/_matrix/client/v3/rooms/${enc(roomId)}/send/m.room.message/${enc(txnId)}`, {
        method: "PUT",
        body: JSON.stringify({ msgtype: "m.text", body }),
    });
};

// Incorrect - classical function declaration
async function processEvents(): Promise<void> { ... }
```

### Imports

```typescript
// Use type imports for types only
import type { SomeType } from "./types.ts";

// Include .ts extension (Bun bundler mode)
import { helper } from "./utils.ts";
```

### Type Definitions

- **Avoid `any`** - Define proper types for API responses and data structures

```typescript
// Correct - define types for API responses
type WhoamiResponse = { user_id: string };
type MatrixEvent = {
    event_id?: string;
    type?: string;
    sender?: string;
    content?: { msgtype?: string; body?: string };
};

const data = (await apiAsync("/endpoint")) as WhoamiResponse;

// Incorrect - using any
const data = (await apiAsync("/endpoint")) as any;
```

```typescript
// Prefer type aliases for object shapes
type MatrixClientConfig = {
    homeserver: string;
    botAccessToken: string;
    roomId: string;
    humanUserId: string;
};

// Use `as` for API response typing (external data)
const data = (await response.json()) as SomeType;
```

### Error Handling

```typescript
// Throw descriptive errors for critical failures
if (!TOKEN || !ROOM_ID) {
    throw new Error("Missing MATRIX_ACCESS_TOKEN or MATRIX_ROOM_ID");
}

// Log and continue for loop errors
try {
    // operation
} catch (err) {
    console.error("Loop error:", err);
    await new Promise((r) => setTimeout(r, 2000));
}
```

### Async Patterns

- Use async/await (no raw Promises)
- Top-level await supported in Bun (no IIFE needed)
- Use `while (true)` for long-polling loops

### Bun-Specific APIs

```typescript
// File operations
const file = Bun.file(path);
const exists = await file.exists();
const content = await file.json();
await Bun.write(path, JSON.stringify(data, null, 2));

// Prefer native fetch (Bun optimized)
const res = await fetch(url, { method, headers, body });
```

### HTTP/API Patterns

```typescript
// URL encoding helper
const enc = encodeURIComponent;

// Headers pattern
const headers = new Headers(init.headers);
headers.set("Authorization", `Bearer ${TOKEN}`);
headers.set("Content-Type", "application/json");

// Error response handling
if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${path}\n${text.slice(0, 800)}`);
}
```

---

## Project Structure

```
src/
  index.ts          # Main entry point, example bot usage
  matrixHttpApi.ts  # Matrix API module with callbacks
.env                # Environment config (not committed)
```

---

## Git Practices

- Keep commits concise
- Don't commit `.env`
- Request approval before pushing

---

## Common Patterns

### Matrix API Endpoints

- `GET /_matrix/client/v3/account/whoami` - Get current user
- `PUT /_matrix/client/v3/rooms/{roomId}/send/m.room.message/{txnId}` - Send message
- `POST /_matrix/client/v3/join/{roomIdOrAlias}` - Join room
- `GET /_matrix/client/v3/sync` - Long-poll for events

### Deduplication

Use a `Set<string>` to track processed event IDs and skip duplicates.
