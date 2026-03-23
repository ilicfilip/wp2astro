# Astro WP — Project Handoff

## What This Is

A browser-based CMS that lets users write content in WordPress, store it as Markdown in a GitHub repo, and auto-deploy as a static Astro site to Cloudflare Pages. No servers, no hosting to manage — everything runs in the browser via WP Playground.

Two projects live in the `Astro Playground/` folder:

```
Astro Playground/
├── astro-wp-playground/     ← CLI version (local dev, runs WP Playground via Node)
└── astro-wp-web-app/        ← Browser SPA (this is the active project)
```

The CLI project (`astro-wp-playground/`) is the original prototype. The web app (`astro-wp-web-app/`) is the production target. The web app reuses the CLI project's PHP classes at build time via a Vite virtual module.

---

## Architecture Overview

### User Flow

1. **Setup screen** → User enters GitHub PAT (`repo` + `workflow` scopes)
2. **Select/create repo** → Pick existing repo or create a new one (personal account only)
3. **Cloudflare config** (optional) → Enter CF Account ID + API Token → saves as GitHub Actions secrets + pushes deploy workflow
4. **Launch editor** → Boots WP Playground in an iframe with the exporter plugin pre-loaded
5. **Create content** → User writes posts/pages in the standard WP editor
6. **Sync** → Exports all content as Markdown via REST API, commits additions AND deletions to GitHub via GraphQL
7. **Auto-deploy** → GitHub Actions builds the Astro site and deploys to Cloudflare Pages

### Key Technologies

| Layer | Tech |
|-------|------|
| CMS | WordPress Playground (in-browser, runs in iframe) |
| Build tool | Vite |
| Content format | Markdown with YAML frontmatter |
| Static site | Astro 5 (content collections: `blog` + `pages`) |
| Git API | GitHub GraphQL (`createCommitOnBranch` mutation) |
| Secrets encryption | tweetnacl + blakejs (NaCl sealed box) |
| Deploy | GitHub Actions → Cloudflare Pages via wrangler-action |

---

## File Map (astro-wp-web-app/)

### `index.html`
Entry point. Two screens: setup and editor.

**Setup screen** layout:
- `.setup-card` contains `.setup-header` (title + subtitle), `.setup-steps` (the step sections), and `.setup-footer` (reset session link)
- Each step is a `.setup-section` with a `.step-header` containing a `.step-num` badge and `<h2>` title
- Step numbers are dynamically assigned via JS (`renumberSteps()`) — hidden sections (e.g., CF step when already configured) are excluded from numbering, so the user always sees sequential numbers (1, 2, 3) with no gaps
- Info tooltips use `.info-tip` elements with `data-tip` attributes, rendered via CSS `::after` pseudo-element (dark popover on hover)
- "Reset session" link at the bottom clears `sessionStorage` and reloads the page

**Editor screen** layout:
- Dark header bar with repo name badge, sync status, "Sync All" button, and "Back" button
- Loading overlay with spinner (shown while WP Playground boots)
- Full-height iframe for WP Playground

### `src/main.js`
Main application logic. Key responsibilities:

**Setup flow:**
- PAT connection — validates token via GitHub API, stores in `sessionStorage`, auto-restores on page load
- Repo selection/creation — lists user's repos, or creates new one with sanitized name and `auto_init: true`
- Cloudflare setup — saves Account ID + API Token as GitHub Actions secrets via NaCl sealed box encryption, pushes deploy workflow to `.github/workflows/deploy.yml`, queries GitHub Deployments API for the real CF Pages URL
- Dynamic step numbering — `renumberSteps()` counts only visible `.setup-section` elements and sets their `.step-num` badge text. Called whenever sections show/hide.
- Session reset — "Reset session" link clears `sessionStorage` and reloads

**Editor boot (`bootEditor()`):**
- Fetches existing content from GitHub via `github.fetchContent()`
- Seeds `contentManifest` from fetched content (path → git blob SHA) so deletions can be detected on first sync
- Sets `contentManifest._templatePushed = true` if content already exists
- Builds WP Playground Blueprint with: mkdir steps, plugin files, PHP class files, existing content `.md` files, plugin activation, WP config, and content import via `Astro_MD_Importer`

**Sync flow (`syncToGitHub()`):**
1. Fetches posts, pages, images from WP via REST API (`playgroundClient.request()`)
2. Compares MD5 hashes against `contentManifest` to find additions/changes
3. Detects deletions — paths in `contentManifest` (under `src/content/blog/`, `src/content/pages/`, `public/assets/images/`) that are not present in WP's current content
4. Commits all additions + deletions in a single GraphQL `createCommitOnBranch` mutation
5. Updates manifest (add new hashes, remove deleted paths)
6. Queries GitHub Deployments API for the real CF Pages URL and displays it as a clickable link

**State:**
- `selectedRepo` — `{ owner, name, full_name }`
- `playgroundClient` — WP Playground client instance
- `contentManifest` — `{ path: hash }` map tracking what's in GitHub. Seeded from `fetchContent()` on boot, updated after each sync. Internal keys prefixed with `_` (e.g., `_templatePushed`) are skipped during deletion detection.
- `cfPagesUrl` — the real Cloudflare Pages URL, persisted in `sessionStorage`

### `src/github.js`
GitHub API wrapper using Octokit. Key functions:
- `connect(token)` — Initialize Octokit, return authenticated user
- `listRepos()` — All repos user can push to (paginated, max 100)
- `createRepo(name)` — Create with `auto_init: true` (template files pushed on first sync)
- `fetchContent(owner, repo)` — Fetch existing blog posts, pages, images from repo. Returns `{ posts: [{name, content, sha}], pages: [...], images: [...] }`
- `commitFiles(owner, repo, branch, files, message, deletePaths=[])` — **Uses GraphQL `createCommitOnBranch` mutation**. HEAD OID fetched via GraphQL (not REST — avoids stale cache). `files` is `{ path: content }` for additions. `deletePaths` is `string[]` of paths to delete. Both are passed in `fileChanges: { additions, deletions }`.
- `setRepoSecret(owner, repo, name, value)` — Encrypt with NaCl sealed box, set via Actions secrets API
- `getDeploymentUrl(owner, repo)` — Searches recent GitHub Deployments for any with a `.pages.dev` URL. Strips per-commit hash prefix (e.g., `abc123.my-site.pages.dev` → `my-site.pages.dev`). Returns the production URL or `null`.

### `src/plugin.js`
WP plugin PHP code as JS string exports:
- `mainPlugin` — Plugin entry point. Defines constants (`ASTRO_EXPORT_DIR`, `ASTRO_PAGES_EXPORT_DIR`, `ASTRO_IMAGES_DIR`), ensures export directories exist, includes ALL class files (markdown converter, frontmatter builder, image handler, post exporter, md-to-blocks, md-importer, REST API), registers hooks
- `restApiClass` — REST API class with endpoints:
  - `GET /astro-export/v1/posts` — All published/draft posts as markdown (returns `[{id, slug, filename, markdown, hash}]`)
  - `GET /astro-export/v1/pages` — Same for pages
  - `GET /astro-export/v1/images` — Images as base64 with metadata
  - `GET /astro-export/v1/manifest` — `{path: md5hash}` for change detection
  - `GET /astro-export/v1/post/{id}` and `/page/{id}` — Single item
- `getPluginFiles()` — Returns `{ virtualPath: phpContent }` map for Blueprint writeFile steps. Only includes the main plugin file and REST API class; core PHP classes are written separately via `getCorePHPSteps()` in main.js.

**Important:** The `mainPlugin` string must `require_once` all 6 class files including `class-md-to-blocks.php` and `class-md-importer.php`. Without these, the content importer silently fails (`class_exists('Astro_MD_Importer')` returns false).

### `src/template.js`
`getTemplateFiles()` returns a `{ path: content }` map of all Astro site scaffold files committed to the user's repo on first sync:

**Config files:**
- `package.json` — Astro 5 dependency, build/dev/preview scripts
- `astro.config.mjs` — Minimal `defineConfig({})`
- `tsconfig.json` — Extends `astro/tsconfigs/strict`

**Content collections (`src/content/config.ts`):**
- `blog` collection — schema: title, description, pubDate, updatedDate, author, categories, tags, heroImage, draft
- `pages` collection — schema: title, description, updatedDate, menuOrder, heroImage, draft

**Layouts:**
- `BaseLayout.astro` — Dark gradient header (`#1a1a2e` → `#2d2b55` → `#3d3580`), sticky nav with pill-style links, warm off-white body (`#faf9f7`), dark footer matching header. Dynamically renders page nav links from the `pages` collection. Global styles defined in `<style is:global>`.
- `BlogPost.astro` — Article layout with hero image, styled metadata bar (date, author, updated date with `·` separators), description as italic lead. Scoped styles for content typography (headings, blockquotes, code blocks).
- `PageLayout.astro` — Simple article layout with optional hero image.

**Pages:**
- `index.astro` — Hero section with gradient background, CTA button linking to `/blog/`. Card-based "Recent Posts" section (latest 5). Empty state with dashed border.
- `blog/index.astro` — Header with title + post count. Card-based listing with title, excerpt, date, author, animated arrow. Empty state.
- `blog/[...slug].astro` — Dynamic blog post routes. Uses `getStaticPaths()` with slug derived from `post.id.replace(/\.md$/, '')`.
- `[...slug].astro` — Dynamic page routes. Same slug derivation.

**All slug references must strip `.md` extension** — see "Astro 5 Content Collection Gotchas" section.

**Deploy workflow (`.github/workflows/deploy.yml`):**
See "Deploy Workflow & Site URL Resolution" section for full details.

**Placeholder files:**
- `src/content/blog/.gitkeep`, `src/content/pages/.gitkeep`, `public/assets/images/.gitkeep`

### `src/style.css`
Styles organized by section:
- **Setup screen** — gradient background, card with shadow, header/steps/footer layout
- **Step header** — flex row with numbered circle badge, h2 title, optional info-tip and badges
- **Info tooltip** — `::after` pseudo-element positioned below the `(i)` icon, uses `data-tip` attribute for content. Dark background, white text, 260px wide, appears on hover with opacity transition.
- **Inputs** — full-width with focus ring. `.input-row` places input + button side-by-side.
- **Buttons** — `.btn` base, `.btn-primary` (purple), `.btn-secondary` (gray), `.btn-small` (compact)
- **Status badges** — `.status.success` (green), `.status.error` (red), `.status.working` (amber). Hidden when empty via `:empty` selector.
- **Setup footer** — centered "Reset session" link, subtle gray, turns red on hover
- **Editor header** — dark bar, flex layout, repo badge
- **Loading overlay** — centered spinner with message

### `vite-plugin-php-inline.js`
Custom Vite plugin that reads 6 PHP class files from the CLI project at build time and exposes them as `virtual:php-classes`. Uses `JSON.stringify()` for safe string escaping. Watches files for HMR.

PHP files sourced from: `../astro-wp-playground/wp-astro-plugin/includes/`
- `class-markdown-converter.php` — HTML → Markdown conversion
- `class-frontmatter-builder.php` — Builds YAML frontmatter from WP post data
- `class-image-handler.php` — Processes featured + inline images
- `class-post-exporter.php` — Orchestrates per-post export
- `class-md-to-blocks.php` — Converts Markdown back to WP blocks (for round-trip)
- `class-md-importer.php` — Imports existing .md files into WP on boot

### `vite.config.js`
Minimal — just loads the PHP inline plugin.

---

## How the Sync Works

1. SPA calls WP Playground REST API via `playgroundClient.request()` (NOT `fetch()` — avoids CORS)
2. Gets all posts, pages, and images as JSON (images are base64-encoded)
3. Compares MD5 hashes against in-memory `contentManifest` to find additions/changes
4. Detects deletions: any path in `contentManifest` under `src/content/blog/`, `src/content/pages/`, or `public/assets/images/` that doesn't appear in the current WP content is marked for deletion. Manifest keys starting with `_` (internal flags) are skipped.
5. On first sync, also includes Astro template/scaffold files (excluding `.github/` workflows)
6. Commits all additions AND deletions in a single GraphQL `createCommitOnBranch` mutation (uses `fileChanges: { additions, deletions }`)
7. Updates local manifest — adds new hashes, removes deleted paths
8. Queries GitHub Deployments API for the real CF Pages URL and displays it

### Content Manifest Seeding

On boot, `bootEditor()` seeds `contentManifest` from `fetchContent()` results:
```js
contentManifest[`src/content/blog/${post.name}`] = post.sha; // git blob SHA
```
This ensures deletions are detected even on the first sync of a fresh session. The git blob SHA won't match the MD5 hash from WP export, so the first sync will re-push all content (ensuring consistency). Subsequent syncs use MD5 hashes.

### Why GraphQL Instead of REST

The Git Trees REST API returned persistent 404 errors on newly created repos (GitHub eventual consistency + fine-grained token issues). The GraphQL `createCommitOnBranch` mutation is a single call that handles tree creation internally. It also natively accepts base64 content, making binary file commits simpler.

**Recommendation: Keep GraphQL.** It's working, it's simpler (1 call vs 3-4), and it handles edge cases better.

### Why HEAD OID Uses GraphQL Too

The `commitFiles` function fetches the branch HEAD SHA via GraphQL (`repository.ref.target.oid`) instead of the REST `git.getRef` API. The REST endpoint can return stale/cached SHAs, causing the `createCommitOnBranch` mutation to fail with "Expected branch to point to X but it did not." Using GraphQL for both the read and the write ensures consistency.

---

## Deploy Workflow & Site URL Resolution

### The Problem

When creating a Cloudflare Pages project, if the requested name (e.g., `my-astro-site`) is already taken globally, CF silently appends a random suffix (e.g., `my-astro-site-60m`). This means the actual site URL differs from what the app would naively guess.

Additionally:
- The browser **cannot call the CF API directly** due to CORS (no `Access-Control-Allow-Origin` header)
- GitHub Actions `GITHUB_TOKEN` **cannot set repo variables** (insufficient permissions)
- GitHub Actions `GITHUB_TOKEN` **can create Deployments** (with `deployments: write` permission)

### The Solution

The deploy workflow (`deploy.yml`) has four steps after build:

1. **Create CF Pages project** — `curl` POST to CF API to ensure the project exists (no-op if already created)
2. **Deploy via wrangler-action** — deploys to CF Pages with `id: deploy`. The action outputs `deployment-url` (e.g., `https://abc123.my-astro-site-60m.pages.dev`)
3. **Save site URL as GitHub Deployment** — strips the per-commit hash from the wrangler URL using `sed 's|https://[a-f0-9]*\.||'` to get the production URL, then creates a GitHub Deployment with `environment: "production"` and the URL as `environment_url`

The app reads the URL back via `github.js → getDeploymentUrl()`:
- Lists recent deployments (up to 10, no environment filter)
- For each, fetches deployment statuses and looks for `environment_url` containing `.pages.dev`
- Strips any per-commit hash prefix via regex: `/https?:\/\/[a-f0-9]+\.(.+\.pages\.dev)/`
- Returns the clean production URL

### Why Not Simpler Approaches

| Approach | Why it doesn't work |
|----------|-------------------|
| Guess URL from repo name | CF may append a suffix — wrong URL |
| Query CF API from browser | CORS blocks it (no `Access-Control-Allow-Origin`) |
| Store as GitHub Actions variable | `GITHUB_TOKEN` can't write variables |
| Store as repo secret | Secrets can't be read back via API |
| Parse workflow run logs | Logs come as zip files — too complex for browser |
| Read from wrangler output directly | Only available during the workflow run |

### Workflow Permissions

The workflow requires:
- `contents: read` — to checkout code
- `deployments: write` — to create GitHub Deployments with the site URL

The `GITHUB_TOKEN` is automatically provided. CF credentials come from repo secrets (`CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`) set during the CF setup step.

---

## Astro 5 Content Collection Gotchas

### `.md` Extension in Slugs

In Astro 5, `post.id` includes the file extension (e.g., `hello-world.md`), unlike Astro 4 where it was just `hello-world`. All template files that use `post.id` or `page.id` as URL slugs must strip the extension:

```js
params: { slug: post.id.replace(/\.md$/, '') }
```

This applies to: `[...slug].astro` (both blog and pages), `index.astro` (home page links), `blog/index.astro` (post links), and `BaseLayout.astro` (page nav links).

---

## Known Issues & Gotchas

### PAT Scope Requirements
- `repo` scope: Required for all operations
- `workflow` scope: Required ONLY for pushing `.github/workflows/` files. Without it, GitHub returns a permissions error on the GraphQL mutation. The app handles this by pushing deploy.yml separately during the CF setup step (not during normal sync).

### Template Push Strategy
- Repo is created with `auto_init: true` (just a README)
- Template files are pushed on FIRST sync (flag: `contentManifest._templatePushed`)
- `.github/workflows/deploy.yml` is pushed separately when user saves CF credentials
- The `_templatePushed` flag is set AFTER commit succeeds (was a bug before — setting it before meant retries would skip templates)
- If the repo already has content (detected by `fetchContent()`), `_templatePushed` is set during boot to avoid re-pushing templates

### Deploy Workflow Gotchas
- Must use `npm install` (not `npm ci`) because no `package-lock.json` is committed to the repo
- The `--create-project` flag does not exist in wrangler v3 — project must be created via the CF API before deploying
- wrangler-action v3 is pinned; v4's flags differ
- The `deployment-url` output from wrangler-action is a per-commit preview URL (e.g., `abc123.my-site.pages.dev`), not the production URL — must be stripped

### WP Playground Quirks
- `writeFile` Blueprint step does NOT auto-create parent directories. Must use `mkdir` steps first.
- REST API calls from the parent page are blocked by CORS. Use `playgroundClient.request()` which routes through the iframe's service worker.
- Blueprint `runPHP` steps execute in the WP context (`require wp-load.php` to access WP functions).

### Content Import on Boot
- The plugin's `mainPlugin` must `require_once` both `class-md-to-blocks.php` and `class-md-importer.php` for the importer to work. These were originally missing and the import silently failed because `class_exists('Astro_MD_Importer')` returned false.
- Existing content is fetched from GitHub, written to WP Playground's virtual filesystem, then imported into WP via the `Astro_MD_Importer` class in a `runPHP` Blueprint step.

### Content Deletion
- The WP REST API only queries `post_status: ['publish', 'draft']`. Trashed and permanently deleted posts are excluded from the response.
- During sync, any path in `contentManifest` that no longer appears in the WP response is added to `deletePaths` and included in the commit's `fileChanges.deletions`.
- The manifest must be seeded on boot (from `fetchContent()`) for deletions to work on the first sync of a fresh session.

### Session Storage
- PAT, CF Pages URL, and CF configured flag are stored in `sessionStorage` (lost on tab close)
- "Reset session" link in the setup footer clears all session data and reloads
- The content manifest is NOT persisted — it's rebuilt from `fetchContent()` on each boot and updated during sync

### Build Dependencies
- The Vite plugin reads PHP files from the sibling CLI project directory. Both projects must exist side-by-side.
- `libsodium-wrappers` doesn't work with Vite's ESM bundler. That's why we use `tweetnacl` + `blakejs` for GitHub secret encryption.

---

## Remaining Work

### Should Improve
1. **Error handling** — Many error paths just show `Error: ${e.message}`. Add more helpful messages, especially for PAT permission errors (suggest adding `workflow` scope).
2. **Image round-trip** — Images are exported to GitHub but not re-imported when loading existing content. The `fetchContent()` function fetches image metadata but doesn't download/inject them into WP Playground.
3. **Session persistence** — PAT is stored in `sessionStorage` (lost on tab close). Consider offering `localStorage` option with a warning.
4. **Multiple branch support** — Everything targets `main`. Some users may want `develop` or feature branches.
5. **First-sync URL timing** — On the very first sync, the deployment URL won't be available yet (the GitHub Actions deploy hasn't run). The app shows "Deploy will start shortly" — subsequent syncs will show the URL once the first deploy creates the GitHub Deployment record.

### Nice to Have
6. **Progress indicator for sync** — Show file-by-file progress during large syncs
7. **Diff preview before sync** — Show what changed before committing
8. **Selective sync** — Let users choose which posts/pages to sync
9. **Custom domain setup** — Guide users through CF Pages custom domain configuration

---

## Running the Project

```bash
cd astro-wp-web-app
npm install
npm run dev        # → http://localhost:5173
npm run build      # → dist/
```

Requires the CLI project to exist at `../astro-wp-playground/` for PHP file inlining at build time.

---

## GitHub User Context

- GitHub username: `ilicfilip`
- Test repo: `my-astro-site` (CF Pages project: `my-astro-site-60m` due to name collision)
- PAT scopes needed: `repo` + `workflow` (classic token)
