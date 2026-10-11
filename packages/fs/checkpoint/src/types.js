/**
 * Checkpoint vocabulary for the workspace snapshot timeline. Rows are records:
 * one `checkpoint/scan` row per file a committed write handed over, attributed
 * to that call. File state at any stop is a query over rows; content lives in
 * the local blob store keyed by sha256 digest.
 * @module dsh-checkpoint/types
 */
export {};
//# sourceMappingURL=types.js.map