// Builds the browser preview: the plugin's real components and styles.css in a
// minimal Obsidian window, with `obsidian` swapped for preview/src/obsidian-shim.ts.
//
//   npm run preview         watch, serve and live-reload at http://localhost:5178/
//   npm run preview:build   one-off build; then open preview/index.html directly
import esbuild from "esbuild";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const once = process.argv.includes("--build");
const port = Number(process.env.PORT ?? 5178);

const context = await esbuild.context({
	entryPoints: [path.join(root, "preview/src/main.tsx")],
	outdir: path.join(root, "preview/dist"),
	bundle: true,
	format: "iife",
	target: "es2020",
	jsx: "automatic",
	sourcemap: true,
	logLevel: "info",
	alias: { obsidian: path.join(root, "preview/src/obsidian-shim.ts") },
	define: { "process.env.NODE_ENV": '"development"' },
});

if (once) {
	await context.rebuild();
	await context.dispose();
	console.log("Preview built. Open preview/index.html in a browser.");
} else {
	await context.watch();
	await context.serve({ servedir: path.join(root, "preview"), port });
	console.log(`Preview running at http://localhost:${port}/`);
}
