/**
 * @fileoverview HTTP client for the Open Library API.
 *
 * ROLE IN THE MCP ARCHITECTURE:
 * This file is the "data layer" — it knows how to talk to Open Library but
 * knows nothing about MCP. This separation is intentional:
 *
 *   src/api/openLibrary.ts  ← YOU ARE HERE (HTTP concerns)
 *   src/server.ts           ← MCP concerns (tool registration, formatting)
 *   src/index.ts            ← Transport concerns (stdio setup)
 *
 * Benefits of this separation:
 *   - You can test these functions independently (just call them in Node)
 *   - If Open Library changes an endpoint, only this file changes
 *   - server.ts stays focused on MCP protocol, not HTTP details
 *
 * OPEN LIBRARY API FACTS:
 *   - Base URL: https://openlibrary.org
 *   - Authentication: None required
 *   - Rate limits: ~1 req/sec without User-Agent, ~3 req/sec with User-Agent
 *   - Format: All endpoints return JSON (use ?format=json where needed)
 *   - Node 18+ has native fetch() — no extra packages needed
 *
 * ERROR HANDLING PHILOSOPHY:
 * Functions return `null` on failure rather than throwing exceptions.
 * This is a deliberate design choice for MCP servers:
 *
 *   - If we throw, the MCP SDK catches it and returns a protocol error
 *   - If we return null, the tool handler can return a user-friendly message
 *   - The AI can then tell the user *what went wrong* in natural language
 *
 * Always log errors to console.error() (stderr), NEVER console.log() (stdout).
 * In a stdio MCP server, stdout is the JSON-RPC channel — polluting it crashes
 * the connection with the client.
 */
// ---------------------------------------------------------------------------
// CONSTANTS
// ---------------------------------------------------------------------------
/** Base URL for all Open Library API requests */
const BASE_URL = "https://openlibrary.org";
/**
 * Default HTTP headers sent with every request.
 *
 * User-Agent is technically optional for Open Library, but it's good API
 * citizenship — it lets the Open Library team identify your app and reach
 * out if there's a problem. It also bumps rate limits from 1 to 3 req/sec.
 */
const DEFAULT_HEADERS = {
    "User-Agent": "openlibrary-mcp/1.0.0 (educational MCP server; github.com/your-handle/my-mcp)",
    "Accept": "application/json",
};
// ---------------------------------------------------------------------------
// INTERNAL HELPER
// ---------------------------------------------------------------------------
/**
 * Generic fetch wrapper that handles errors and JSON parsing.
 *
 * This function centralizes all the boilerplate that would otherwise be
 * repeated in every API function: error checking, JSON parsing, logging.
 *
 * The generic type parameter `T` lets callers tell TypeScript what shape
 * the response will be, giving them typed access to the result.
 *
 * @param url - The full URL to fetch (including query string)
 * @returns Parsed JSON as type T, or null if the request failed
 *
 * @example
 * const data = await fetchJSON<OLSearchResponse>(
 *   "https://openlibrary.org/search.json?q=dune&limit=5"
 * );
 * if (data) {
 *   console.error(`Found ${data.numFound} results`);
 * }
 */
async function fetchJSON(url) {
    try {
        const response = await fetch(url, { headers: DEFAULT_HEADERS });
        if (!response.ok) {
            // HTTP errors (4xx, 5xx) — the server responded but with an error status
            console.error(`[OpenLibrary] HTTP ${response.status} ${response.statusText} — GET ${url}`);
            return null;
        }
        return (await response.json());
    }
    catch (error) {
        // Network errors — DNS failure, connection refused, timeout, etc.
        console.error(`[OpenLibrary] Network error — GET ${url}:`, error);
        return null;
    }
}
// ---------------------------------------------------------------------------
// PUBLIC API FUNCTIONS
// ---------------------------------------------------------------------------
/**
 * Search for books using the Open Library full-text search API.
 *
 * The `q` parameter supports natural language queries as well as field-specific
 * search syntax like `title:dune` or `author:tolkien`. The optional filter
 * parameters further narrow results.
 *
 * @param query - Search query (title, author name, keyword, or phrase)
 * @param limit - Max results to return (1-100, default: 10)
 * @param offset - Results to skip — used for pagination (default: 0)
 * @param author - Optional: restrict results to this author name
 * @param subject - Optional: restrict results to this subject
 * @param language - Optional: ISO 639-2 language code, e.g. "eng", "fre", "spa"
 * @returns Search results, or null on failure
 *
 * @example
 * // Basic search
 * const results = await searchBooks("the lord of the rings");
 *
 * @example
 * // Filtered search with pagination
 * const page2 = await searchBooks("magic", 10, 10, "rowling", undefined, "eng");
 */
export async function searchBooks(query, limit = 10, offset = 0, author, subject, language) {
    const params = new URLSearchParams({
        q: query,
        limit: String(limit),
        offset: String(offset),
    });
    // Only add filter params if they were provided — sending empty strings
    // to the API can cause unexpected filtering behavior
    if (author)
        params.set("author", author);
    if (subject)
        params.set("subject", subject);
    if (language)
        params.set("language", language);
    return fetchJSON(`${BASE_URL}/search.json?${params.toString()}`);
}
/**
 * Get detailed book information by ISBN (10 or 13 digit).
 *
 * Unlike the search endpoint, the /api/books endpoint returns much richer data:
 * publisher details, cover image URLs, subject breakdowns, external identifiers
 * (Goodreads, LibraryThing), and more.
 *
 * The response is keyed by "ISBN:xxxx" — the caller must look up their ISBN
 * in the returned object. This is handled automatically in the MCP tool handler.
 *
 * @param isbn - ISBN-10 or ISBN-13, with or without hyphens
 * @returns Object keyed by "ISBN:xxxx", or null on failure
 *
 * @example
 * const result = await getBookByISBN("978-0-441-17271-9");
 * // result["ISBN:9780441172719"] contains the book data
 *
 * @example
 * // Hyphens are stripped automatically
 * const result = await getBookByISBN("0441172717");
 */
export async function getBookByISBN(isbn) {
    // Strip hyphens and spaces — Open Library requires clean digits only
    const cleanISBN = isbn.replace(/[-\s]/g, "");
    const params = new URLSearchParams({
        bibkeys: `ISBN:${cleanISBN}`,
        format: "json",
        // jscmd=data returns the rich "data" view (publishers, covers, subjects, etc.)
        // The alternative jscmd=details returns Open Library's internal representation
        jscmd: "data",
    });
    return fetchJSON(`${BASE_URL}/api/books?${params.toString()}`);
}
/**
 * Search for authors by name.
 *
 * Returns a list of matching authors with their Open Library IDs (OL IDs).
 * The OL ID can then be used with getAuthorDetails() or getAuthorWorks().
 *
 * @param query - Author name to search for
 * @param limit - Max authors to return (default: 10)
 * @returns Author search results, or null on failure
 *
 * @example
 * const authors = await searchAuthors("ursula le guin", 5);
 * // authors.docs[0].key might be "OL18921A"
 */
export async function searchAuthors(query, limit = 10) {
    const params = new URLSearchParams({
        q: query,
        limit: String(limit),
    });
    return fetchJSON(`${BASE_URL}/search/authors.json?${params.toString()}`);
}
/**
 * Get detailed author information by Open Library author ID.
 *
 * Returns the author's biography, birth/death dates, Wikipedia link,
 * and external identifiers (Wikidata, VIAF, ISNI).
 *
 * This function normalizes the ID format — you can pass either:
 *   - "OL23919A"           (bare ID from search results)
 *   - "/authors/OL23919A"  (full path from API responses)
 *
 * @param olAuthorId - Open Library author ID in either format
 * @returns Detailed author data, or null on failure
 *
 * @example
 * const tolkien = await getAuthorDetails("OL26320A");
 * const tolkienAlt = await getAuthorDetails("/authors/OL26320A"); // same result
 */
export async function getAuthorDetails(olAuthorId) {
    // Normalize: strip the "/authors/" prefix if present, then rebuild the URL
    // This handles IDs from both the search endpoint (bare: "OL23919A")
    // and from other endpoints (prefixed: "/authors/OL23919A")
    const id = olAuthorId.replace(/^\/authors\//, "");
    return fetchJSON(`${BASE_URL}/authors/${id}.json`);
}
/**
 * Get a list of works (books) by an author.
 *
 * Returns the author's works with titles, publication dates, and subject tags.
 * For authors with many works, use the `limit` parameter to control how many
 * are returned.
 *
 * @param olAuthorId - Open Library author ID (bare or prefixed format)
 * @param limit - Max works to return (default: 20)
 * @returns Author's works with total count, or null on failure
 *
 * @example
 * const works = await getAuthorWorks("OL26320A", 10);
 * console.error(`Author has ${works?.size} total works`);
 */
export async function getAuthorWorks(olAuthorId, limit = 20) {
    const id = olAuthorId.replace(/^\/authors\//, "");
    const params = new URLSearchParams({ limit: String(limit) });
    return fetchJSON(`${BASE_URL}/authors/${id}/works.json?${params.toString()}`);
}
/**
 * Get books categorized under a specific subject or topic.
 *
 * Open Library organizes books by subject using a tag-like system.
 * Subjects use underscores instead of spaces: "science_fiction", not "science fiction".
 * This function normalizes the input automatically.
 *
 * Good subjects to try: "science_fiction", "fantasy", "history", "cooking",
 * "biography", "mystery", "mathematics", "philosophy"
 *
 * @param subject - Subject name (spaces converted to underscores automatically)
 * @param limit - Max works to return (default: 20)
 * @returns Subject info with list of works, or null on failure
 *
 * @example
 * const scifi = await getBooksBySubject("science fiction", 10);
 * // Normalized to "science_fiction" automatically
 *
 * @example
 * const history = await getBooksBySubject("world_history", 5);
 */
export async function getBooksBySubject(subject, limit = 20) {
    // Normalize: lowercase and replace spaces/multiple underscores with a single underscore
    const normalized = subject.toLowerCase().trim().replace(/[\s_]+/g, "_");
    const params = new URLSearchParams({ limit: String(limit) });
    return fetchJSON(`${BASE_URL}/subjects/${normalized}.json?${params.toString()}`);
}
