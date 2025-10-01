# Webflow Portfolio Sync (GitHub JSON → Webflow CMS)

**Public, teachable template** for running your portfolio like code.

* Keep a single `projects.json` in this repo as the source of truth for **code projects**.
* A weekly Action enriches each project with **GitHub stars, forks, primary language, last commit**.
* A sync script **creates/updates & publishes** matching items in your Webflow **Projects** CMS—without touching your manual case studies.

> Why public? It’s easy for others to learn/replicate, you can accept PRs, and secrets stay safe in GitHub Actions.

---

## What’s inside

```
content/
  projects.json            # You edit this. Code projects only (case studies live in Webflow UI)
scripts/
  enrich-projects.mjs      # Weekly: updates GitHub stats inside projects.json
  sync-webflow-projects.mjs# Sync: pushes JSON → Webflow CMS and publishes
.github/
  workflows/
    weekly-enrich-and-sync.yml  # Schedules enrichment, commits changes, then syncs to Webflow
```

---

## Quick start

1. **Create Webflow credentials (one-time)**

   * Webflow → your site → *Project settings* → *Apps & Integrations* → **Data API token** (CMS read/write).
   * Find your **Projects Collection ID** (see “Finding your Collection ID” below).

2. **Add GitHub Actions secrets (repo → Settings → Secrets and variables → Actions):**

   * `WEBFLOW_TOKEN` – your Webflow Data API token
   * `WEBFLOW_COLLECTION_ID` – your *Projects* collection ID
   * `GH_META_TOKEN` *(optional but recommended)* – GitHub PAT with read access to public repos (raises rate limits)

3. **Edit `content/projects.json`** (see schema below), then push to `main`.

4. **Run the workflow**

   * Actions → “**Weekly Enrich & Sync to Webflow**” → **Run workflow** (or wait for the scheduled run).
   * Check Webflow CMS → Projects: new/updated items should be **published**.

---

## Why this pattern?

* **Automation:** Weekly enrichment + publish on demand (no manual copy/paste).
* **Safety:** Only items that exist in `projects.json` are updated. Your manual case studies (not in JSON) are never touched.
* **Versioned content:** PR reviews, diff, rollback, link checks.
* **Reusable data:** The same JSON can feed docs, a Next.js demo, OG images, etc.

---

## Content model

`content/projects.json` is an array of project objects.

> **Slug convention:** prefix code projects with `gh-…` to avoid collisions with manual items.

```json
[
  {
    "slug": "gh-admin-dashboard",
    "name": "React Admin Dashboard",
    "summary": "Modular widgets, routing, Storybook, and CI/CD.",
    "repoUrl": "https://github.com/JamesFCoffey/admin-dashboard",
    "liveUrl": "",
    "tags": ["react","nextjs","dashboard"],

    // Filled or refreshed by the weekly enrichment:
    "github_stars": 0,
    "forks": 0,
    "primary_language": null,
    "last_commit_at": null
  }
]
```

**Add a new project**

* Append a new object with a unique `"slug"`, set `name`, `summary`, `repoUrl`, `liveUrl`, `tags`.
* Commit + push. The next run will create/publish a CMS item (and fill metrics on the next weekly pass).

---

## Webflow field mapping

Your Webflow **Projects** collection should include fields with **these API names** (or adjust the mapping in `scripts/sync-webflow-projects.mjs`):

| JSON key         | Webflow field API name | Type         |
| ---------------- | ---------------------- | ------------ |
| name             | `name`                 | Plain text   |
| slug             | `slug`                 | Slug         |
| summary          | `summary`              | Plain/Rich   |
| repoUrl          | `repo_url`             | URL          |
| liveUrl          | `live_url`             | URL          |
| tags             | `tags`                 | Text/Options |
| github_stars     | `github_stars`         | Number       |
| forks            | `forks`                | Number       |
| primary_language | `primary_language`     | Plain text   |
| last_commit_at   | `last_commit_at`       | Date/Time    |

> The sync script **only updates these automation fields**. It does **not** overwrite any narrative/case-study fields you author directly in Webflow.

---

## Finding your Collection ID

Use the Webflow Data API (v2):

```bash
# List sites accessible by your token
curl -H "Authorization: Bearer $WEBFLOW_TOKEN" https://api.webflow.com/v2/sites

# Then list collections for your site_id
curl -H "Authorization: Bearer $WEBFLOW_TOKEN" https://api.webflow.com/v2/sites/<site_id>/collections
```

Copy the `id` of your **Projects** collection and store it as `WEBFLOW_COLLECTION_ID` in repo secrets.

---

## Local development (optional)

If you want to run scripts locally:

1. `cp .env.example .env` and fill values
2. `node scripts/enrich-projects.mjs`
3. `node scripts/sync-webflow-projects.mjs`

> `.env` is ignored by git. CI uses **GitHub Secrets**, not your local `.env`.

---

## How it works

### 1) Weekly enrichment

* Reads each `repoUrl`, hits GitHub’s API, and writes: `github_stars`, `forks`, `primary_language`, `last_commit_at` **back to `projects.json`**.
* Commits the file if anything changed.

### 2) Sync & publish

* Loads `projects.json`.
* **Creates** items for slugs that don’t exist; **updates** items for slugs that do.
* Calls **publish** so changes go live.
* **Never deletes/unpublishes** items (safe default).

---

## Workflows

**.github/workflows/weekly-enrich-and-sync.yml**

```yaml
name: Weekly Enrich & Sync to Webflow
on:
  schedule:
    - cron: "0 9 * * 1"   # Mondays 09:00 UTC
  workflow_dispatch:
  push:
    paths:
      - "content/projects.json"

permissions:
  contents: write

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Enrich projects.json with GitHub metadata
        run: node scripts/enrich-projects.mjs
        env:
          GH_META_TOKEN: ${{ secrets.GH_META_TOKEN }}

      - name: Commit enriched JSON (if changed)
        run: |
          if [[ -n "$(git status --porcelain content/projects.json)" ]]; then
            git config user.name "github-actions[bot]"
            git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
            git add content/projects.json
            git commit -m "chore: enrich projects.json (weekly)"
            git push
          else
            echo "No changes to commit."
          fi

      - name: Sync to Webflow CMS
        run: node scripts/sync-webflow-projects.mjs
        env:
          WEBFLOW_TOKEN: ${{ secrets.WEBFLOW_TOKEN }}
          WEBFLOW_COLLECTION_ID: ${{ secrets.WEBFLOW_COLLECTION_ID }}
```

---

## Security notes for a **public** repo

* Keep tokens in **Actions → Secrets** only.
* Protect `main` and review changes under `.github/workflows/**`.
* PRs from forks **won’t** receive secrets by default (keep it that way).
* Scope tokens minimally: Webflow CMS read/write for this site; GitHub PAT read-only.

---

## Troubleshooting

* **Nothing updated:** Confirm `WEBFLOW_COLLECTION_ID`, token scopes, and that your item **slugs** in Webflow match `projects.json`.
* **Fields don’t change:** Your Webflow field API names may differ—adjust the mapping in `sync-webflow-projects.mjs`.
* **Rate limits:** Add `GH_META_TOKEN` as a secret; it boosts GitHub API limits.
* **Removed from JSON still live on site:** Expected. The script doesn’t unpublish/delete by default. If you want **strict mode**, open an issue or add a flag to unpublish items whose slugs no longer appear.

---

## FAQ

**Q: Why not put case studies in `projects.json` too?**
A: Those are better authored in Webflow’s UI (rich text, images, layout). This repo focuses on **code projects** that benefit from automation and GitHub enrichment.

**Q: Can I combine multiple collections?**
A: Webflow collection lists can’t aggregate different collections natively. That’s why we keep a single **Projects** collection and separate types visually (e.g., filter by tag or template).

**Q: Can I run this more often than weekly?**
A: Yes—adjust the cron, or trigger on push to `projects.json`.

---

## License

MIT — reuse freely. If you adapt it, a star or credit is appreciated.

---

## Credits

Built by **James Coffey**.
Pattern: “content-as-code” for Webflow using GitHub Actions + Webflow Data API.
