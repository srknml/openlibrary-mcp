/**
 * @fileoverview Entry point for the Open Library MCP server.
 *
 * ═══════════════════════════════════════════════════════════════
 *  WHAT THIS FILE DOES
 * ═══════════════════════════════════════════════════════════════
 * This file is the "glue" between the MCP server (server.ts) and the
 * transport mechanism. It:
 *
 *   1. Creates a StdioServerTransport (reads from stdin, writes to stdout)
 *   2. Calls server.connect(transport) to start handling MCP messages
 *
 * That's it. Everything else lives in server.ts and api/openLibrary.ts.
 *
 * ═══════════════════════════════════════════════════════════════
 *  WHAT IS THE STDIO TRANSPORT?
 * ═══════════════════════════════════════════════════════════════
 * "Stdio" stands for standard input/output. In MCP:
 *
 *   STDIN  → The MCP client (e.g. Claude Desktop) sends JSON-RPC messages
 *             to this server by writing to this process's stdin.
 *
 *   STDOUT → This server sends JSON-RPC responses back by writing to stdout.
 *
 * Claude Desktop manages the server lifecycle:
 *   - Starts this process when it needs the server
 *   - Connects to it via stdin/stdout pipes
 *   - Can terminate it at any time
 *
 * This is sometimes called "IPC over stdio" (inter-process communication).
 * It requires no networking, no port binding, and no authentication — it's
 * the simplest possible MCP transport and the standard choice for local tools.
 *
 * ═══════════════════════════════════════════════════════════════
 *  ⚠️  THE #1 STDIO GOTCHA: console.log IS FORBIDDEN
 * ═══════════════════════════════════════════════════════════════
 * In an stdio MCP server, stdout is the communication channel.
 * If you write ANYTHING to stdout other than valid JSON-RPC messages,
 * you corrupt the protocol and the client will fail to parse responses.
 *
 * WRONG — this breaks the connection:
 *   console.log("Server started!");  // writes to stdout ← CORRUPTS PROTOCOL
 *
 * CORRECT — stderr is a separate channel, safe for logging:
 *   console.error("Server started!"); // writes to stderr ← safe
 *
 * This is why ALL logging in this project uses console.error().
 *
 * ═══════════════════════════════════════════════════════════════
 *  PROCESS LIFECYCLE
 * ═══════════════════════════════════════════════════════════════
 * The server runs until:
 *   - The transport closes (client disconnects)
 *   - The process receives SIGTERM/SIGINT
 *   - An unhandled error occurs
 *
 * server.connect() completes the initialization handshake and returns.
 * After that, the Node.js event loop keeps the process alive while
 * stdin remains open (the transport's event listener holds a reference).
 */

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { server } from "./server.js";

/**
 * Main entry point. Creates the stdio transport and connects the server.
 *
 * Why async? server.connect() is asynchronous — it performs the MCP
 * initialization handshake (capability negotiation) before returning.
 *
 * @returns Promise that resolves when the server has connected successfully
 */
async function main(): Promise<void> {
  // StdioServerTransport uses process.stdin and process.stdout by default.
  // No configuration needed — it works with Node's built-in stream handles.
  const transport = new StdioServerTransport();

  // Connect the server to the transport.
  // This triggers the MCP initialization sequence:
  //   1. Client sends an "initialize" request with its capabilities
  //   2. Server responds with its own capabilities (our tools and resources)
  //   3. Client sends "initialized" notification to confirm
  //   4. Server is now ready to handle tool calls and resource reads
  await server.connect(transport);

  // This goes to stderr (safe) — stdout is reserved for JSON-RPC messages
  console.error("[openlibrary-mcp] Server connected and ready.");
  console.error("[openlibrary-mcp] Listening for MCP messages on stdin...");
}

// ---------------------------------------------------------------------------
// TOP-LEVEL ERROR HANDLER
// ---------------------------------------------------------------------------
// If main() rejects (e.g., transport fails to initialize), we catch it here,
// log the error to stderr, and exit with a non-zero code.
//
// The non-zero exit code signals to Claude Desktop (or any process manager)
// that the server failed to start, so it can show an error to the user.

main().catch((error: unknown) => {
  console.error("[openlibrary-mcp] Fatal error during startup:", error);
  process.exit(1);
});
