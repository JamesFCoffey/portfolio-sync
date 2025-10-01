# Webflow Portfolio Sync (GitHub JSON → Webflow CMS)

Keep a single `projects.json` in this repo as the source of truth for code projects. One automation script enriches each entry with live GitHub metadata, then syncs the results into your Webflow Projects collection (create/update + publish) without touching hand-built case studies.

---

## What’s inside

```
content/
  projects.json            # You edit this. Code projects only (case studies stay in Webflow)
scripts/
  auto-enrich-and-sync.mjs # Reads JSON → enriches with GitHub → syncs to Webflow in one pass
.github/
  workflows/
    auto-weekly.yml        # Schedules weekly runs + manual dispatch support
```

---

## Quick start

1. **Create Webflow credentials**
   * Webflow → Project settings → *Apps & Integrations* → generate a **Data API token** (CMS read/write).
   * Record your **Projects collection ID** (see below).
2. **Add GitHub Actions secrets** (`Settings → Secrets and variables → Actions`)
   * `WEBFLOW_TOKEN` – the Data API token
   * `WEBFLOW_COLLECTION_ID` – the Projects collection ID
   * `GH_META_TOKEN` *(optional)* – GitHub PAT with `public_repo` scope for higher rate limits
3. **Edit `content/projects.json`**, commit, and push to `main`.
4. **Run the workflow**: Actions → “Auto Enrich & Sync (no commits)” → **Run workflow**, or wait for the Monday 09:00 UTC schedule. New/updated items are published automatically.

---

## Content model

`content/projects.json` is an array of project objects.

> **Slug convention:** prefix JSON-driven projects with `gh-…` to avoid collisions with existing Webflow items.

```json
[
  {
    "slug": "gh-admin-dashboard",
    "name": "React Admin Dashboard",
    "summary": "Modular widgets, routing, Storybook, and CI/CD.",
    "repoUrl": "https://github.com/JamesFCoffey/admin-dashboard",
    "liveUrl": "https://admin-dashboard-five-red.vercel.app/",
    "tags": ["react", "nextjs", "dashboard"],

    "github_stars": 0,
    "forks": 0,
    "primary_language": null,
    "last_commit_at": null
  }
]
```

**Add a new project**

- Append a new object with a unique `slug`, fill `name`, `summary`, `repoUrl`, `liveUrl`, `tags`.
- Commit + push. The workflow will enrich GitHub stats and publish/update the CMS item in the same run.

---

## Webflow field mapping

The setup script created/renamed the relevant fields. Confirm your Projects collection exposes these **field slugs**:

| JSON key         | Webflow field slug      | Type/notes                          |
| ---------------- | ----------------------- | ----------------------------------- |
| name             | `name`                   | Plain text                          |
| slug             | `slug`                   | Slug                                |
| summary          | `project-description`   | Plain text (multi-line)             |
| repoUrl          | `repo-url`               | Link                                |
| liveUrl          | `live-url`               | Link                                |
| tags             | `tags`                   | Plain text (comma separated string) |
| github_stars     | `github-stars`           | Number                              |
| forks            | `forks`                  | Number                              |
| primary_language | `primary-language`       | Plain text                          |
| last_commit_at   | `last-commit-at`         | Date/Time                           |
| project_type     | `project-type-3`         | Option (auto-set to “Code project”)  |

- `tags` are stored as a comma-separated string (`react, nextjs, dashboard`).
- JSON-backed items always get `project-type = Code project`; use this for conditional visibility vs. manual case studies.
- If you change option IDs in Webflow, update `PROJECT_TYPE_OPTION_ID` inside `scripts/auto-enrich-and-sync.mjs`.

> The automation only touches these fields. Narrative content, hero media, etc. authored in Webflow remain untouched.

---

## Finding your Collection ID

```bash
# List sites accessible by your token
curl -H "Authorization: Bearer $WEBFLOW_TOKEN" https://api.webflow.com/v2/sites

# Then list collections for your site
curl -H "Authorization: Bearer $WEBFLOW_TOKEN" https://api.webflow.com/v2/sites/<site_id>/collections
```

Copy the `id` for the **Projects** collection and store it as `WEBFLOW_COLLECTION_ID`.

---

## Local development (optional)

1. Create `.env` with `WEBFLOW_TOKEN`, `WEBFLOW_COLLECTION_ID`, optional `GH_META_TOKEN`.
2. Run `node scripts/auto-enrich-and-sync.mjs`.

`.env` is gitignored; CI relies on GitHub Secrets.

---

## How the automation works

1. Load every project from `content/projects.json`.
2. For each repo, pull GitHub metadata (stars, forks, primary language, last push).
3. Upsert Webflow CMS items based on `slug`, set `project-type = Code project`, publish the touched items.

The script never deletes/unpublishes items—safe default for public portfolios.

---

## Workflow reference

**.github/workflows/auto-weekly.yml**

```yaml
name: Auto Enrich & Sync (no commits)
on:
  schedule:
    - cron: "0 9 * * 1"   # Mondays 09:00 UTC
  workflow_dispatch:
  push:
    paths:
      - "content/projects.json"

permissions:
  contents: read

jobs:
  auto:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
      - name: Enrich in memory and sync to Webflow
        run: node scripts/auto-enrich-and-sync.mjs
        env:
          WEBFLOW_TOKEN: ${{ secrets.WEBFLOW_TOKEN }}
          WEBFLOW_COLLECTION_ID: ${{ secrets.WEBFLOW_COLLECTION_ID }}
          GH_META_TOKEN: ${{ secrets.GH_META_TOKEN }}
```

---

## Security notes for a public template

- Keep tokens strictly in Actions secrets.
- Protect `main` and review changes to `.github/workflows/**`.
- Forked PRs never receive secrets by default—leave it that way.
- Scope tokens minimally (Webflow CMS read/write for this site, GitHub PAT read-only).

---

## Troubleshooting

- **No updates in Webflow:** Confirm slugs match and secrets are correct.
- **Field mismatch errors:** Verify the field slugs above; update the script mapping if you customized them.
- **GitHub rate limits:** Add `GH_META_TOKEN` (a PAT) to lift unauthenticated limits.
- **Want strict deletes?** Extend the script to archive/unpublish items whose slugs disappear from JSON.

---

## License

MIT — reuse freely. Credit is appreciated but not required.
