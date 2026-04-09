# Publishing Your MCP Server

This guide covers how to share your MCP server with others, with a focus on **GitHub Releases** as the recommended distribution method.

---

## Distribution Options

| Method | Best For | Effort |
|--------|----------|--------|
| **GitHub Releases** (recommended) | Sharing with specific people or the community | Low |
| **npm** | Broad public distribution, `npx`-style usage | Medium |
| **Git clone / local** | Internal teams, development sharing | Minimal |

---

## GitHub Releases (Recommended)

GitHub Releases let you attach a pre-built `build/` folder as a zip file so users don't need to compile TypeScript themselves — they just download and run.

### Why GitHub Releases?

- No npm account or publish step required
- Versioned and tagged (users know exactly what they're running)
- Users can download a zip and point Claude Desktop directly at it
- You can include release notes describing what changed

---

### Step 1 — Prepare the build

```bash
npm run build
```

Verify the `build/` folder contains `index.js` and no TypeScript errors.

### Step 2 — Create a zip of the build output

Only include what users need to run the server:

```bash
# On Windows (PowerShell)
Compress-Archive -Path build\ -DestinationPath openlibrary-mcp-v1.0.0.zip

# On macOS/Linux
zip -r openlibrary-mcp-v1.0.0.zip build/
```

> You do **not** need to include `node_modules/` — this server has no runtime dependencies beyond the built JS files.

### Step 3 — Tag a release in Git

```bash
git tag v1.0.0
git push origin v1.0.0
```

### Step 4 — Create the release on GitHub

1. Go to your repo on GitHub
2. Click **Releases** in the right sidebar (or go to `github.com/<you>/<repo>/releases`)
3. Click **Draft a new release**
4. Select the tag you just pushed (`v1.0.0`)
5. Set the **Release title**: e.g. `v1.0.0 — Initial release`
6. Write **release notes** (see template below)
7. Under **Assets**, click **Attach binaries** and upload your zip file
8. Click **Publish release**

#### Release notes template

```markdown
## What's new
- Initial release of the Open Library MCP server

## Installation
1. Download `openlibrary-mcp-v1.0.0.zip` below
2. Extract it anywhere on your machine
3. Add to your Claude Desktop config (see README)

## Requirements
- Node.js 18+
```

---

## How Users Install from a GitHub Release

Once you've published a release, here's what users do:

### Step 1 — Download and extract

1. Go to the **Releases** page of the repo
2. Download the zip file from the Assets section
3. Extract it to a permanent location, e.g.:
   - Windows: `C:\Tools\openlibrary-mcp\`
   - macOS: `~/tools/openlibrary-mcp/`

The extracted folder should contain a `build/` directory with `index.js` inside.

### Step 2 — Verify Node.js is installed

```bash
node --version
# Should print v18.x.x or higher
```

### Step 3 — Add to Claude Desktop

Edit the Claude Desktop config file:

| Platform | Config path |
|----------|-------------|
| Windows  | `%APPDATA%\Claude\claude_desktop_config.json` |
| macOS    | `~/Library/Application Support/Claude/claude_desktop_config.json` |

Add the server entry:

**Windows:**
```json
{
  "mcpServers": {
    "openlibrary": {
      "command": "node",
      "args": ["C:\\Tools\\openlibrary-mcp\\build\\index.js"]
    }
  }
}
```

**macOS/Linux:**
```json
{
  "mcpServers": {
    "openlibrary": {
      "command": "node",
      "args": ["/Users/you/tools/openlibrary-mcp/build/index.js"]
    }
  }
}
```

### Step 4 — Restart Claude Desktop

Quit and reopen Claude Desktop. A hammer icon in the chat input confirms tools are active.

### Step 5 — Test it

Ask Claude: _"Search for books about artificial intelligence"_ — it should use the `search_books` tool automatically.

---

## Publishing to npm (Alternative)

If you want users to install via `npx` without downloading anything manually:

### Step 1 — Create an npm account

Sign up at [npmjs.com](https://www.npmjs.com) if you don't have one.

### Step 2 — Log in

```bash
npm login
```

### Step 3 — Set the package name

Edit `package.json` — the `name` field must be unique on npm:

```json
{
  "name": "openlibrary-mcp",
  "version": "1.0.0"
}
```

Check if the name is taken: `npm info openlibrary-mcp`

### Step 4 — Build and publish

```bash
npm run build
npm publish
```

### Step 5 — Users install via npx

Once published, users can run it without downloading anything:

```json
{
  "mcpServers": {
    "openlibrary": {
      "command": "npx",
      "args": ["openlibrary-mcp"]
    }
  }
}
```

Or install globally:

```bash
npm install -g openlibrary-mcp
```

---

## Versioning

Use [Semantic Versioning](https://semver.org):

| Change type | Version bump | Example |
|-------------|-------------|---------|
| New tools added | Minor | `1.0.0` → `1.1.0` |
| Bug fix, no API change | Patch | `1.0.0` → `1.0.1` |
| Breaking change (tool renamed/removed) | Major | `1.0.0` → `2.0.0` |

Update `package.json` before each release:

```bash
npm version patch   # 1.0.0 → 1.0.1
npm version minor   # 1.0.0 → 1.1.0
npm version major   # 1.0.0 → 2.0.0
```

This also creates a git tag automatically.

---

## Checklist Before Publishing

- [ ] `npm run build` succeeds with no errors
- [ ] Tested with MCP Inspector: `npx @modelcontextprotocol/inspector node build/index.js`
- [ ] `.env` is in `.gitignore` (no secrets committed)
- [ ] `package.json` has correct `version`, `description`, and `"files": ["build"]`
- [ ] Release notes written
- [ ] Git tag pushed
