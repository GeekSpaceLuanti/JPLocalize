#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";

type State = {
  textdomain: string | null;
  reference: string;
  existing: Record<string, string>;
  todo: string[];
  orderedKeys: string[];
};

function placeholders(s: string): string[] {
  // Luanti placeholders: @1, @2, ... and also @n (digit). Match @<digit>.
  return (s.match(/@\d/g) ?? []).slice().sort();
}

function eqArr(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function escapeValue(v: string): string {
  // .tr values are read until end of line; the parser splits only on the
  // first unescaped '='. Newlines aren't allowed inside a value.
  return v.replace(/\r?\n/g, " ");
}

function escapeKey(k: string): string {
  // Keys must escape '=' as '@=' so the parser can find the real separator.
  return k.replace(/=/g, "@=");
}

const [, , stateJson, translationsJson, outTr] = process.argv;
if (!stateJson || !translationsJson || !outTr) {
  console.error(
    "Usage: bun scripts/build-tr.ts <stateJson> <translationsJson> <outTr>",
  );
  process.exit(2);
}

const state: State = JSON.parse(readFileSync(stateJson, "utf8"));
const translations: Record<string, string> = JSON.parse(
  readFileSync(translationsJson, "utf8"),
);

const todoSet = new Set(state.todo);
const errors: string[] = [];

for (const [k, v] of Object.entries(translations)) {
  if (!todoSet.has(k)) {
    errors.push(`unexpected key (not in todo): ${JSON.stringify(k)}`);
    continue;
  }
  if (k in state.existing) {
    errors.push(`key already in existing JP: ${JSON.stringify(k)}`);
    continue;
  }
  if (typeof v !== "string" || v.trim() === "") {
    errors.push(`empty translation for: ${JSON.stringify(k)}`);
    continue;
  }
  const ph = placeholders(k);
  const phT = placeholders(v);
  if (!eqArr(ph, phT)) {
    errors.push(
      `placeholder mismatch for ${JSON.stringify(k)}: src=${ph.join(",")} dst=${phT.join(",")}`,
    );
  }
}

const missing = state.todo.filter((k) => !(k in translations));
if (missing.length > 0) {
  for (const k of missing) {
    errors.push(`missing translation for: ${JSON.stringify(k)}`);
  }
}

if (errors.length > 0) {
  console.error("[build-tr] validation failed:");
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

const lines: string[] = [];
if (state.textdomain) lines.push(`# textdomain: ${state.textdomain}`);
for (const k of state.orderedKeys) {
  const v = state.existing[k] ?? translations[k];
  if (v === undefined) {
    console.error(`[build-tr] internal: no value for ${JSON.stringify(k)}`);
    process.exit(1);
  }
  lines.push(`${escapeKey(k)}=${escapeValue(v)}`);
}
writeFileSync(outTr, lines.join("\n") + "\n");

console.error(
  `[build-tr] wrote ${lines.length} lines → ${outTr} (existing=${Object.keys(state.existing).length}, new=${Object.keys(translations).length})`,
);
