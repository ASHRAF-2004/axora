import { marked } from "marked";
import { readFileSync, writeFileSync } from "node:fs";
const md = readFileSync(process.argv[2], "utf8").replace(/^# .*\n+Prepared[^\n]*\n[^\n]*\n[^\n]*\n[^\n]*\n/, "");
const body = marked.parse(md.replace(/^---\n/m, ""));
writeFileSync(process.argv[3], `<!doctype html><html lang="en"><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body>
<section class="cover"><div class="brand"><img src="logo.svg" alt="Axora"></div>
<div><h1>Developer Handover &amp; Deployment Guide</h1><p class="sub">Axora procurement platform · axora.management</p>
<p class="ar" style="font-size:13pt;color:#5b6878">دليل المطوّر لتسليم مشروع Axora ونشره وتشغيله</p></div>
<div class="meta">Prepared 20 November 2026 · Source release 7ac61cb + handover changes · Contents: install, deployment, domain, email, backups, operations, AI assistant</div></section>
${body}</body></html>`);
