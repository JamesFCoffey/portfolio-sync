// scripts/enrich-projects.mjs
// Node 18+ (global fetch). Updates content/projects.json with GitHub metadata.
// Env: GH_META_TOKEN (optional, avoids rate limits)

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.CI) { try { await import('dotenv/config'); } catch {} }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(__dirname, "../content/projects.json");

function parseOwnerRepo(url) {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)(?:$|\/)/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function ghGet(url) {
  const res = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      ...(process.env.GH_META_TOKEN ? { Authorization: `Bearer ${process.env.GH_META_TOKEN}` } : {})
    }
  });
  if (!res.ok) throw new Error(`GitHub ${url} -> ${res.status}`);
  return res.json();
}

async function enrichOne(p) {
  const pr = parseOwnerRepo(p.repoUrl);
  if (!pr) return p;

  const repo = await ghGet(`https://api.github.com/repos/${pr.owner}/${pr.repo}`);
  // Primary language is repo.language; for more detail you could call /languages
  const enriched = {
    ...p,
    github_stars: repo.stargazers_count ?? 0,
    forks: repo.forks_count ?? 0,
    primary_language: repo.language ?? null,
    last_commit_at: repo.pushed_at ?? null
  };
  return enriched;
}

async function main() {
  const raw = fs.readFileSync(JSON_PATH, "utf8");
  const arr = JSON.parse(raw);

  let changed = false;
  const out = [];
  for (const p of arr) {
    try {
      const e = await enrichOne(p);
      // Only mark changed if any enrichment field differs
      if (
        e.github_stars !== p.github_stars ||
        e.forks !== p.forks ||
        e.primary_language !== p.primary_language ||
        e.last_commit_at !== p.last_commit_at
      ) changed = true;
      out.push(e);
    } catch (err) {
      console.error(`Enrich failed for ${p.name || p.slug}:`, err.message);
      out.push(p); // keep original
    }
  }

  if (changed) {
    fs.writeFileSync(JSON_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
    console.log("projects.json updated with GitHub metadata.");
    process.exitCode = 0;
  } else {
    console.log("No enrichment changes.");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
