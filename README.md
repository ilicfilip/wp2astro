# WP2Astro

A browser-based CMS that lets you write content in WordPress, store it as Markdown in a GitHub repo, and auto-deploy as a static Astro site to Cloudflare Pages. No servers needed — everything runs in the browser via [WordPress Playground](https://playground.wordpress.net/).

## How It Works

1. Connect your GitHub account (Personal Access Token)
2. Select or create a repository
3. Optionally configure Cloudflare Pages for auto-deploy
4. Write posts and pages in the WordPress editor (running in-browser)
5. Hit "Sync All" — content is exported as Markdown, images, and **navigation menus** (`src/data/menu.json`) and committed to GitHub
6. GitHub Actions builds the Astro site and deploys to Cloudflare Pages

## Tech Stack

| Layer | Technology |
|-------|-----------|
| CMS | WordPress Playground (in-browser, iframe) |
| Build | Vite |
| Content | Markdown with YAML frontmatter |
| Static Site | Astro 5 (content collections + optional WP-driven header nav) |
| Git API | GitHub GraphQL (`createCommitOnBranch`) |
| Deploy | GitHub Actions + Cloudflare Pages (wrangler) |

## Setup

```bash
npm install
npm run dev
```

### Auth Gate

The app has an optional password gate. Set the `VITE_AUTH_HASH` environment variable to a SHA-256 hash of your password:

```bash
# Generate the hash
echo -n "yourpassword" | shasum -a 256 | cut -d' ' -f1

# Add to .env for local development
echo "VITE_AUTH_HASH=<hash>" > .env
```

If `VITE_AUTH_HASH` is not set, the auth screen is skipped.

## Build

```bash
npm run build
```

Output goes to `dist/` — pure static HTML/JS/CSS, servable by any web server.

## Deploy to Cloudflare Pages

1. Connect this repo to CF Pages
2. Set build command: `npm run build`
3. Set output directory: `dist`
4. Add environment variables:
   - `NODE_VERSION` = `20`
   - `VITE_AUTH_HASH` = `<sha256 hash of your password>`
5. Add custom domain if desired

## Architecture

See [docs/architecture.md](docs/architecture.md) for the full technical documentation — file map, sync flow, deploy workflow, and known gotchas.

WordPress exporter PHP (HTML→Markdown, import, etc.) lives in **`php-classes/`** and is inlined at build time by `vite-plugin-php-inline.js`; you do not need a separate checkout for a successful build.

**Navigation & preview:** Playground boots with a minimal **classic** theme (**WP2Astro Preview**) so **Appearance → Menus** works and the WordPress **front-end** is a simple, separate preview from the Astro build. Use **View site** in the editor toolbar to open `/` in the iframe, and **Menus** for `/wp-admin/nav-menus.php` (no address bar in the embedded view). Configure **classic** menus for export; sync still writes **`src/data/menu.json`** for the static site. No CI workflow changes are required.

## Related

- [astro-wp-playground](https://github.com/ProgressPlanner/astro-wp-playground) — CLI version (local dev, runs WP Playground via Node); shares the same exporter concept as this app
