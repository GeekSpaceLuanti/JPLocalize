#!/usr/bin/env bun
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

type Todo = { todo: string[] };

const [, , todoJson, outDirArg, batchSizeArg] = process.argv;
if (!todoJson || !outDirArg) {
  console.error(
    "Usage: bun scripts/split-batches.ts <todoJson> <outDir> [batchSize=50]",
  );
  process.exit(2);
}
const batchSize = batchSizeArg ? Number(batchSizeArg) : 50;
if (!Number.isInteger(batchSize) || batchSize <= 0) {
  console.error("batchSize must be a positive integer");
  process.exit(2);
}

const { todo } = JSON.parse(readFileSync(todoJson, "utf8")) as Todo;
mkdirSync(outDirArg, { recursive: true });

const batches: string[][] = [];
for (let i = 0; i < todo.length; i += batchSize) {
  batches.push(todo.slice(i, i + batchSize));
}

const written: string[] = [];
for (let i = 0; i < batches.length; i++) {
  const p = `${outDirArg}/batch${i + 1}.in.json`;
  writeFileSync(p, JSON.stringify(batches[i]));
  written.push(p);
}

const manifest = {
  todoJson,
  batchSize,
  total: todo.length,
  batches: written,
};
const manifestPath = `${outDirArg}/manifest.json`;
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");

console.error(
  `[split] total=${todo.length} batchSize=${batchSize} batches=${batches.length} → ${outDirArg}/`,
);
for (const w of written) console.error("  - " + w);
console.error(`manifest: ${manifestPath}`);
