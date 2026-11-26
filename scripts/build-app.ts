/**
 * Builds the single-file app: bundles app/main.ts (and everything it imports from src/)
 * with esbuild, then inlines the script and app/styles.css into app/index.html.
 * docs/cheatsheet.html is inlined into the script (Help → qSFC cheat sheet).
 * Output: dist/QuickSFC.html, which works offline (opened from a USB key, file://).
 *
 *   npx tsx scripts/build-app.ts            # minified
 *   npx tsx scripts/build-app.ts --dev      # readable, with inline source map
 */
import { build } from "esbuild";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";

const dev = process.argv.includes("--dev");
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as { version: string };
// The cheat sheet (Help menu) is inlined so it works offline from the single file.
const cheatsheet = readFileSync("docs/cheatsheet.html", "utf8");

const result = await build({
  entryPoints: ["app/main.ts"],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["es2020", "firefox115", "chrome115", "edge115"],
  minify: !dev,
  sourcemap: dev ? "inline" : false,
  write: false,
  legalComments: "none",
  define: {
    QSFC_CHEATSHEET: JSON.stringify(cheatsheet),
    QSFC_VERSION: JSON.stringify(pkg.version),
  },
});
const js = result.outputFiles[0]!.text;
const css = readFileSync("app/styles.css", "utf8");
let html = readFileSync("app/index.html", "utf8");

// "</script" inside the bundle would end the inline script early.
const safeJs = js.replace(/<\/script/gi, "<\\/script");
html = html
  .replace("/*__STYLES__*/", () => css)
  .replace("/*__SCRIPT__*/", () => safeJs)
  .replace(/__VERSION__/g, pkg.version);

mkdirSync("dist", { recursive: true });
writeFileSync("dist/QuickSFC.html", html, "utf8");
console.log(`dist/QuickSFC.html  ${(html.length / 1024).toFixed(1)} KiB${dev ? " (dev)" : ""}`);
