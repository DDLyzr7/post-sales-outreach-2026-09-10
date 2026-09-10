// Render a status-report page (docs/status-report-*.html) to a shareable A4 PDF,
// keeping every section whole on a page, then check that from the PDF's own text.
// usage: node scripts/report-pdf.mjs <report.html> <out.pdf> <work-dir>
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, rmSync, copyFileSync } from "node:fs";
import { execFileSync, spawn } from "node:child_process";
import { join, resolve } from "node:path";

const [src, out, work] = process.argv.slice(2);
if (!src || !out || !work) throw new Error("usage: node scripts/report-pdf.mjs <report.html> <out.pdf> <work-dir>");

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36";

let html = readFileSync(src, "utf8");

// Embed the Latin subset of the report's own Google Fonts, so the PDF never falls back.
const fontCss = html.match(/<link rel="stylesheet" href="(https:\/\/fonts\.googleapis\.com[^"]+)">/)[1].replace(/&amp;/g, "&");
const css = await (await fetch(fontCss, { headers: { "User-Agent": UA } })).text();
const blocks = [...css.matchAll(/\/\* latin \*\/\s*(@font-face\s*\{[^}]*\})/g)].map((m) => m[1]);
if (blocks.length === 0) throw new Error("no latin @font-face blocks in the Google Fonts CSS");
const fontData = new Map();
let faces = "";
for (const block of blocks) {
  const url = block.match(/url\((https:[^)]+)\)/)[1];
  if (!fontData.has(url)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`font download failed: ${res.status}`);
    fontData.set(url, Buffer.from(await res.arrayBuffer()).toString("base64"));
  }
  faces += block.replace(url, `data:font/woff2;base64,${fontData.get(url)}`).replace(/font-display:\s*swap;/, "font-display: block;") + "\n";
}

html = html
  .replace(/<link rel="preconnect"[^>]*>\n?/g, "")
  .replace(/<link rel="stylesheet" href="https:\/\/fonts\.googleapis\.com[^"]+">\n?/, "")
  .replace(/<script>[\s\S]*?<\/script>\n?/, "")
  // An A4 page is ~690px wide, which would trip the phone layout; keep that screen-only.
  .replace("@media (max-width: 760px)", "@media screen and (max-width: 760px)");

const printCss = `
${faces}
@page {
  size: A4;
  margin: 14mm 14mm 16mm;
  @bottom-left  { content: "Post-Sales Outreach \\00b7  Status report \\00b7  10 September 2026"; font-family: "DM Mono", monospace; font-size: 8px; letter-spacing: 0.04em; color: #6e625a; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font-family: "DM Mono", monospace; font-size: 8px; letter-spacing: 0.04em; color: #6e625a; }
}
* { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html, body { background: #ffffff; }

/* Plain block flow so the page breaker can keep each section whole. */
.report { display: block; max-width: none; padding: 0; }
.report > * + * { margin-top: 30px; }
.section { display: block; break-inside: avoid; }
.section > * + * { margin-top: 14px; }
.masthead, .headline, .note, .phase, .steps li, .group, tbody tr, tfoot tr { break-inside: avoid; }

.masthead { padding-bottom: 20px; }
.masthead h1 { font-size: 34px; }
.lede { font-size: 14.5px; }
.headline { gap: 28px; }

/* Fixed column widths so the table fits the page and every row lines up. */
.table-wrap { overflow: visible; }
table { min-width: 0; table-layout: fixed; font-size: 12px; }
thead th { padding: 8px 9px; font-size: 9.5px; letter-spacing: 0.03em; }
thead th:nth-child(1) { width: 17%; }
thead th:nth-child(2) { width: 11%; }
thead th.num { width: 8%; }
thead th:nth-child(6) { width: 48%; }
tbody td, tfoot td { padding: 9px; }
th.num, td.num { padding-left: 4px; padding-right: 9px; }
td.num { width: auto; }
td.area { white-space: normal; }
td.meter-cell { width: auto; padding-top: 13px; }

.phase { padding: 10px 0; }
.steps li { padding: 10px 0; grid-template-columns: 96px minmax(0, 1fr); }
`;

const [head, body] = html.split(/(?=<main class="report">)/);
const doc = `<!doctype html>
<html lang="en" data-theme="light">
<head>
<meta charset="utf-8">
<meta name="color-scheme" content="light">
${head.trim()}
<style>${printCss}</style>
</head>
<body>
${body.trim()}
</body>
</html>
`;

mkdirSync(work, { recursive: true });
const printHtml = join(work, "report-print.html");
const tmpPdf = join(work, "report.pdf");
writeFileSync(printHtml, doc);
rmSync(tmpPdf, { force: true });

// Headless Chrome writes the PDF and then sometimes doesn't exit, so wait for the file, then stop it.
const chrome = spawn(CHROME, [
  "--headless",
  "--disable-gpu",
  "--no-first-run",
  `--user-data-dir=${join(work, "chrome-profile")}`,
  "--no-pdf-header-footer",
  `--print-to-pdf=${tmpPdf}`,
  `file://${printHtml}`,
], { stdio: "ignore" });
await new Promise((done, fail) => {
  const started = Date.now();
  let lastSize = -1;
  const timer = setInterval(() => {
    const size = existsSync(tmpPdf) ? statSync(tmpPdf).size : 0;
    if (size > 0 && size === lastSize) { clearInterval(timer); done(); }
    lastSize = size;
    if (Date.now() - started > 60000) { clearInterval(timer); fail(new Error("Chrome did not write the PDF within 60s")); }
  }, 800);
});
chrome.kill();

// Read each page's text back out of the PDF and check no section spans two pages.
const jxa = `ObjC.import("PDFKit");
function run(argv) {
  var d = $.PDFDocument.alloc.initWithURL($.NSURL.fileURLWithPath(argv[0]));
  var pages = [];
  for (var i = 0; i < d.pageCount; i++) pages.push(d.pageAtIndex(i).string.js);
  return JSON.stringify(pages);
}`;
const pages = JSON.parse(execFileSync("osascript", ["-l", "JavaScript", "-e", jxa, tmpPdf], { encoding: "utf8" }));
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const pageOf = (snippet) => pages.findIndex((p) => norm(p).includes(norm(snippet))) + 1;
const sections = [
  ["Title and summary", "One place for the post-sales team", "Figures as of 10 Sep 2026"],
  ["At a glance", "Nearly half the features are built", "Cortex connection is in place"],
  ["Where each phase stands", "Where each phase stands", "as the final step"],
  ["Progress by area", "Progress by area", "All areas"],
  ["What works today", "What works today", "fits their role and the account"],
  ["What's next", "Coming up", "goes live for the team"],
];
let ok = true;
console.log(`pages: ${pages.length}`);
for (const [name, first, last] of sections) {
  const a = pageOf(first), b = pageOf(last);
  const status = a === 0 || b === 0 ? "NOT FOUND" : a === b ? "whole" : "SPLIT";
  if (status !== "whole") ok = false;
  console.log(`  ${name}: page ${a}${a === b ? "" : `-${b}`} (${status})`);
}
if (!ok) { console.log("not copied: fix the layout first"); process.exit(1); }
copyFileSync(tmpPdf, resolve(out));
console.log(`pdf: ${resolve(out)}`);
