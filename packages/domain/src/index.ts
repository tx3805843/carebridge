/**
 * Scaffold-only hand-written types for the 10 bounded domains in docs/domain-model.md.
 * Replace with `supabase gen types typescript` output once packages/db/migrations lands
 * the real schema — keep the file layout (one module per domain) so generated types
 * can slot in without call-site churn.
 */

export * from "./identity";
export * from "./care-plan";
export * from "./credentialing";
export * from "./scheduling";
export * from "./trust";
export * from "./coordination";
export * from "./communications";
export * from "./billing";
export * from "./compliance";
export * from "./analytics";
