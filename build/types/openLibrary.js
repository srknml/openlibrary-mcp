/**
 * @fileoverview TypeScript type definitions for the Open Library API responses.
 *
 * WHY A DEDICATED TYPES FILE?
 * In an MCP server (or any layered application), having explicit types for your
 * external API serves two purposes:
 *
 *   1. DOCUMENTATION — These interfaces document exactly what Open Library returns,
 *      so you don't have to re-read the API docs every time you touch the code.
 *
 *   2. TYPE SAFETY — TypeScript can catch mistakes like accessing a field that
 *      doesn't exist, or forgetting that a field might be undefined.
 *
 * IMPORTANT OPEN LIBRARY QUIRK:
 * Open Library is a real-world "messy" API — fields are frequently absent even
 * when they should logically be present. A book might have no authors listed.
 * An author might have no biography. We use `?` (optional) on nearly every field
 * to reflect this reality. Code that handles these types MUST handle the undefined
 * case rather than assuming data is present.
 */
export {};
