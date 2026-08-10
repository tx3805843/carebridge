import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@carebridge/domain";

/**
 * Service-role client — bypasses RLS. Only for operations no RLS-scoped session can do,
 * e.g. creating another person's auth account. Never import this outside a "use server" file —
 * the `server-only` import above turns an accidental client-bundle import into a build error.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
