#!/usr/bin/env node
/**
 * Seed fixtures actually live in supabase/seed.sql (fixed name/location — a Supabase CLI
 * convention, not configurable), not here: `supabase db reset` auto-applies migrations then
 * seed.sql, using auth.users inserts + the handle_new_auth_user trigger to create real "user"
 * rows the same way a live signup would, with realistic-but-synthetic Ghanaian data (CLAUDE.md:
 * never real client PII). This script just shells out to that — it exists so `pnpm seed`
 * reads naturally, not because there's separate logic here to maintain.
 */
import { execFileSync } from "node:child_process";

execFileSync("supabase", ["db", "reset"], { stdio: "inherit" });
