# Astro WP — Project Handoff

## What This Is

A browser-based CMS that lets users write content in WordPress, store it as Markdown in a GitHub repo, and auto-deploy as a static Astro site to Cloudflare Pages. No servers, no hosting to manage — everything runs in the browser via WP Playground.

Related repo (optional context): [astro-wp-playground](https://github.com/ProgressPlanner/astro-wp-playground) is a CLI-oriented prototype that runs WordPress Playground via Node. This repo (`astro-wp-web-app/`) is the browser SPA.

Exporter PHP lives in **`php-classes/`** at the root of this repo. At build time, `vite-plugin-php-inline.js` reads those files and exposes them as the virtual module `virtual:php-classes` (see below). You can point the plugin at another directory with `phpInlinePlugin({ phpDir: '/path/to/includes' })` in `vite.config.js` if you want a single shared checkout with the CLI project.

---

## Architecture Overview

### User Flow

1. **Setup screen** → User enters GitHub PAT (`repo` + `workflow` scopes)
2. **Select/create repo** → Pick existing repo or create a new one (personal account only)
3. **Cloudflare config** (optional) → Enter CF Account ID + API Token → saves as GitHub Actions secrets + pushes deploy workflow
4. **Launch editor** → Boots WP Playground in an iframe with the exporter plugin pre-loaded
5. **Create content** → User writes posts/pages in the standard WP editor
6. **Sync** → Exports posts, pages, images, and **navigation menus** via REST API; commits additions AND deletions to GitHub via GraphQL
7. **Auto-deploy** → GitHub Actions builds the Astro site and deploys to Cloudflare Pages

### Key Technologies

| Layer | Tech |
|-------|------|
| CMS | WordPress Playground (in-browser, runs in iframe) |
| Build tool | Vite |
| Content format | Markdown with YAML frontmatter |
| Static site | Astro 6 (content collections with Content Layer API: `blog` + `pages`; header nav from `src/data/menu.json` when synced) |
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
- Dark header bar with repo name badge, sync status, **View site** (opens the live Astro site in a new tab; disabled until a deploy URL is available), **Menus** (`goTo('/wp-admin/nav-menus.php')` — there is no address bar), "Sync All" button, and "Back" button
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
- Fetches existing content from GitHub via `github.fetchContent()` (posts, pages, images, optional `src/data/menu.json`)
- Seeds `contentManifest` from fetched content (path → git blob SHA) so deletions can be detected on first sync
- Sets `contentManifest._templatePushed = true` if content already exists
- Builds WP Playground Blueprint with: mkdir steps, **preview theme** files (including pre-made screenshot via base64 decode), plugin files, PHP class files, existing content `.md` files, plugin activation, **theme activation** (`wp2astro-preview` via `runPHP`/`switch_theme()`), WP config, content import via `Astro_MD_Importer`, and **menu import** from `menu.json` (recreates nav menu items with labels, hrefs, targets, title attributes, CSS classes, rel/XFN, and nested children; assigns to theme locations)
- After Playground is ready, fetches the deploy URL from GitHub Deployments API and enables the **View site** button if available

**Sync flow (`syncToGitHub()`):**
1. Fetches posts, pages, images, and **menu** from WP via REST API (`playgroundClient.request()`)
2. Compares MD5 hashes against `contentManifest` to find additions/changes (including `src/data/menu.json`)
3. Detects deletions — paths in `contentManifest` (under `src/content/blog/`, `src/content/pages/`, `public/assets/images/`) that are not present in WP's current content (`menu.json` is not deleted by this logic)
4. Commits all additions + deletions in a single GraphQL `createCommitOnBranch` mutation
5. Updates manifest (add new hashes, remove deleted paths)
6. Shows "Waiting for deploy..." and polls GitHub Deployments API via `waitForDeploy()` until the deployment reaches a terminal state (success/failure/timeout). On success, enables the **View site** button and displays the live URL as a clickable link

**State:**
- `selectedRepo` — `{ owner, name, full_name }`
- `playgroundClient` — WP Playground client instance
- `contentManifest` — `{ path: hash }` map tracking what's in GitHub. Seeded from `fetchContent()` on boot, updated after each sync. Internal keys prefixed with `_` (e.g., `_templatePushed`) are skipped during deletion detection.
- `cfPagesUrl` — the real Cloudflare Pages URL, persisted in `sessionStorage`. Fetched on boot from GitHub Deployments API (catches deploys from previous sessions) and updated after each sync via deploy polling

### `src/github.js`
GitHub API wrapper using Octokit. Key functions:
- `connect(token)` — Initialize Octokit, return authenticated user
- `listRepos()` — All repos user can push to (paginated, max 100)
- `createRepo(name)` — Create with `auto_init: true` (template files pushed on first sync)
- `detectContentRoot(owner, repo)` — Auto-detects the Astro project root within the repo. Looks for `astro.config.mjs`/`.ts` at root first, then checks subdirectories. Returns `''` for root-level projects or `'subdir/'` for nested ones (e.g., `'src-astro/'`). All content paths are prefixed with this root.
- `fetchContent(owner, repo, contentRoot='')` — Fetch existing blog posts, pages, images, and `src/data/menu.json` from repo, using `contentRoot` prefix for all paths. Returns `{ posts, pages, images, menu }` (`menu` is `null` if the file is missing)
- `fetchTemplateVersion(owner, repo, contentRoot='')` — Reads `<contentRoot>.astro-wp-version` from the repo. Returns `{ template, version }` or `{ template: 'default', version: 0 }` if the file is missing (unversioned repo)
- `commitFiles(owner, repo, branch, files, message, deletePaths=[])` — **Uses GraphQL `createCommitOnBranch` mutation**. HEAD OID fetched via GraphQL (not REST — avoids stale cache). `files` is `{ path: content }` for additions. `deletePaths` is `string[]` of paths to delete. Both are passed in `fileChanges: { additions, deletions }`.
- `setRepoSecret(owner, repo, name, value)` — Encrypt with NaCl sealed box, set via Actions secrets API
- `getDeploymentUrl(owner, repo)` — Searches recent GitHub Deployments for any with a `.pages.dev` URL. Strips per-commit hash prefix (e.g., `abc123.my-site.pages.dev` → `my-site.pages.dev`). Returns the production URL or `null`.
- `waitForDeploy(owner, repo, afterTimestamp, onStatus, opts)` — Polls GitHub Deployments API for a deployment created after `afterTimestamp`. Calls `onStatus(state, url)` on each poll (`pending`/`in_progress`/`success`/`failure`/`error`/`timeout`). Returns `{ state, url }`. Default interval: 8s, timeout: 5 min.

### `src/plugin.js`
WP plugin PHP code as JS string exports:
- `mainPlugin` — Plugin entry point. Defines constants (`ASTRO_EXPORT_DIR`, `ASTRO_PAGES_EXPORT_DIR`, `ASTRO_IMAGES_DIR`), ensures export directories exist, includes ALL class files (markdown converter, frontmatter builder, image handler, post exporter, md-to-blocks, md-importer, REST API), registers hooks
- `restApiClass` — REST API class with endpoints:
  - `GET /astro-export/v1/posts` — All published/draft posts as markdown (returns `[{id, slug, filename, markdown, hash}]`)
  - `GET /astro-export/v1/pages` — Same for pages
  - `GET /astro-export/v1/images` — Images as base64 with metadata
  - `GET /astro-export/v1/manifest` — `{path: md5hash}` for change detection (includes `src/data/menu.json`)
  - `GET /astro-export/v1/menu` — Nav menus by theme location: `{ locations: { primary: [...], ... }, hash }`. Tree nodes: `label`, `href`, optional `target` (e.g. `_blank`), optional `title` (title attribute), optional `classes` (string array of CSS classes), optional `rel` (XFN/link relationship), optional nested `children`. Internal URLs normalized to site-relative paths (Playground `/scope:*` prefixes are stripped); external links unchanged.
  - `GET /astro-export/v1/post/{id}` and `/page/{id}` — Single item
- `getPluginFiles()` — Returns `{ virtualPath: phpContent }` map for Blueprint writeFile steps. Only includes the main plugin file and REST API class; core PHP classes are written separately via `getCorePHPSteps()` in main.js.

**Important:** The `mainPlugin` string must `require_once` all 6 class files including `class-md-to-blocks.php` and `class-md-importer.php`. Without these, the content importer silently fails (`class_exists('Astro_MD_Importer')` returns false).

### `src/template.js`
`getTemplateFiles()` returns a `{ path: content }` map of all Astro site scaffold files committed to the user's repo on first sync (and re-pushed when the template version changes). Also exports `TEMPLATE_VERSION` (integer, bump on any template change) and `TEMPLATE_NAME` (`'default'`):

**Config files:**
- `package.json` — Astro 6 dependency, build/dev/preview scripts
- `astro.config.mjs` — Minimal `defineConfig({})`
- `tsconfig.json` — Extends `astro/tsconfigs/strict`

**Content collections (`src/content.config.ts`):**
- Uses Astro 6 Content Layer API with `glob()` loader
- `blog` collection — `glob({ base: './src/content/blog', pattern: '**/*.{md,mdx}' })` — schema: title, description, pubDate, updatedDate, author, categories, tags, heroImage, draft
- `pages` collection — `glob({ base: './src/content/pages', pattern: '**/*.{md,mdx}' })` — schema: title, description, updatedDate, menuOrder, heroImage, draft
- `z` imported from `astro/zod` (Astro 6 change from `astro:content`)

**Site navigation (`src/data/menu.json` + components):**
- Committed JSON shape: `{ "locations": { "primary": [...], ... } }`. Sync writes pretty-printed JSON; the REST `hash` is derived from WordPress’s compact JSON of the same structure.
- `NavMenu.astro` — Recursive list for nested items; renders `target`, `title`, `rel` attributes on links and CSS classes on `<li>` elements when present. Submenus use hover dropdown styles in the layout.
- **WordPress:** Use **Appearance → Menus**. Assign the menu to your theme’s primary (or header) **location** when available; if no location is assigned, the exporter uses the **first** menu as `primary`. Classic menus only — not the block-only Navigation block in isolation. All WP menu item fields are synced: Navigation Label, URL, Link Target, Title Attribute, CSS Classes, and Link Relationship (XFN).

**Layouts:**
- `BaseLayout.astro` — Imports `../data/menu.json`. If `locations.primary` (or the first non-empty location) has items, the header nav uses **WordPress**. Otherwise it falls back to **Home**, **Blog**, and links derived from the `pages` collection (previous behavior). Dark gradient header (`#1a1a2e` → `#2d2b55` → `#3d3580`), sticky nav, warm off-white body (`#faf9f7`), dark footer. Global styles defined in `<style is:global>`.
- `BlogPost.astro` — Article layout with hero image, styled metadata bar (date, author, updated date with `·` separators), description as italic lead. Scoped styles for content typography (headings, blockquotes, code blocks).
- `PageLayout.astro` — Simple article layout with optional hero image.

**Pages:**
- `index.astro` — Hero section with gradient background, CTA button linking to `/blog/`. Card-based "Recent Posts" section (latest 5). Empty state with dashed border.
- `blog/index.astro` — Header with title + post count. Card-based listing with title, excerpt, date, author, animated arrow. Empty state.
- `blog/[...slug].astro` — Dynamic blog post routes. Uses `getStaticPaths()` with `post.id` as slug (Astro 6 glob loader returns clean IDs without `.md` extension).
- `[...slug].astro` — Dynamic page routes. Same pattern.

**Deploy workflow (`.github/workflows/deploy.yml`):**
See "Deploy Workflow & Site URL Resolution" section for full details.

**Placeholder files:**
- `src/content/blog/.gitkeep`, `src/content/pages/.gitkeep`, `public/assets/images/.gitkeep`
- `src/data/menu.json` — Default `{ "locations": { "primary": [] } }` until the first menu sync overwrites it
- `.astro-wp-version` — `{ "template": "default", "version": <TEMPLATE_VERSION> }` — used to detect stale templates and trigger re-push on sync

### `src/wp-theme.js`
Minimal **classic** theme **`wp2astro-preview`** (written into Playground at `/wordpress/wp-content/themes/wp2astro-preview/`). Exported via `getWp2AstroPreviewThemeFiles()` and activated with a Blueprint **`runPHP`** step that calls `switch_theme()` using `WP_CONTENT_DIR` (same `/wordpress/` layout as other steps — the stock `activateTheme` step keys off `documentRoot` and can miss the theme path in some Playground builds). Registers a single **`primary`** menu location so **Appearance → Menus** is available. Includes simple `index.php`, `single.php`, `page.php`, `header.php`, `footer.php`, and a short footer note that the public site is Astro. A pre-made `screenshot.png` is embedded as base64 in `src/assets/theme-screenshot-b64.js` and written via a `runPHP` step (`getWp2AstroPreviewScreenshotStep()`). Not committed to the user’s GitHub Astro repo — only lives in the Playground VM.

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

### `php-classes/`
Six PHP classes used by the WordPress exporter plugin inside Playground (same logical module as the [astro-wp-playground](https://github.com/ProgressPlanner/astro-wp-playground) plugin). Kept in-repo so the web app builds standalone.

### `vite-plugin-php-inline.js`
Custom Vite plugin that reads those 6 PHP files at build time (default directory: `php-classes/` next to `vite.config.js`) and exposes them as `virtual:php-classes`. Uses `JSON.stringify()` for safe string escaping. Watches files for HMR.

PHP files (in `php-classes/` unless `phpDir` is overridden):
- `class-markdown-converter.php` — HTML → Markdown conversion
- `class-frontmatter-builder.php` — Builds YAML frontmatter from WP post data
- `class-image-handler.php` — Processes featured + inline images
- `class-post-exporter.php` — Orchestrates per-post export
- `class-md-to-blocks.php` — Converts Markdown back to WP blocks (for round-trip)
- `class-md-importer.php` — Imports existing .md files into WP on boot

### `vite.config.js`
Loads `phpInlinePlugin()` with defaults (`php-classes/`). Pass `{ phpDir: '...' }` only if you want to load classes from elsewhere (e.g. a sibling `astro-wp-playground` checkout).

---

## How the Sync Works

1. SPA calls WP Playground REST API via `playgroundClient.request()` (NOT `fetch()` — avoids CORS)
2. Gets all posts, pages, images, and **menu** as JSON (images are base64-encoded; menu includes a content `hash` for `src/data/menu.json`)
3. Compares MD5 hashes against in-memory `contentManifest` to find additions/changes
4. Detects deletions: any path in `contentManifest` under `src/content/blog/`, `src/content/pages/`, or `public/assets/images/` that doesn't appear in the current WP content is marked for deletion. Manifest keys starting with `_` (internal flags) are skipped.
5. On first sync, also includes Astro template/scaffold files (excluding `.github/` workflows)
6. Commits all additions AND deletions in a single GraphQL `createCommitOnBranch` mutation (uses `fileChanges: { additions, deletions }`)
7. Updates local manifest — adds new hashes, removes deleted paths (including `src/data/menu.json`’s hash from the menu endpoint)
8. Polls GitHub Deployments API (`waitForDeploy()`) until the deployment created after the commit reaches a terminal state. Shows real-time status ("Waiting for deploy..." → "Deployed — URL")

**CI:** No workflow changes are required for `menu.json` — `npm run build` picks it up like any other committed file under `src/`.

### Content Manifest Seeding

On boot, `bootEditor()` seeds `contentManifest` from `fetchContent()` results:
```js
contentManifest[`src/content/blog/${post.name}`] = post.sha; // git blob SHA
```
This ensures deletions are detected even on the first sync of a fresh session. The git blob SHA won't match the MD5 hash from WP export, so the first sync will re-push all content (ensuring consistency). Subsequent syncs use MD5 hashes. If `menu.json` exists in the repo, its blob SHA is seeded the same way; the first sync may re-commit menu JSON to align hashes.

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

## Astro 6 Content Layer Migration

Templates use Astro 6's Content Layer API. Key differences from Astro 5:

- **Config location**: `src/content.config.ts` (was `src/content/config.ts`). Template updates automatically delete the old file.
- **Glob loader**: Collections use `loader: glob({ base, pattern })` instead of `type: 'content'`.
- **Zod import**: `import { z } from 'astro/zod'` (was `from 'astro:content'`).
- **Clean IDs**: `post.id` returns `hello-world` (no `.md` extension), so no stripping needed.
- **`render()`**: Standalone function `import { render } from 'astro:content'` (already used in Astro 5 templates).

---

## Using with Custom Astro Sites

The app can sync content into any Astro site — not just repos created through the app. When a repo already has content but no `.astro-wp-version` file, the app runs in **content-only mode**: it pushes blog posts, pages, images, and menus without touching templates, layouts, styles, or config.

**Subdirectory support:** The Astro project doesn't need to be at the repo root. On boot, `detectContentRoot()` searches for `astro.config.mjs`/`.ts` — if found in a subdirectory (e.g., `src-astro/`), all content paths are automatically prefixed. No configuration needed.

### What the app syncs

All paths below are relative to the detected content root (e.g., `src-astro/` or repo root).

| Content | Repo path | Format |
|---------|-----------|--------|
| Blog posts | `src/content/blog/<slug>.md` | Markdown with YAML frontmatter |
| Pages | `src/content/pages/<slug>.md` | Markdown with YAML frontmatter |
| Images | `public/assets/images/<filename>` | Binary (base64-committed) |
| Navigation menus | `src/data/menu.json` | JSON |

### What the app does NOT touch

Layouts, components, styles, `package.json`, `astro.config.*`, `src/content.config.ts`, `.github/workflows/`, or any other file outside the content paths above.

### Requirements for custom repos

**Content collections** — The site's content config must define `blog` and `pages` collections that accept the frontmatter the exporter produces. All fields use `.optional().default()` so the site can ignore any it doesn't need, but the exporter will always include them.

Blog post frontmatter:
```yaml
title: string        # required
description: string
pubDate: date        # required
updatedDate: date
author: string       # default: "Admin"
categories: string[]
tags: string[]
heroImage: string    # path to image in public/assets/images/
draft: boolean
```

Page frontmatter:
```yaml
title: string        # required
description: string
updatedDate: date
menuOrder: number    # for nav ordering
heroImage: string
draft: boolean
```

**Images** — Referenced in frontmatter as `/assets/images/<filename>`. The app commits images to `public/assets/images/`. If your site uses a different image directory (e.g., `src/assets/images/`), you'll need to adjust your content references or add a redirect.

**Navigation menus** — The app writes `src/data/menu.json` with this shape:
```json
{
  "locations": {
    "primary": [
      {
        "label": "About",
        "href": "/about/",
        "target": "_blank",
        "title": "About us",
        "classes": ["highlight", "cta"],
        "rel": "noopener",
        "children": []
      }
    ]
  }
}
```
To use WP-managed navigation, import this JSON in your header/nav component and render the items. All fields except `label` and `href` are optional. The `primary` location is used when a WP menu is assigned to the theme's primary location; otherwise the first menu becomes `primary`.

### Adapting an existing site (checklist)

1. Ensure `src/content/blog/` and `src/content/pages/` directories exist
2. Add or update content config with compatible `blog` and `pages` collections (see frontmatter fields above)
3. Ensure `public/assets/images/` exists (or add `.gitkeep`)
4. Optionally: import `src/data/menu.json` in your nav component for WP-managed navigation
5. Connect the repo through the app — it will detect it as a custom site and sync content only

---

## Known Issues & Gotchas

### PAT Scope Requirements
- `repo` scope: Required for all operations
- `workflow` scope: Required ONLY for pushing `.github/workflows/` files. Without it, GitHub returns a permissions error on the GraphQL mutation. The app handles this by pushing deploy.yml separately during the CF setup step (not during normal sync).

### Template Push Strategy

The app detects three repo states and handles templates accordingly:

| State | `.astro-wp-version` | Has content? | Behavior |
|-------|---------------------|-------------|----------|
| New empty repo | missing | no | Push default templates + content |
| App-managed repo | present | yes | Push updated templates if version outdated + content |
| Custom repo | missing | yes | **Content-only sync** — never push templates |

Detection logic (`bootEditor()`): if `fetchContent()` finds existing posts/pages/images **and** `fetchTemplateVersion()` returns version 0 (no `.astro-wp-version`), the repo is marked as custom (`_isCustomRepo = true`).

**App-managed repos:**
- Repo is created with `auto_init: true` (just a README)
- Template files are pushed on FIRST sync (flag: `contentManifest._templatePushed`)
- `.github/workflows/deploy.yml` is pushed separately when user saves CF credentials
- The `_templatePushed` flag is set AFTER commit succeeds (was a bug before — setting it before meant retries would skip templates)
- **Template versioning:** A `.astro-wp-version` file in the repo tracks `{ "template": "<name>", "version": <int> }`. On boot, `fetchTemplateVersion()` reads this file. During sync, if the repo's version is lower than the app's `TEMPLATE_VERSION` (exported from `template.js`), all template files are re-pushed. The `template` field identifies which template set was used (currently only `"default"`); this future-proofs for multiple template choices without structural changes.
- **IMPORTANT — when changing any template file in `src/template.js`, you MUST bump `TEMPLATE_VERSION` in the same file.** This is what triggers existing repos to receive the updated templates on their next sync. Forgetting to bump means stale repos stay stale.

### Deploy Workflow Gotchas
- Must use `npm install` (not `npm ci`) because no `package-lock.json` is committed to the repo
- The `--create-project` flag does not exist in wrangler v3 — project must be created via the CF API before deploying
- wrangler-action v3 is pinned; v4's flags differ
- The `deployment-url` output from wrangler-action is a per-commit preview URL (e.g., `abc123.my-site.pages.dev`), not the production URL — must be stripped
- **Shell quoting in `-d` JSON**: the curl commands that create GitHub Deployments must use single-quoted JSON (`-d '{"ref":"main",...}'`). Double-quoted strings with escaped inner quotes (`-d "{\"ref\":\"main\"}"`) break because bash strips the escaping, producing invalid JSON and silently failing to create deployment statuses
- **Deployment ID extraction**: use `jq -r '.id'` (not `grep`) to extract the deployment ID from the GitHub API response. The API returns pretty-printed JSON with spaces (`"id": 123`), which breaks `grep -o '"id":[0-9]*'`

### WP Playground Quirks
- `writeFile` Blueprint step does NOT auto-create parent directories. Must use `mkdir` steps first.
- REST API calls from the parent page are blocked by CORS. Use `playgroundClient.request()` which routes through the iframe's service worker.
- Blueprint `runPHP` steps execute in the WP context (`require wp-load.php` to access WP functions).

### Content Import on Boot
- The plugin's `mainPlugin` must `require_once` both `class-md-to-blocks.php` and `class-md-importer.php` for the importer to work. These were originally missing and the import silently failed because `class_exists('Astro_MD_Importer')` returned false.
- Existing content is fetched from GitHub, written to WP Playground's virtual filesystem, then imported into WP via the `Astro_MD_Importer` class in a `runPHP` Blueprint step.
- **Nav menus** from `src/data/menu.json` are recreated on boot: menu items are created with labels, hrefs, targets, title attributes, CSS classes, rel/XFN, and nested children. Internal links are matched to WP pages/posts by slug (as `post_type` items). Menus are assigned to the corresponding theme locations.

### WP Playground Scope Prefix
- Playground adds a `/scope:0.xxx/` prefix to all internal URLs. The menu exporter strips this prefix via `strip_playground_scope()` so exported hrefs are clean site-relative paths (e.g., `/about/` instead of `/scope:0.123/about/`).

### Content Deletion
- The WP REST API only queries `post_status: ['publish', 'draft']`. Trashed and permanently deleted posts are excluded from the response.
- During sync, any path in `contentManifest` that no longer appears in the WP response is added to `deletePaths` and included in the commit's `fileChanges.deletions`.
- The manifest must be seeded on boot (from `fetchContent()`) for deletions to work on the first sync of a fresh session.

### Session Storage
- PAT, CF Pages URL, and CF configured flag are stored in `sessionStorage` (lost on tab close)
- "Reset session" link in the setup footer clears all session data and reloads
- The content manifest is NOT persisted — it's rebuilt from `fetchContent()` on each boot and updated during sync

### Build Dependencies
- PHP exporter sources are committed under `php-classes/`; no sibling repo is required unless you override `phpDir` in `vite.config.js`.
- `libsodium-wrappers` doesn't work with Vite's ESM bundler. That's why we use `tweetnacl` + `blakejs` for GitHub secret encryption.

---

## Remaining Work

### Should Improve
1. **Error handling** — Many error paths just show `Error: ${e.message}`. Add more helpful messages, especially for PAT permission errors (suggest adding `workflow` scope).
2. **Image round-trip** — Images are exported to GitHub but not re-imported when loading existing content. The `fetchContent()` function fetches image metadata but doesn't download/inject them into WP Playground.
3. **Session persistence** — PAT is stored in `sessionStorage` (lost on tab close). Consider offering `localStorage` option with a warning.
4. **Multiple branch support** — Everything targets `main`. Some users may want `develop` or feature branches.
5. **Multiple template sets** — Currently only one template (`"default"`). The `.astro-wp-version` file already includes a `template` field to identify the set. To add a new template: create its `getTemplateFiles()` variant, give it its own version counter, and route by the `template` name read from the repo.

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

PHP classes are read from `php-classes/` in this repo (see `vite-plugin-php-inline.js`).

---

## GitHub User Context

- GitHub username: `ilicfilip`
- Test repo: `my-astro-site` (CF Pages project: `my-astro-site-60m` due to name collision)
- PAT scopes needed: `repo` + `workflow` (classic token)
