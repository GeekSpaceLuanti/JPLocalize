#!/usr/bin/env bun
import { readFileSync, writeFileSync } from "node:fs";

type TrFile = { textdomain: string | null; entries: Array<[string, string]> };

function parseTr(path: string): TrFile {
  const text = readFileSync(path, "utf8");
  let textdomain: string | null = null;
  const entries: Array<[string, string]> = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/^﻿/, "");
    if (line === "") continue;
    const td = line.match(/^#\s*textdomain:\s*(\S+)\s*$/);
    if (td) {
      textdomain = td[1] ?? null;
      continue;
    }
    if (line.startsWith("#")) continue;

    // Luanti .tr splits on the first unescaped '='. Escapes use '@='.
    let key = "";
    let i = 0;
    for (; i < line.length; i++) {
      const ch = line[i]!;
      if (ch === "@" && line[i + 1] === "=") {
        key += "=";
        i++;
        continue;
      }
      if (ch === "=") break;
      key += ch;
    }
    if (i >= line.length) continue; // no '=' → skip
    const value = line.slice(i + 1);
    entries.push([key, value]);
  }
  return { textdomain, entries };
}

const [, , refPath, existingJpPath, outPath] = process.argv;
if (!refPath || !outPath) {
  console.error(
    "Usage: bun scripts/extract.ts <referenceTr> [existingJpTr|-] <outJson>",
  );
  process.exit(2);
}

const ref = parseTr(refPath);
const existing: Record<string, string> = {};
if (existingJpPath && existingJpPath !== "-") {
  const jp = parseTr(existingJpPath);
  for (const [k, v] of jp.entries) existing[k] = v;
}

const seen = new Set<string>();
const todo: string[] = [];
for (const [k] of ref.entries) {
  if (seen.has(k)) continue;
  seen.add(k);
  if (k in existing) continue;
  todo.push(k);
}

const out = {
  textdomain: ref.textdomain,
  reference: refPath,
  existing,
  todo,
  orderedKeys: ref.entries.map(([k]) => k),
};
writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");

console.error(
  `[extract] textdomain=${ref.textdomain} ref=${ref.entries.length} existing=${Object.keys(existing).length} todo=${todo.length} → ${outPath}`,
);
