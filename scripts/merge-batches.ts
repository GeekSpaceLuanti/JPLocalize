#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";
import { Glob } from "bun";

type Todo = { todo: string[] };

const [, , todoJson, batchGlob, outJson] = process.argv;
if (!todoJson || !batchGlob || !outJson) {
  console.error(
    "Usage: bun scripts/merge-batches.ts <todoJson> '<batchGlob>' <outJson>",
  );
  console.error("Example: bun scripts/merge-batches.ts tmp/x.todo.json 'tmp/batches/*.out.json' tmp/x.done.json");
  process.exit(2);
}

const { todo } = JSON.parse(readFileSync(todoJson, "utf8")) as Todo;
const todoSet = new Set(todo);

// Canonical mapping by normalized form: NBSP→space, collapse runs, trim.
// Lets us recover when a translator returns a key with normalized whitespace.
function normKey(s: string): string {
  // Map common look-alike spaces (NBSP U+00A0, narrow NBSP U+202F,
  // figure space U+2007, ideographic space U+3000) to ASCII space,
  // then collapse runs. Helps when an LLM normalizes whitespace.
  return s
    .replace(/[\u00a0\u202f\u2007\u3000]/g, " ")
    .replace(/[ \t]+/g, " ");
}
const normToCanonical = new Map<string, string>();
for (const k of todo) normToCanonical.set(normKey(k), k);

const merged: Record<string, string> = {};
const fixed: string[] = [];
const skipped: string[] = [];
const conflicts: string[] = [];

const glob = new Glob(batchGlob);
const files: string[] = [];
for (const p of glob.scanSync(".")) files.push(p);
files.sort();
if (files.length === 0) {
  console.error(`[merge] no files matched: ${batchGlob}`);
  process.exit(2);
}

for (const path of files) {
  let obj: Record<string, string>;
  try {
    obj = JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    console.error(`[merge] failed to parse ${path}: ${e}`);
    process.exit(1);
  }
  for (const [k, v] of Object.entries(obj)) {
    let canonical = k;
    if (!todoSet.has(k)) {
      const fromNorm = normToCanonical.get(normKey(k));
      if (fromNorm && fromNorm !== k) {
        canonical = fromNorm;
        fixed.push(`${path}: ${JSON.stringify(k)} → ${JSON.stringify(fromNorm)}`);
      } else {
        skipped.push(`${path}: unknown key ${JSON.stringify(k)}`);
        continue;
      }
    }
    if (canonical in merged && merged[canonical] !== v) {
      conflicts.push(
        `${path}: ${JSON.stringify(canonical)} conflict: existing=${JSON.stringify(merged[canonical])} new=${JSON.stringify(v)}`,
      );
      continue;
    }
    merged[canonical] = v;
  }
}

const missing = todo.filter((k) => !(k in merged));

writeFileSync(outJson, JSON.stringify(merged, null, 2) + "\n");

for (const f of fixed) console.error("[fixed] " + f);
for (const s of skipped) console.error("[skip ] " + s);
for (const c of conflicts) console.error("[conf ] " + c);
console.error(
  `[merge] files=${files.length} todo=${todo.length} merged=${Object.keys(merged).length} missing=${missing.length}`,
);

if (missing.length > 0) {
  const missingPath = outJson.replace(/\.json$/, ".missing.json");
  writeFileSync(missingPath, JSON.stringify(missing, null, 2) + "\n");
  console.error(
    `[merge] missing keys written to ${missingPath} — feed back to translator for retry`,
  );
  process.exit(2);
}
if (conflicts.length > 0 || skipped.length > 0) {
  console.error("[merge] warnings present (conflicts/skipped) — review above");
  process.exit(3);
}
