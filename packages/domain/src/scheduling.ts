/** Domain 4 — Scheduling & Visit Ops. Generated from live schema (see generated.ts) — no hand-written placeholders remain. */
import type { Database } from "./generated";

export type Zone = Database["public"]["Tables"]["zone"]["Row"];
export type Roster = Database["public"]["Tables"]["roster"]["Row"];
export type RosterInsert = Database["public"]["Tables"]["roster"]["Insert"];
export type VisitStatus = Database["public"]["Tables"]["visit"]["Row"]["status"];
export type Visit = Database["public"]["Tables"]["visit"]["Row"];
export type VisitInsert = Database["public"]["Tables"]["visit"]["Insert"];
export type VisitCheckin = Database["public"]["Tables"]["visit_checkin"]["Row"];
export type VisitCheckinInsert = Database["public"]["Tables"]["visit_checkin"]["Insert"];
export type Observation = Database["public"]["Tables"]["observation"]["Row"];
export type ObservationInsert = Database["public"]["Tables"]["observation"]["Insert"];
export type Task = Database["public"]["Tables"]["task"]["Row"];
export type TaskInsert = Database["public"]["Tables"]["task"]["Insert"];
