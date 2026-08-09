#!/usr/bin/env node
/**
 * Enforces the guardrail in CLAUDE.md: every table has created_at / updated_at /
 * created_by and an explicit RLS policy. Parses supabase/migrations/*.sql in
 * lexical (timestamp) order and fails if any created table is missing RLS
 * (ENABLE ROW LEVEL SECURITY + at least one CREATE POLICY) or any of the three
 * required audit columns. Table drops/renames are tracked so the check reflects
 * final migration-set state, not just the first CREATE TABLE seen.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(__dirname, "..", "..", "..", "supabase", "migrations");
const REQUIRED_COLUMNS = ["created_at", "updated_at", "created_by"];

function stripSqlComments(sql) {
  return sql.replace(/--.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

function loadMigrationSql() {
  let files;
  try {
    files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  } catch {
    return "";
  }
  return files
    .map((f) => stripSqlComments(readFileSync(join(migrationsDir, f), "utf8")))
    .join("\n");
}

function qualifiedToBareName(name) {
  const parts = name.replace(/"/g, "").split(".");
  return parts[parts.length - 1].toLowerCase();
}

function findTables(sql) {
  const tables = new Map(); // name -> { body }
  const createRe = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z0-9_."]+)\s*\(/gi;
  let match;
  while ((match = createRe.exec(sql))) {
    const name = qualifiedToBareName(match[1]);
    const bodyStart = match.index + match[0].length;
    const body = extractParenBody(sql, bodyStart - 1);
    tables.set(name, body);
  }

  const dropRe = /DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([a-zA-Z0-9_."]+)/gi;
  while ((match = dropRe.exec(sql))) {
    tables.delete(qualifiedToBareName(match[1]));
  }

  const renameRe = /ALTER\s+TABLE\s+([a-zA-Z0-9_."]+)\s+RENAME\s+TO\s+([a-zA-Z0-9_."]+)/gi;
  while ((match = renameRe.exec(sql))) {
    const from = qualifiedToBareName(match[1]);
    const to = qualifiedToBareName(match[2]);
    if (tables.has(from)) {
      tables.set(to, tables.get(from));
      tables.delete(from);
    }
  }

  return tables;
}

function extractParenBody(sql, openParenIndex) {
  let depth = 0;
  for (let i = openParenIndex; i < sql.length; i++) {
    if (sql[i] === "(") depth++;
    else if (sql[i] === ")") {
      depth--;
      if (depth === 0) return sql.slice(openParenIndex + 1, i);
    }
  }
  return sql.slice(openParenIndex + 1);
}

function findRlsEnabledTables(sql) {
  const enabled = new Set();
  const re = /ALTER\s+TABLE\s+([a-zA-Z0-9_."]+)\s+ENABLE\s+ROW\s+LEVEL\s+SECURITY/gi;
  let match;
  while ((match = re.exec(sql))) enabled.add(qualifiedToBareName(match[1]));
  return enabled;
}

function findPolicyTables(sql) {
  const withPolicy = new Set();
  const re = /CREATE\s+POLICY\s+[a-zA-Z0-9_."]+\s+ON\s+([a-zA-Z0-9_."]+)/gi;
  let match;
  while ((match = re.exec(sql))) withPolicy.add(qualifiedToBareName(match[1]));
  return withPolicy;
}

function hasColumn(body, column) {
  const re = new RegExp(`(^|[\\s,(])"?${column}"?\\s`, "i");
  return re.test(body);
}

function main() {
  const sql = loadMigrationSql();
  if (!sql.trim()) {
    console.log("[rls-coverage] no migrations yet — nothing to check.");
    return;
  }

  const tables = findTables(sql);
  const rlsEnabled = findRlsEnabledTables(sql);
  const withPolicy = findPolicyTables(sql);

  const failures = [];
  for (const [name, body] of tables) {
    const missing = [];
    if (!rlsEnabled.has(name)) missing.push("RLS not enabled (ENABLE ROW LEVEL SECURITY)");
    if (!withPolicy.has(name)) missing.push("no CREATE POLICY found");
    for (const col of REQUIRED_COLUMNS) {
      if (!hasColumn(body, col)) missing.push(`missing column "${col}"`);
    }
    if (missing.length > 0) failures.push({ name, missing });
  }

  if (failures.length > 0) {
    console.error(`[rls-coverage] ${failures.length} table(s) fail the guardrail in CLAUDE.md:\n`);
    for (const { name, missing } of failures) {
      console.error(`  - ${name}:`);
      for (const m of missing) console.error(`      - ${m}`);
    }
    console.error("\nEvery table needs created_at/updated_at/created_by columns, RLS enabled, and at least one policy.");
    process.exit(1);
  }

  console.log(`[rls-coverage] OK — ${tables.size} table(s) checked, all have RLS + required audit columns.`);
}

main();
