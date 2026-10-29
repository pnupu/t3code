// @effect-diagnostics nodeBuiltinImport:off globalConsole:off - a synchronous release-asset rewrite run once in CI.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// Rewrites sha512/size in electron-builder's latest*.yml after files were re-packed.
// Blockmaps of re-packed files are gone, so their blockMapSize lines are dropped too.
const dir = process.argv[2];
if (!dir) throw new Error("usage: refresh-update-manifest.ts <release-dir>");

const digest = (file: string) =>
  createHash("sha512").update(readFileSync(join(dir, file))).digest("base64");

for (const manifest of readdirSync(dir).filter((name) => /^latest.*\.yml$/.test(name))) {
  let current: string | undefined;
  const lines = readFileSync(join(dir, manifest), "utf8").split("\n");
  const out: string[] = [];
  for (const line of lines) {
    const entry = /^(\s*-?\s*)(url|path): (.+)$/.exec(line);
    if (entry) current = entry[3]!.trim();
    const field = /^(\s*)(sha512|size|blockMapSize): /.exec(line);
    if (field && current && existsInDir(current)) {
      if (field[2] === "blockMapSize") continue;
      out.push(
        `${field[1]}${field[2]}: ${field[2] === "sha512" ? digest(current) : statSync(join(dir, current)).size}`,
      );
      continue;
    }
    out.push(line);
  }
  writeFileSync(join(dir, manifest), out.join("\n"));
  console.log(`refreshed ${manifest}`);
}

function existsInDir(file: string): boolean {
  try {
    return statSync(join(dir!, file)).isFile();
  } catch {
    return false;
  }
}
