// scripts/sync-webflow-projects.mjs
// Node 18+ (global fetch). Syncs content/projects.json → Webflow Projects CMS.
// Env: WEBFLOW_TOKEN, WEBFLOW_COLLECTION_ID

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (!process.env.CI) { try { await import('dotenv/config'); } catch {} }

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const JSON_PATH = path.resolve(__dirname, "../content/projects.json");
const WEBFLOW_API = "https://api.webflow.com/v2";

function required(name) {
  const val = process.env[name];
  if (!val) throw new Error(`Missing env: ${name}`);
  return val;
}
const WEBFLOW_TOKEN = required("WEBFLOW_TOKEN");
const WEBFLOW_COLLECTION_ID = required("WEBFLOW_COLLECTION_ID");

// Map JSON → Webflow field API names (edit here if your API names differ)
function toCreateFields(p) {
  return {
    name: p.name,
    slug: p.slug,
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

function toUpdateFields(p) {
  // Only automation fields here (leave narrative/manual fields alone)
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

function hasMeaningfulChanges(cur, p) {
  const f = cur || {};
  const eq = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  return !(
    (f.summary ?? null) === (p.summary ?? null) &&
    (f.repo_url ?? null) === (p.repoUrl ?? null) &&
    (f.live_url ?? null) === (p.liveUrl ?? null) &&
    eq(f.tags, p.tags) &&
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
  const source = JSON.parse(fs.readFileSync(JSON_PATH, "utf8"));    // from repo
  const allowedSlugs = new Set(source.map(p => p.slug));
  const existing = await listAllItems(WEBFLOW_COLLECTION_ID);

  const bySlug = new Map(existing.map(it => [it.fieldData?.slug || it.slug, it]));
  const toCreate = source.filter(p => !bySlug.has(p.slug));
  const toUpdate = [];

  for (const p of source) {
    const match = bySlug.get(p.slug);
    if (!match) continue;
    if (hasMeaningfulChanges(match.fieldData, p)) {
      toUpdate.push({ id: match.id, p });
    }
  }

  const createdIds = await createBatch(WEBFLOW_COLLECTION_ID, toCreate);
  const updatedIds = await updateBatch(WEBFLOW_COLLECTION_ID, toUpdate);
  await publishItems(WEBFLOW_COLLECTION_ID, [...createdIds, ...updatedIds]);

  console.log(`Created: ${createdIds.length}, Updated: ${updatedIds.length}, Published: ${createdIds.length + updatedIds.length}`);
}

main().catch(e => { console.error(e); process.exit(1); });
