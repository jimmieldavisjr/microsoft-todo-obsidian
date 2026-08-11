#!/usr/bin/env node
/**
 * Copies the built plugin into an Obsidian vault.
 *
 *   node scripts/install-to-vault.mjs "C:/Users/me/Documents/My Vault"
 *
 * or set OBSIDIAN_VAULT_PATH and run `npm run install-to-vault`.
 *
 * Produces:
 *   <vault>/.obsidian/plugins/microsoft-todo/{main.js,manifest.json,styles.css}
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// fileURLToPath, not `new URL(...).pathname` - the latter keeps a leading slash
// before the drive letter on Windows and leaves spaces percent-encoded.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const vault = process.argv[2] || process.env.OBSIDIAN_VAULT_PATH;

if (!vault) {
  console.error(
    "Usage: node scripts/install-to-vault.mjs <path-to-vault>\n" +
      "   or: set OBSIDIAN_VAULT_PATH and run `npm run install-to-vault`"
  );
  process.exit(1);
}

if (!fs.existsSync(path.join(vault, ".obsidian"))) {
  console.error(`Not an Obsidian vault (no .obsidian folder): ${vault}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const target = path.join(vault, ".obsidian", "plugins", manifest.id);
fs.mkdirSync(target, { recursive: true });

const files = ["main.js", "manifest.json", "styles.css"];
for (const file of files) {
  const from = path.join(root, file);
  if (!fs.existsSync(from)) {
    console.error(`Missing ${file}. Run \`npm run build\` first.`);
    process.exit(1);
  }
  fs.copyFileSync(from, path.join(target, file));
  console.log(`  ${file} -> ${path.join(target, file)}`);
}

console.log(`\nInstalled ${manifest.name} v${manifest.version}.`);
console.log("Reload Obsidian, then enable it under Settings -> Community plugins.");
