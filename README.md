# Open Library MCP Server

An **educational** MCP (Model Context Protocol) server that wraps the [Open Library API](https://openlibrary.org) — a free, public book catalog with millions of titles.

This project is designed to teach you how MCP servers work by showing a complete, real-world example from scratch.

---

## What is MCP?

The **Model Context Protocol** is an open standard that lets AI models connect to external data sources and tools. It defines how an AI host (like Claude Desktop) communicates with external processes (MCP servers) using JSON-RPC messages.

```
┌─────────────────────────┐        JSON-RPC       ┌──────────────────────────┐
│   Claude Desktop (Host) │ ◄──── stdin/stdout ───► │  This MCP Server        │
│   - Embeds Claude AI    │                         │  - Searches Open Library │
│   - Manages MCP clients │                         │  - Returns book data     │
└─────────────────────────┘                         └──────────────────────────┘
```

When you add this server to Claude Desktop, Claude can:
- Search for books and authors
- Look up book details by ISBN
- Browse subjects and genres
- Get author biographies

All in natural language — Claude decides *when* to use the tools based on your conversation.

---

## Core MCP Concepts

### Tools
Tools are **functions the AI can call**. They have:
- A **name** (used internally by the protocol)
- A **description** (shown to the AI to decide when to use it — write these carefully!)
- An **input schema** (Zod-validated, type-safe parameters)
- A **handler** (your async function that does the work)

```
User: "Find books about artificial intelligence"
Claude: [decides to call search_books with query="artificial intelligence"]
Server: [fetches from Open Library, returns formatted results]
Claude: [explains the results in natural language]
```

### Resources
Resources are **data identified by a URI**. Think of them like files — you read them by URI:
- `openlibrary://book/9780441172719` — full book data as JSON
- `openlibrary://author/OL26320A` — author data as JSON

Resources are "read-only" — you don't call them with parameters, you read them by URI. The host application (Claude Desktop) decides when to include a resource in the conversation context.

### Prompts
Prompt templates are **reusable message structures** that guide users through workflows. Not implemented in this server, but useful for things like "explain this book in simple terms" workflows.

---

## Project Structure

```
my-mcp/
├── src/
│   ├── index.ts              # Entry point — wires stdio transport to server
│   ├── server.ts             # MCP server — all tool/resource registrations
│   ├── api/
│   │   └── openLibrary.ts    # HTTP client — all fetch() calls to Open Library
│   └── types/
│       └── openLibrary.ts    # TypeScript interfaces for API responses
├── package.json              # ESM config + dependencies
├── tsconfig.json             # TypeScript compiler options (Node16 module mode)
└── README.md                 # This file
```

**Why this structure?** Each file has a single responsibility:
- `index.ts` — transport (how the server communicates)
- `server.ts` — protocol (what capabilities the server exposes)
- `api/` — data (how to talk to Open Library)
- `types/` — types (what the data looks like)

---

## Prerequisites

- **Node.js 18+** (required for native `fetch()`)
- **npm**

---

## Installation & Build

```bash
# 1. Install dependencies
npm install

# 2. Compile TypeScript → JavaScript
npm run build

# Output goes to build/ folder
```

---

## Available Tools

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `search_books` | Full-text book search with filters | `query`, `limit`, `offset`, `author`, `subject`, `language` |
| `get_book_by_isbn` | Detailed book info by ISBN | `isbn` |
| `search_authors` | Search authors by name | `query`, `limit` |
| `get_author_details` | Author bio and external IDs | `ol_author_id` |
| `get_author_works` | List an author's works | `ol_author_id`, `limit` |
| `get_books_by_subject` | Browse by topic/genre | `subject`, `limit` |

## Available Resources

| URI Pattern | Description |
|------------|-------------|
| `openlibrary://book/{isbn}` | Full book data as JSON |
| `openlibrary://author/{ol_id}` | Author data as JSON |

---

## Adding to Claude Desktop

### Step 1 — Find your config file

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |

### Step 2 — Add the server

Edit the config file and add an `mcpServers` entry:

```json
{
  "mcpServers": {
    "openlibrary": {
      "command": "node",
      "args": ["C:\\Repo\\my-mcp\\build\\index.js"]
    }
  }
}
```

> **Windows paths**: Use either double backslashes `C:\\Repo\\my-mcp\\build\\index.js` or forward slashes `C:/Repo/my-mcp/build/index.js`.

### Step 3 — Restart Claude Desktop

Quit and reopen Claude Desktop. You should see a hammer (🔨) icon in the chat interface indicating MCP tools are active.

---

## Testing with MCP Inspector

Before connecting to Claude Desktop, you can test the server with the **MCP Inspector** — a browser-based UI for exploring MCP servers:

```bash
npx @modelcontextprotocol/inspector node build/index.js
```

This opens `http://localhost:5173` where you can:
- See all registered tools and resources
- Call tools with test inputs and see raw responses
- Inspect the JSON-RPC messages being exchanged

**Recommended first test**: Call `search_books` with `query: "dune"` to verify the server reaches Open Library.

---

## Example Conversations (Claude Desktop)

Once connected, try these prompts:

```
"Search for books about machine learning"
"Find all books by Isaac Asimov"
"Search for authors named Ursula"
"Get details for the author OL26320A"  (J.R.R. Tolkien's OL ID)
"What books did Frank Herbert write?"
"Show me science fiction books"
"Get book details for ISBN 9780441172719"  (Dune)
"What's the biography of author OL18921A?" (Ursula K. Le Guin)
```

---

## Key Technical Decisions

### Why `"type": "module"` in package.json?
The `@modelcontextprotocol/sdk` uses ESM (ES Modules) sub-path exports like
`@modelcontextprotocol/sdk/server/mcp.js`. These only work correctly when your
project is also in ESM mode. Setting `"type": "module"` enables this.

### Why `"module": "Node16"` in tsconfig?
Node16 module resolution is required to correctly handle:
1. ESM sub-path imports from the MCP SDK
2. The `.js` extension in relative imports (e.g., `import { server } from "./server.js"`)

Using `"bundler"` or `"node"` mode would cause import resolution failures.

### Why Zod for input schemas?
The MCP SDK uses Zod for input validation. You pass a "raw Zod shape" to
`inputSchema` (an object of Zod fields, NOT `z.object({...})`). The SDK wraps
it in `z.object()` automatically and generates the JSON Schema for the protocol.

### Why `console.error()` everywhere?
In a stdio MCP server, `process.stdout` is the JSON-RPC communication channel.
Anything written to stdout that isn't valid JSON-RPC corrupts the protocol.
`console.error()` writes to `process.stderr`, which is a separate channel safe
for logging.

### Why return `null` instead of throwing in the API client?
Tool handlers can either:
- **Throw** → protocol-level error (generic "tool failed" message to the AI)
- **Return `{ isError: true }`** → soft error (the AI can read and explain it)

The API client returns `null` on failure so tool handlers can construct
descriptive soft errors. This gives Claude more context to work with.

---

## Authentication & API Keys

The Open Library API is public and requires no authentication. But when building MCP servers for authenticated APIs (Stripe, GitHub, Notion, etc.), you need to securely manage credentials. Here are the patterns:

### Pattern 1: Environment Variables (Recommended)

Store API keys as environment variables, then read them in your API client:

**File: `src/api/stripe.ts` (example)**
```typescript
const STRIPE_API_KEY = process.env.STRIPE_API_KEY;

if (!STRIPE_API_KEY) {
  throw new Error("STRIPE_API_KEY environment variable is not set");
}

async function fetchJSON<T>(url: string, method = "GET"): Promise<T | null> {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        "Authorization": `Bearer ${STRIPE_API_KEY}`,  // ← Add auth header
        "Content-Type": "application/json",
      }
    });
    return await response.json() as T;
  } catch (error) {
    console.error(`API error:`, error);
    return null;
  }
}
```

**To use it:**

Windows:
```bash
set STRIPE_API_KEY=sk_test_abc123xyz
npm run build
node build/index.js
```

macOS/Linux:
```bash
export STRIPE_API_KEY=sk_test_abc123xyz
npm run build
node build/index.js
```

### Pattern 2: .env File (For Development)

Create `.env` in your project root:

```
STRIPE_API_KEY=sk_test_abc123xyz
GITHUB_TOKEN=ghp_abc123xyz
NOTION_TOKEN=secret_abc123xyz
OPENAI_API_KEY=sk-proj-abc123xyz
```

Install dotenv:
```bash
npm install dotenv
```

Load it in `src/index.ts` (first thing before other imports):
```typescript
import "dotenv/config";  // ← Load .env file
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";

// Now process.env.STRIPE_API_KEY is available everywhere
```

**CRITICAL:** Add `.env` to `.gitignore` — never commit secrets!

```
# .gitignore
.env
.env.local
node_modules/
build/
```

### Pattern 3: API Key as Tool Parameter

Let users provide the key when calling the tool (less secure, but flexible):

```typescript
server.registerTool(
  "stripe_get_customer",
  {
    description: "Get a Stripe customer by ID",
    inputSchema: {
      customer_id: z.string().min(1),
      api_key: z.string().optional()
        .describe("Stripe API key (uses STRIPE_API_KEY env var if not provided)")
    }
  },
  async ({ customer_id, api_key }) => {
    const key = api_key || process.env.STRIPE_API_KEY;
    if (!key) {
      return errorResult("API key not provided and STRIPE_API_KEY env var not set");
    }
    // Use key to make API call
    const data = await getStripeCustomer(customer_id, key);
    return textResult(JSON.stringify(data, null, 2));
  }
);
```

**Trade-off:** Users can override the key per-call, but the key could appear in chat history.

---

## Configuring MCP Servers with Authentication

### For VS Code + GitHub Copilot

Edit `.vscode/mcp.json`:

```json
{
  "servers": {
    "stripe": {
      "type": "stdio",
      "command": "node",
      "args": ["${workspaceFolder}/build/index.js"],
      "env": {
        "STRIPE_API_KEY": "${env:STRIPE_API_KEY}",
        "GITHUB_TOKEN": "${env:GITHUB_TOKEN}"
      }
    }
  }
}
```

The `${env:VARIABLE_NAME}` syntax tells VS Code to read from system environment variables.

### For Claude Desktop

Edit `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

**Option A: Using system environment variables (recommended)**
```json
{
  "mcpServers": {
    "stripe": {
      "command": "node",
      "args": ["C:\\Repo\\stripe-mcp\\build\\index.js"],
      "env": {
        "STRIPE_API_KEY": "${env:STRIPE_API_KEY}"
      }
    }
  }
}
```

First set the system environment variable:
```bash
setx STRIPE_API_KEY sk_test_abc123xyz
# Restart Claude Desktop for it to see the new variable
```

**Option B: Direct value (less secure, convenient for testing)**
```json
{
  "mcpServers": {
    "stripe": {
      "command": "node",
      "args": ["C:\\Repo\\stripe-mcp\\build\\index.js"],
      "env": {
        "STRIPE_API_KEY": "sk_test_abc123xyz"
      }
    }
  }
}
```

**Use Option A in production** — it keeps secrets out of the config file.

---

## Real-World Example: Building a Stripe MCP Server

Here's what an authenticated MCP server for Stripe might look like:

**`src/api/stripe.ts`**
```typescript
import type { Customer, Charge } from "@stripe/stripe-sdk";

const API_KEY = process.env.STRIPE_API_KEY;
const API_BASE = "https://api.stripe.com/v1";

async function fetchStripe<T>(endpoint: string, method = "GET", body?: any): Promise<T | null> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      method,
      headers: {
        "Authorization": `Bearer ${API_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body ? new URLSearchParams(body).toString() : undefined,
    });

    if (!response.ok) {
      console.error(`[Stripe] HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    return (await response.json()) as T;
  } catch (error) {
    console.error(`[Stripe] Network error:`, error);
    return null;
  }
}

export async function getCustomer(customerId: string): Promise<Customer | null> {
  return fetchStripe(`/customers/${customerId}`);
}

export async function listCharges(customerId: string, limit = 10): Promise<any | null> {
  return fetchStripe(`/charges?customer=${customerId}&limit=${limit}`);
}

export async function createPaymentIntent(
  amount: number,
  currency = "usd"
): Promise<any | null> {
  return fetchStripe("/payment_intents", "POST", {
    amount,
    currency,
  });
}
```

**`src/server.ts` (excerpt)**
```typescript
server.registerTool(
  "stripe_get_customer",
  {
    description: "Get Stripe customer details including name, email, and payment methods",
    inputSchema: {
      customer_id: z.string().min(1).describe("Stripe customer ID, e.g. 'cus_abc123'")
    }
  },
  async ({ customer_id }) => {
    const customer = await getCustomer(customer_id);
    if (!customer) {
      return errorResult(
        `Failed to fetch customer ${customer_id}. ` +
        `Check that the customer ID is correct and STRIPE_API_KEY is set.`
      );
    }
    return textResult(JSON.stringify(customer, null, 2));
  }
);

server.registerTool(
  "stripe_list_charges",
  {
    description: "List recent charges for a Stripe customer",
    inputSchema: {
      customer_id: z.string().min(1),
      limit: z.number().int().min(1).max(100).optional().default(10)
    }
  },
  async ({ customer_id, limit }) => {
    const charges = await listCharges(customer_id, limit);
    if (!charges) {
      return errorResult(`Failed to fetch charges for customer ${customer_id}`);
    }
    // Format charges for display...
    return textResult(charges);
  }
);
```

---

## Security Best Practices

1. **Never commit `.env` files** — add to `.gitignore`
2. **Use environment variables in production** — don't hardcode secrets
3. **Rotate API keys regularly** — especially if someone has access to your machine
4. **Use read-only API keys where possible** — if Stripe has "read-only" tokens, use those for queries
5. **Validate all inputs** — even if you're just passing them to an external API
6. **Log with caution** — never log API keys, tokens, or other secrets to files or console
7. **Keep dependencies updated** — `npm audit` regularly

---

## How the Code Flows



Here's what happens when Claude calls `search_books`:

```
Claude Desktop
  │
  │  JSON-RPC: { method: "tools/call", params: { name: "search_books", arguments: { query: "dune" } } }
  │
  ▼
index.ts (StdioServerTransport)
  │  Reads message from stdin
  │
  ▼
server.ts (McpServer routing)
  │  Finds the "search_books" registration
  │  Validates input against Zod schema
  │  Calls the handler function
  │
  ▼
server.ts (search_books handler)
  │  Calls searchBooks("dune", 10, 0, ...)
  │
  ▼
api/openLibrary.ts (searchBooks)
  │  Builds URL: https://openlibrary.org/search.json?q=dune&limit=10
  │  Calls fetch()
  │
  ▼
Open Library API (external)
  │  Returns JSON response
  │
  ▲
api/openLibrary.ts
  │  Parses JSON, returns OLSearchResponse
  │
  ▲
server.ts (search_books handler)
  │  Formats results as a text string
  │  Returns { content: [{ type: "text", text: "..." }] }
  │
  ▲
index.ts (StdioServerTransport)
  │  Writes JSON-RPC response to stdout
  │
  ▲
Claude Desktop
  │  Receives the book list
  │  Presents it to the user in natural language
```

---

## Next Steps

Now that you understand the pattern, try extending this server:

1. **Add a `get_work_editions` tool** — fetch all editions of a work using `/works/{id}/editions.json`
2. **Add a `trending_books` tool** — use Open Library's recent changes feed
3. **Add a prompt** — a "book recommendation" prompt that structures the conversation
4. **Add HTTP transport** — make the server accessible over the network (not just local stdio)
5. **Add caching** — cache frequent API responses to avoid rate limits

MCP documentation: https://modelcontextprotocol.io
TypeScript SDK: https://github.com/modelcontextprotocol/typescript-sdk
