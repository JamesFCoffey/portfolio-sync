// scripts/auto-enrich-and-sync.mjs
// Fully automatic: enrich GitHub metadata in memory, then sync to Webflow CMS.
// No commits to the repo. Node 18+ (global fetch).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.CI) { try { await import("dotenv/config"); } catch {} }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(__dirname, "../content/projects.json");
const WEBFLOW_API = "https://api.webflow.com/v2";

// ----- Env -----
function required(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}
const WEBFLOW_TOKEN = required("WEBFLOW_TOKEN");
const WEBFLOW_COLLECTION_ID = required("WEBFLOW_COLLECTION_ID");
const GH_META_TOKEN = process.env.GH_META_TOKEN || null;

// ----- Helpers -----
function parseOwnerRepo(url) {
  if (!url) return null;
  const m = url.match(/github\.com\/([^/]+)\/([^/]+)(?:$|\/)/i);
  return m ? { owner: m[1], repo: m[2] } : null;
}

async function ghGet(url) {
  const res = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      ...(GH_META_TOKEN ? { Authorization: `Bearer ${GH_META_TOKEN}` } : {})
    }
  });
  if (!res.ok) throw new Error(`GitHub ${url} -> ${res.status}`);
  return res.json();
}

async function enrichProject(p) {
  const pr = parseOwnerRepo(p.repoUrl);
  if (!pr) return p;
  try {
    const repo = await ghGet(`https://api.github.com/repos/${pr.owner}/${pr.repo}`);
    return {
      ...p,
      github_stars: repo.stargazers_count ?? 0,
      forks: repo.forks_count ?? 0,
      primary_language: repo.language ?? null,
      last_commit_at: repo.pushed_at ?? null
    };
  } catch (e) {
    console.error(`Enrich failed for ${p.name || p.slug}: ${e.message}`);
    return p; // keep original if enrichment fails
  }
}

async function wf(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: {
      Authorization: `Bearer ${WEBFLOW_TOKEN}`,
      "Content-Type": "application/json",
      ...(opts.headers || {})
    }
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Webflow ${url} -> ${res.status} ${body}`);
  }
  return res.json();
}

async function listAllItems(collectionId) {
  let items = [], offset = 0, limit = 100;
  while (true) {
    const j = await wf(`${WEBFLOW_API}/collections/${collectionId}/items?offset=${offset}&limit=${limit}`);
    const page = j.items || j.data || [];
    items = items.concat(page);
    if (page.length < limit) break;
    offset += limit;
  }
  return items;
}

// Map JSON -> Webflow field API names (edit if your API names differ)
function toCreateFields(p) {
  return {
    name: p.name,
    slug: p.slug,
    summary: p.summary,
    repo_url: p.repoUrl || null,
    live_url: p.liveUrl || null,
    // If your "tags" field is plain text, switch to tags: (p.tags||[]).join(", ")
    tags: p.tags || [],
    github_stars: p.github_stars ?? null,
    last_commit_at: p.last_commit_at ?? null,
    primary_language: p.primary_language ?? null,
    forks: p.forks ?? null
  };
}

function toUpdateFields(p) {
  return {
    summary: p.summary,
    repo_url: p.repoUrl || null,
    live_url: p.liveUrl || null,
    tags: p.tags || [],
    github_stars: p.github_stars ?? null,
    last_commit_at: p.last_commit_at ?? null,
    primary_language: p.primary_language ?? null,
    forks: p.forks ?? null
  };
}

function changed(cur, p) {
  const f = cur || {};
  const same = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return !(
    (f.summary ?? null) === (p.summary ?? null) &&
    (f.repo_url ?? null) === (p.repoUrl ?? null) &&
    (f.live_url ?? null) === (p.liveUrl ?? null) &&
    same(f.tags, p.tags) &&
    (f.github_stars ?? null) === (p.github_stars ?? null) &&
    (f.last_commit_at ?? null) === (p.last_commit_at ?? null) &&
    (f.primary_language ?? null) === (p.primary_language ?? null) &&
    (f.forks ?? null) === (p.forks ?? null)
  );
}

async function createBatch(collectionId, sources) {
  if (!sources.length) return [];
  const body = { items: sources.map(p => ({ fieldData: toCreateFields(p), isDraft: false, isArchived: false })) };
  const j = await wf(`${WEBFLOW_API}/collections/${collectionId}/items`, { method: "POST", body: JSON.stringify(body) });
  const arr = j.items || j.data || [];
  return arr.map(x => x.id);
}

async function updateBatch(collectionId, pairs) {
  if (!pairs.length) return [];
  const body = {
    items: pairs.map(({ id, p }) => ({ id, fieldData: toUpdateFields(p), isDraft: false, isArchived: false }))
  };
  const j = await wf(`${WEBFLOW_API}/collections/${collectionId}/items`, { method: "PATCH", body: JSON.stringify(body) });
  const arr = j.items || j.data || [];
  return arr.map(x => x.id);
}

async function publishItems(collectionId, itemIds) {
  if (!itemIds.length) return;
  await wf(`${WEBFLOW_API}/collections/${collectionId}/items/publish`, { method: "POST", body: JSON.stringify({ itemIds }) });
}

async function main() {
  // 1) Load JSON
  const source = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));

  // 2) Enrich in memory
  const enriched = [];
  for (const p of source) enriched.push(await enrichProject(p));

  // 3) Sync & publish
  const existing = await listAllItems(WEBFLOW_COLLECTION_ID);
  const bySlug = new Map(existing.map(it => [it.fieldData?.slug || it.slug, it]));

  const toCreate = enriched.filter(p => !bySlug.has(p.slug));
  const toUpdate = [];
  for (const p of enriched) {
    const match = bySlug.get(p.slug);
    if (!match) continue;
    if (changed(match.fieldData, p)) toUpdate.push({ id: match.id, p });
  }

  const createdIds = await createBatch(WEBFLOW_COLLECTION_ID, toCreate);
  const updatedIds = await updateBatch(WEBFLOW_COLLECTION_ID, toUpdate);
  await publishItems(WEBFLOW_COLLECTION_ID, [...createdIds, ...updatedIds]);

  console.log(`Created: ${createdIds.length}, Updated: ${updatedIds.length}, Published: ${createdIds.length + updatedIds.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
