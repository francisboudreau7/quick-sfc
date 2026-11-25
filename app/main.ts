/**
 * Placeholder app, used only to prove the single-file build works in the browser
 * (open a .qsfc, see the ASCII diagram and problems, export L5X). The real window is
 * built after the look is chosen from docs/mockups (PLAN.md Phase 2).
 */
import { exportL5X, showAscii } from "../src/compile.js";
import { formatDiagnostic } from "../src/model/diagnostics.js";

const root = document.getElementById("app")!;
root.innerHTML = `
  <header>
    <strong>QuickSFC</strong>
    <input type="file" id="open" accept=".qsfc,text/plain">
    <button id="export" disabled>Export L5X</button>
    <span id="name"></span>
  </header>
  <pre id="diagram">Open a .qsfc file.</pre>
  <div class="problems" id="problems"></div>`;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
let current: { name: string; source: string } | undefined;

$<HTMLInputElement>("open").addEventListener("change", async (e) => {
  const file = (e.target as HTMLInputElement).files?.[0];
  if (!file) return;
  current = { name: file.name, source: (await file.text()).replace(/^﻿/, "") };
  $("name").textContent = file.name;
  const { text, diagnostics } = showAscii(current.source);
  $("diagram").textContent = text ?? "(no diagram: fix the errors below)";
  $("problems").textContent = diagnostics.map((d) => formatDiagnostic(d, file.name)).join("\n");
  $<HTMLButtonElement>("export").disabled = text === undefined;
});

$<HTMLButtonElement>("export").addEventListener("click", () => {
  if (!current) return;
  const { text } = exportL5X(current.source, { fileName: current.name });
  if (text === undefined) return;
  const url = URL.createObjectURL(new Blob([text], { type: "application/xml" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: current.name.replace(/\.qsfc$/i, "") + ".L5X" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
