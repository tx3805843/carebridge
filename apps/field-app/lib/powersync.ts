/**
 * PowerSync connector stub — non-invasive offline-first sync layer over the same
 * Supabase Postgres instance, conflict-aware write queue. Wire up once packages/db
 * schema and sync rules (bucket definitions) exist.
 */

export const POWERSYNC_URL = process.env.EXPO_PUBLIC_POWERSYNC_URL ?? "";

// TODO: implement PowerSyncBackendConnector (fetchCredentials, uploadData) against Supabase Auth.
