/**
 * @fileoverview MCP server definition — tools and resources for the Open Library API.
 *
 * ═══════════════════════════════════════════════════════════════
 *  WHAT IS AN MCP SERVER?
 * ═══════════════════════════════════════════════════════════════
 * An MCP server exposes "capabilities" to an AI model via a standardized
 * JSON-RPC protocol. The AI model (running inside a host like Claude Desktop)
 * can discover what capabilities are available and call them on demand.
 *
 * Think of it like a plugin system: you write the plugin (this file), and
 * Claude decides when to use it based on the descriptions you provide.
 *
 * ═══════════════════════════════════════════════════════════════
 *  THE THREE MCP CAPABILITY TYPES
 * ═══════════════════════════════════════════════════════════════
 *
 * 1. TOOLS — Functions the AI can call (implemented in this file)
 *    - Model-controlled: the AI decides WHEN to call them
 *    - Take structured input (validated by Zod schemas)
 *    - Return text/images/etc. back to the AI
 *    - Example: search_books, get_book_by_isbn
 *    - Registered with: server.registerTool(name, config, handler)
 *
 * 2. RESOURCES — Data identified by a URI (implemented in this file)
 *    - Application-controlled: the host decides when to include them
 *    - Identified by URIs like "openlibrary://book/9780441172719"
 *    - Return content (text, binary, etc.) when "read"
 *    - Like REST GET endpoints — they retrieve, not act
 *    - Registered with: server.registerResource(name, uri, config, handler)
 *
 * 3. PROMPTS — Reusable message templates (NOT implemented here)
 *    - User-controlled: the user explicitly invokes them
 *    - Useful for structured workflows ("explain this book")
 *    - Registered with: server.registerPrompt(name, config, handler)
 *
 * WHY TOOLS vs RESOURCES for book lookup?
 * We implement book/author lookup as BOTH:
 *   - Tools: for the AI to call with parameters during conversation
 *   - Resources: for direct URI-based access (e.g., "read openlibrary://book/...")
 * This demonstrates both patterns in one server.
 *
 * ═══════════════════════════════════════════════════════════════
 *  ARCHITECTURE
 * ═══════════════════════════════════════════════════════════════
 *   index.ts  →  server.ts  →  api/openLibrary.ts  →  Open Library API
 *   (transport)   (MCP layer)    (HTTP layer)           (external)
 *
 * This file knows about MCP but NOT about HTTP.
 * The api/ module knows about HTTP but NOT about MCP.
 */
import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { searchBooks, getBookByISBN, searchAuthors, getAuthorDetails, getAuthorWorks, getBooksBySubject, } from "./api/openLibrary.js";
// =============================================================================
// SERVER INSTANTIATION
// =============================================================================
/**
 * The McpServer is the core object of any MCP server.
 *
 * It maintains the registry of tools/resources/prompts, handles JSON-RPC
 * message routing, and manages the protocol lifecycle (initialization,
 * capability negotiation, shutdown).
 *
 * The name and version appear in the MCP initialization handshake.
 * Clients use them to display which server they're connected to.
 *
 * We export `server` so index.ts can call server.connect(transport).
 */
export const server = new McpServer({
    name: "openlibrary-mcp",
    version: "1.0.0",
});
// =============================================================================
// SHARED HELPERS
// =============================================================================
/**
 * Creates a "soft error" result for MCP tools.
 *
 * MCP PROTOCOL NOTE — Two types of errors exist:
 *
 *   1. PROTOCOL ERRORS: Thrown exceptions in the tool handler.
 *      These cause the entire tool call to fail with a JSON-RPC error.
 *      The AI sees a generic "tool failed" message.
 *
 *   2. SOFT ERRORS: Returned as { isError: true, content: [...] }.
 *      The tool call "succeeds" at the protocol level, but the content
 *      signals that something went wrong. The AI can read the message
 *      and explain the problem to the user in natural language.
 *
 * We use soft errors throughout because they give the AI more context
 * to work with and produce better user experiences.
 *
 * @param message - Human-readable description of what went wrong
 */
function errorResult(message) {
    return {
        isError: true,
        content: [{ type: "text", text: `Error: ${message}` }],
    };
}
/**
 * Creates a standard text result for MCP tools.
 *
 * MCP tools return an array of "content items" — each can be text,
 * an image, audio, or an embedded resource. For this server we only
 * need text, but the array structure is part of the protocol.
 *
 * @param text - The text content to return to the AI
 */
function textResult(text) {
    return {
        content: [{ type: "text", text }],
    };
}
/**
 * Extracts a plain string from an Open Library `bio` field.
 *
 * Open Library's API is inconsistent about the bio format.
 * Some authors have bio as a plain string, others as an object:
 *   { "type": "/type/text", "value": "The actual biography text..." }
 *
 * This helper normalizes both cases so callers don't need to think about it.
 *
 * @param bio - The bio field from an OLAuthorDetail response
 * @returns The biography as a plain string, or a fallback message
 */
function extractBio(bio) {
    if (!bio)
        return "No biography available.";
    if (typeof bio === "string")
        return bio;
    return bio.value ?? "No biography available.";
}
/**
 * Formats a list of items into a numbered text block for display.
 * Each item can have multiple lines; items are separated by blank lines.
 *
 * @param items - Array of multi-line string blocks, one per result
 * @param header - Optional header line to prepend
 */
function formatList(items, header) {
    const body = items.join("\n\n");
    return header ? `${header}\n\n${body}` : body;
}
// =============================================================================
// TOOL: search_books
// =============================================================================
/**
 * Searches the Open Library catalog for books matching a query.
 *
 * HOW TOOL REGISTRATION WORKS:
 * server.registerTool(name, config, handler) takes three arguments:
 *
 *   name    — Unique string identifier. The AI uses this name to call the tool.
 *             Choose something descriptive and snake_case.
 *
 *   config  — An object with:
 *     description: What the tool does (shown to the AI to decide when to use it)
 *     inputSchema: A RAW ZOD SHAPE — an object of Zod field definitions
 *
 *   handler — An async function that receives validated, typed input and
 *             returns a content result. Input is already type-safe here.
 *
 * CRITICAL GOTCHA — inputSchema format:
 *   CORRECT:  inputSchema: { query: z.string(), limit: z.number() }
 *   WRONG:    inputSchema: z.object({ query: z.string() })
 *
 * The SDK wraps your shape in z.object() automatically. Passing z.object()
 * directly causes a type error or unexpected behavior.
 */
server.registerTool("search_books", {
    description: "Search for books in the Open Library catalog. Returns titles, authors, publication years, ISBNs, and subjects. " +
        "Use this to discover books by topic, find books by a specific author, or explore a subject area. " +
        "Supports pagination via limit and offset. Author IDs in results can be used with get_author_details.",
    inputSchema: {
        query: z
            .string()
            .min(1)
            .describe("Search query — can be a title, author name, keyword, or phrase"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .default(10)
            .describe("Maximum number of results to return (1–100, default: 10)"),
        offset: z
            .number()
            .int()
            .min(0)
            .optional()
            .default(0)
            .describe("Number of results to skip — use with limit for pagination (default: 0)"),
        author: z
            .string()
            .optional()
            .describe("Filter results to this author name"),
        subject: z
            .string()
            .optional()
            .describe("Filter results to this subject or topic"),
        language: z
            .string()
            .optional()
            .describe("Filter by ISO 639-2 language code, e.g. 'eng' for English, 'fre' for French"),
    },
}, async ({ query, limit, offset, author, subject, language }) => {
    const data = await searchBooks(query, limit, offset, author, subject, language);
    if (!data) {
        return errorResult("Failed to reach the Open Library search API. The service may be temporarily unavailable.");
    }
    if (data.docs.length === 0) {
        return textResult(`No books found for query: "${query}"${author ? ` by "${author}"` : ""}. Try a broader search.`);
    }
    const bookItems = data.docs.map((doc, i) => {
        const lines = [
            `${offset + i + 1}. ${doc.title ?? "Unknown title"}`,
            `   Authors:        ${doc.author_name?.join(", ") ?? "Unknown"}`,
            `   Author IDs:     ${doc.author_key?.join(", ") ?? "N/A"}  ← use with get_author_details`,
            `   First published: ${doc.first_publish_year ?? "Unknown"}`,
            `   ISBN (first):   ${doc.isbn?.[0] ?? "N/A"}`,
            `   Edition count:  ${doc.edition_count ?? "N/A"}`,
            `   Languages:      ${doc.language?.slice(0, 5).join(", ") ?? "N/A"}`,
            `   Subjects:       ${doc.subject?.slice(0, 3).join(", ") ?? "N/A"}`,
        ];
        return lines.join("\n");
    });
    const header = `Search: "${query}" | Found ${data.numFound.toLocaleString()} total | ` +
        `Showing ${data.docs.length} (offset: ${offset})`;
    return textResult(formatList(bookItems, header));
});
// =============================================================================
// TOOL: get_book_by_isbn
// =============================================================================
server.registerTool("get_book_by_isbn", {
    description: "Get detailed information about a specific book using its ISBN-10 or ISBN-13. " +
        "Returns full metadata: publishers, subjects, cover image URLs, page count, and " +
        "external identifiers (Goodreads, LibraryThing). Hyphens in the ISBN are handled automatically.",
    inputSchema: {
        isbn: z
            .string()
            .min(10)
            .max(17)
            .describe("ISBN-10 or ISBN-13 with or without hyphens, e.g. '9780441172719' or '978-0-441-17271-9'"),
    },
}, async ({ isbn }) => {
    const data = await getBookByISBN(isbn);
    if (!data) {
        return errorResult(`Failed to fetch book data for ISBN: ${isbn}. The API may be temporarily unavailable.`);
    }
    // The /api/books response is keyed by "ISBN:xxxx"
    const cleanISBN = isbn.replace(/[-\s]/g, "");
    const bibkey = `ISBN:${cleanISBN}`;
    const book = data[bibkey];
    if (!book) {
        return errorResult(`No book found for ISBN: ${isbn}. ` +
            `The ISBN may be incorrect, or this edition may not be in the Open Library catalog.`);
    }
    // Build the output line by line, skipping fields that aren't present
    // The filter(Boolean) at the end removes the null entries
    const lines = [
        `Title:            ${book.title ?? "Unknown"}`,
        book.subtitle
            ? `Subtitle:         ${book.subtitle}`
            : null,
        `Authors:          ${book.authors?.map((a) => a.name).join(", ") ?? "Unknown"}`,
        `Published:        ${book.publish_date ?? "Unknown"}`,
        `Publisher(s):     ${book.publishers?.map((p) => p.name).join(", ") ?? "Unknown"}`,
        `Pages:            ${book.number_of_pages ?? "Unknown"}`,
        `ISBN-10:          ${book.isbn_10?.join(", ") ?? "N/A"}`,
        `ISBN-13:          ${book.isbn_13?.join(", ") ?? "N/A"}`,
        book.subjects?.length
            ? `Subjects:         ${book.subjects.map((s) => s.name).join(", ")}`
            : null,
        book.subject_people?.length
            ? `Subject People:   ${book.subject_people.map((s) => s.name).join(", ")}`
            : null,
        book.subject_places?.length
            ? `Subject Places:   ${book.subject_places.map((s) => s.name).join(", ")}`
            : null,
        book.subject_times?.length
            ? `Subject Times:    ${book.subject_times.map((s) => s.name).join(", ")}`
            : null,
        book.notes ? `Notes:            ${book.notes}` : null,
        book.cover?.medium
            ? `Cover image:      ${book.cover.medium}`
            : null,
        book.identifiers?.goodreads?.length
            ? `Goodreads ID:     ${book.identifiers.goodreads.join(", ")}`
            : null,
        book.identifiers?.librarything?.length
            ? `LibraryThing ID:  ${book.identifiers.librarything.join(", ")}`
            : null,
        book.url ? `Open Library URL: ${book.url}` : null,
    ].filter((line) => line !== null);
    return textResult(lines.join("\n"));
});
// =============================================================================
// TOOL: search_authors
// =============================================================================
server.registerTool("search_authors", {
    description: "Search for authors by name in the Open Library catalog. " +
        "Returns matching authors with their Open Library IDs (OL IDs), birth/death dates, and work counts. " +
        "Use the OL ID with get_author_details or get_author_works for more information.",
    inputSchema: {
        query: z.string().min(1).describe("Author name to search for"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(50)
            .optional()
            .default(10)
            .describe("Maximum number of authors to return (default: 10)"),
    },
}, async ({ query, limit }) => {
    const data = await searchAuthors(query, limit);
    if (!data) {
        return errorResult("Failed to search authors. The API may be temporarily unavailable.");
    }
    if (data.docs.length === 0) {
        return textResult(`No authors found matching: "${query}". Try a different spelling or a shorter name.`);
    }
    const authorItems = data.docs.map((author, i) => {
        return [
            `${i + 1}. ${author.name ?? "Unknown name"}`,
            `   OL Author ID:   ${author.key}  ← use with get_author_details / get_author_works`,
            `   Birth date:     ${author.birth_date ?? "Unknown"}`,
            `   Death date:     ${author.death_date ?? "Living or unknown"}`,
            `   Top work:       ${author.top_work ?? "N/A"}`,
            `   Works in catalog: ${author.work_count ?? "Unknown"}`,
        ].join("\n");
    });
    const header = `Authors matching "${query}" — found ${data.numFound} total, showing ${data.docs.length}`;
    return textResult(formatList(authorItems, header));
});
// =============================================================================
// TOOL: get_author_details
// =============================================================================
server.registerTool("get_author_details", {
    description: "Get detailed information about an author using their Open Library author ID (OL ID). " +
        "Returns biography, birth/death dates, Wikipedia link, and external identifiers " +
        "(Wikidata, VIAF, ISNI). Get the OL ID from search_authors.",
    inputSchema: {
        ol_author_id: z
            .string()
            .min(1)
            .describe("Open Library author ID, e.g. 'OL26320A'. Can include or omit the '/authors/' prefix."),
    },
}, async ({ ol_author_id }) => {
    const data = await getAuthorDetails(ol_author_id);
    if (!data) {
        return errorResult(`Failed to fetch author details for ID: "${ol_author_id}". ` +
            `Make sure the OL Author ID is correct (e.g. 'OL26320A'). ` +
            `Use search_authors to find author IDs.`);
    }
    const lines = [
        `Name:             ${data.name ?? "Unknown"}`,
        data.personal_name && data.personal_name !== data.name
            ? `Full name:        ${data.personal_name}`
            : null,
        `OL Key:           ${data.key}`,
        `Birth date:       ${data.birth_date ?? "Unknown"}`,
        `Death date:       ${data.death_date ?? "Living or unknown"}`,
        data.wikipedia ? `Wikipedia:        ${data.wikipedia}` : null,
        data.remote_ids?.wikidata ? `Wikidata:         ${data.remote_ids.wikidata}` : null,
        data.remote_ids?.viaf ? `VIAF:             ${data.remote_ids.viaf}` : null,
        data.remote_ids?.isni ? `ISNI:             ${data.remote_ids.isni}` : null,
        `\nBiography:\n${extractBio(data.bio)}`,
    ].filter((line) => line !== null);
    return textResult(lines.join("\n"));
});
// =============================================================================
// TOOL: get_author_works
// =============================================================================
server.registerTool("get_author_works", {
    description: "Get a list of works (books) by an author using their Open Library author ID. " +
        "Returns titles, first publication dates, and subject tags. " +
        "The total work count is also shown — use limit to control how many are returned.",
    inputSchema: {
        ol_author_id: z
            .string()
            .min(1)
            .describe("Open Library author ID, e.g. 'OL26320A'"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .default(20)
            .describe("Maximum number of works to return (default: 20)"),
    },
}, async ({ ol_author_id, limit }) => {
    const data = await getAuthorWorks(ol_author_id, limit);
    if (!data) {
        return errorResult(`Failed to fetch works for author ID: "${ol_author_id}".`);
    }
    if (!data.entries || data.entries.length === 0) {
        return textResult(`No works found for author ID: "${ol_author_id}".`);
    }
    const workItems = data.entries.map((work, i) => {
        const lines = [
            `${i + 1}. ${work.title ?? "Untitled"}`,
            `   Work key:         ${work.key}`,
            work.first_publish_date
                ? `   First published:  ${work.first_publish_date}`
                : null,
            work.subject?.length
                ? `   Subjects:         ${work.subject.slice(0, 3).join(", ")}`
                : null,
        ].filter((line) => line !== null);
        return lines.join("\n");
    });
    const header = `Author ID: ${ol_author_id} | Total works: ${data.size} | Showing ${data.entries.length}`;
    return textResult(formatList(workItems, header));
});
// =============================================================================
// TOOL: get_books_by_subject
// =============================================================================
server.registerTool("get_books_by_subject", {
    description: "Browse books by subject or topic using the Open Library subject catalog. " +
        "Good for genre browsing or topic-based discovery. " +
        "Spaces in subject names are converted to underscores automatically. " +
        "Example subjects: 'science_fiction', 'biography', 'history', 'cooking', 'mathematics'.",
    inputSchema: {
        subject: z
            .string()
            .min(1)
            .describe("Subject or topic to browse. Spaces become underscores automatically, e.g. 'science fiction' → 'science_fiction'"),
        limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .optional()
            .default(20)
            .describe("Maximum number of books to return (default: 20)"),
    },
}, async ({ subject, limit }) => {
    const data = await getBooksBySubject(subject, limit);
    if (!data) {
        return errorResult(`Failed to fetch books for subject: "${subject}". The API may be temporarily unavailable.`);
    }
    if (!data.works || data.works.length === 0) {
        return textResult(`No books found for subject: "${subject}". ` +
            `Try a different subject name, e.g. "science_fiction", "fantasy", "history".`);
    }
    const bookItems = data.works.map((work, i) => {
        const lines = [
            `${i + 1}. ${work.title ?? "Untitled"}`,
            `   Work key:         ${work.key}`,
            `   Authors:          ${work.authors?.map((a) => a.name).join(", ") ?? "Unknown"}`,
            work.first_publish_year
                ? `   First published:  ${work.first_publish_year}`
                : null,
            work.subject?.length
                ? `   Subjects:         ${work.subject.slice(0, 3).join(", ")}`
                : null,
        ].filter((line) => line !== null);
        return lines.join("\n");
    });
    const displayName = data.name ?? subject;
    const totalWorks = data.work_count != null ? data.work_count.toLocaleString() : "unknown";
    const header = `Subject: "${displayName}" | Total works: ${totalWorks} | Showing ${data.works.length}`;
    return textResult(formatList(bookItems, header));
});
// =============================================================================
// RESOURCE: openlibrary://book/{isbn}
// =============================================================================
/**
 * WHAT ARE RESOURCES?
 * Resources are data that can be "read" by URI — like files on a filesystem.
 * They're identified by a URI scheme you define (here: "openlibrary://").
 *
 * Unlike tools (which perform actions), resources are read-only data access.
 * The MCP host (Claude Desktop) can let users explicitly "include" a resource
 * in the context window, similar to attaching a file.
 *
 * RESOURCE TEMPLATES:
 * A ResourceTemplate defines a URI pattern with variables in curly braces.
 * "openlibrary://book/{isbn}" matches URIs like:
 *   - "openlibrary://book/9780441172719"
 *   - "openlibrary://book/0441172717"
 *
 * The variable {isbn} is extracted and passed to the handler automatically.
 *
 * The second argument `{ list: undefined }` means we don't implement listing
 * all possible URIs — there are too many ISBNs to enumerate.
 */
server.registerResource("book-by-isbn", new ResourceTemplate("openlibrary://book/{isbn}", { list: undefined }), {
    title: "Open Library Book",
    description: "Full book data from Open Library, fetched by ISBN. " +
        "URI format: openlibrary://book/{isbn} — e.g. openlibrary://book/9780441172719",
    mimeType: "application/json",
}, async (uri, { isbn }) => {
    // Variables from the template can be strings or string arrays — handle both
    const isbnStr = Array.isArray(isbn) ? isbn[0] : isbn;
    const data = await getBookByISBN(isbnStr);
    if (!data) {
        // Resources throw on failure (unlike tools which return soft errors)
        // The MCP SDK catches this and returns a protocol-level resource error
        throw new Error(`Failed to fetch book data for ISBN: ${isbnStr}`);
    }
    const cleanISBN = isbnStr.replace(/[-\s]/g, "");
    const book = data[`ISBN:${cleanISBN}`];
    if (!book) {
        throw new Error(`No book found in Open Library for ISBN: ${isbnStr}`);
    }
    // Resources return structured content with a URI and MIME type
    return {
        contents: [
            {
                uri: uri.toString(),
                mimeType: "application/json",
                text: JSON.stringify(book, null, 2),
            },
        ],
    };
});
// =============================================================================
// RESOURCE: openlibrary://author/{ol_id}
// =============================================================================
server.registerResource("author-by-id", new ResourceTemplate("openlibrary://author/{ol_id}", { list: undefined }), {
    title: "Open Library Author",
    description: "Author data from Open Library, fetched by Open Library author ID. " +
        "URI format: openlibrary://author/{ol_id} — e.g. openlibrary://author/OL26320A",
    mimeType: "application/json",
}, async (uri, { ol_id }) => {
    const idStr = Array.isArray(ol_id) ? ol_id[0] : ol_id;
    const data = await getAuthorDetails(idStr);
    if (!data) {
        throw new Error(`Failed to fetch author data for OL ID: ${idStr}`);
    }
    return {
        contents: [
            {
                uri: uri.toString(),
                mimeType: "application/json",
                text: JSON.stringify(data, null, 2),
            },
        ],
    };
});
