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

// =============================================================================
// SEARCH ENDPOINT — /search.json
// =============================================================================

/**
 * A single book result returned from the Open Library search endpoint.
 *
 * This is a "summary" view — it has enough data to show a list of results,
 * but for full details (publishers, cover images, etc.) you need the Books API.
 *
 * Note: author_key values like "OL23919A" can be passed to get_author_details.
 */
export interface OLSearchDoc {
  /** Open Library work key, e.g. "/works/OL45804W" */
  key: string;
  title?: string;
  /** Array of author names as plain strings, e.g. ["J.R.R. Tolkien"] */
  author_name?: string[];
  /** Array of Open Library author IDs, e.g. ["OL26320A"] — use with get_author_details */
  author_key?: string[];
  first_publish_year?: number;
  /** All known ISBNs for all editions of this work */
  isbn?: string[];
  /** Subject tags — can be very long, slice before displaying */
  subject?: string[];
  /** ISO 639-2 language codes, e.g. ["eng", "fre"] */
  language?: string[];
  publisher?: string[];
  number_of_pages_median?: number;
  /** Numeric ID for the cover image — use with covers.openlibrary.org */
  cover_i?: number;
  /** Number of different editions in the catalog */
  edition_count?: number;
}

/**
 * Top-level response from GET /search.json
 *
 * Open Library uses offset-based pagination:
 *   - numFound: total results matching the query
 *   - start: the offset of the first result in this page
 *   - docs: the actual results for this page
 */
export interface OLSearchResponse {
  numFound: number;
  start: number;
  docs: OLSearchDoc[];
}

// =============================================================================
// AUTHOR SEARCH ENDPOINT — /search/authors.json
// =============================================================================

/**
 * Top-level response from GET /search/authors.json
 */
export interface OLAuthorSearchResponse {
  numFound: number;
  start: number;
  docs: OLAuthorSearchDoc[];
}

/**
 * A single author result from the author search endpoint.
 *
 * Note: the `key` here is just the bare ID (e.g. "OL23919A"), NOT prefixed
 * with "/authors/" as it is in the author detail endpoint. The API client
 * normalizes this inconsistency.
 */
export interface OLAuthorSearchDoc {
  /** Bare author ID, e.g. "OL23919A" — pass this to get_author_details */
  key: string;
  name?: string;
  birth_date?: string;
  death_date?: string;
  /** The author's most well-known work, if available */
  top_work?: string;
  /** Total number of works by this author in the catalog */
  work_count?: number;
}

// =============================================================================
// AUTHOR DETAIL ENDPOINT — /authors/{id}.json
// =============================================================================

/**
 * Detailed author information from GET /authors/{id}.json
 *
 * TRICKY FIELD: `bio` can be either:
 *   - A plain string: "Douglas Adams was a British author..."
 *   - An object: { "type": "/type/text", "value": "Douglas Adams was..." }
 *
 * This union type forces calling code to handle both cases. See the
 * extractBio() helper in server.ts for how to handle this.
 */
export interface OLAuthorDetail {
  /** Full path key, e.g. "/authors/OL23919A" */
  key: string;
  name?: string;
  /** The author's full birth name if different from their pen name */
  personal_name?: string;
  alternate_names?: string[];
  birth_date?: string;
  death_date?: string;
  /** Can be a plain string OR an object with a `value` field — handle both! */
  bio?: string | { type: string; value: string };
  /** Wikipedia URL for this author */
  wikipedia?: string;
  /** External identifiers in other library/data systems */
  remote_ids?: {
    /** Virtual International Authority File — a global author identifier */
    viaf?: string;
    /** Wikidata entity ID */
    wikidata?: string;
    /** International Standard Name Identifier */
    isni?: string;
    /** OCLC WorldCat identifier */
    olid?: string;
  };
  /** Array of cover photo IDs — use covers.openlibrary.org to resolve */
  photos?: number[];
}

// =============================================================================
// AUTHOR WORKS ENDPOINT — /authors/{id}/works.json
// =============================================================================

/**
 * A single work (book) entry in an author's works list.
 */
export interface OLWork {
  /** Work key, e.g. "/works/OL45804W" */
  key: string;
  title?: string;
  /** Publication date as a string — format varies ("2001", "March 2001", etc.) */
  first_publish_date?: string;
  subject?: string[];
  /** Array of numeric cover IDs */
  covers?: number[];
}

/**
 * Response from GET /authors/{id}/works.json
 *
 * `size` is the total number of works by this author (may be larger than entries.length
 * if you used a limit parameter).
 */
export interface OLAuthorWorksResponse {
  entries: OLWork[];
  /** Total number of works in the catalog for this author */
  size: number;
}

// =============================================================================
// BOOKS BY ISBN ENDPOINT — /api/books
// =============================================================================

/**
 * Response from GET /api/books?bibkeys=ISBN:xxx&format=json&jscmd=data
 *
 * The response is an object keyed by the bibkey you requested.
 * For example, if you request ISBN:9780441172719, the response looks like:
 *   { "ISBN:9780441172719": { title: "Dune", ... } }
 */
export interface OLBookByISBNResponse {
  [bibkey: string]: OLBookData;
}

/**
 * Detailed book data returned by the /api/books endpoint.
 *
 * This endpoint returns much richer data than the search endpoint —
 * publishers, cover images, external identifiers, subject breakdowns, etc.
 */
export interface OLBookData {
  title?: string;
  subtitle?: string;
  /** Open Library URL for this book */
  url?: string;
  /** Authors with name and their Open Library URL */
  authors?: Array<{ name: string; url: string }>;
  publishers?: Array<{ name: string }>;
  /** Publication date as a string — format varies */
  publish_date?: string;
  number_of_pages?: number;
  isbn_10?: string[];
  isbn_13?: string[];
  /** Subject tags with URLs to browse more books on that subject */
  subjects?: Array<{ name: string; url: string }>;
  /** Real people that this book is about */
  subject_people?: Array<{ name: string; url: string }>;
  /** Real places that this book is about */
  subject_places?: Array<{ name: string; url: string }>;
  /** Time periods covered by this book */
  subject_times?: Array<{ name: string; url: string }>;
  /** Editor/publisher notes */
  notes?: string;
  /** Cover image URLs at three sizes */
  cover?: {
    small: string;
    medium: string;
    large: string;
  };
  /** External identifiers in other systems */
  identifiers?: {
    openlibrary?: string[];
    librarything?: string[];
    goodreads?: string[];
    [key: string]: string[] | undefined;
  };
}

// =============================================================================
// SUBJECTS ENDPOINT — /subjects/{subject}.json
// =============================================================================

/**
 * Response from GET /subjects/{subject}.json
 */
export interface OLSubjectResponse {
  /** Display name of the subject, e.g. "Science fiction" */
  name?: string;
  subject_type?: string;
  /** Total number of works tagged with this subject */
  work_count?: number;
  works?: OLSubjectWork[];
}

/**
 * A work entry within a subject response.
 */
export interface OLSubjectWork {
  /** Work key, e.g. "/works/OL45804W" */
  key: string;
  title?: string;
  /** Authors listed with their key and display name */
  authors?: Array<{ key: string; name: string }>;
  first_publish_year?: number;
  /** Numeric cover ID */
  cover_id?: number;
  subject?: string[];
}
