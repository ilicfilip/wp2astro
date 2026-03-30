/**
 * Astro site template files.
 *
 * These are committed to the user's GitHub repo when they create a new site.
 * Minimal Astro project with blog + pages content collections.
 */

export function getTemplateFiles() {
  return {
    'package.json': JSON.stringify({
      name: 'astro-wp-site',
      type: 'module',
      version: '0.1.0',
      scripts: {
        dev: 'astro dev',
        build: 'astro build',
        preview: 'astro preview',
      },
      dependencies: {
        astro: '^5.0.0',
      },
    }, null, 2),

    'astro.config.mjs': `import { defineConfig } from 'astro/config';
export default defineConfig({});
`,

    'tsconfig.json': JSON.stringify({
      extends: 'astro/tsconfigs/strict',
    }, null, 2),

    'src/content/config.ts': `import { defineCollection, z } from 'astro:content';

const blog = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    pubDate: z.coerce.date(),
    updatedDate: z.coerce.date().optional(),
    author: z.string().default('Admin'),
    categories: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    heroImage: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

const pages = defineCollection({
  type: 'content',
  schema: z.object({
    title: z.string(),
    description: z.string().optional().default(''),
    updatedDate: z.coerce.date().optional(),
    menuOrder: z.number().default(0),
    heroImage: z.string().optional(),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, pages };
`,

    'src/data/menu.json': `{
  "locations": {
    "primary": []
  }
}
`,

    'src/components/NavMenu.astro': `---
import NavMenu from './NavMenu.astro';

interface NavItem {
  label: string;
  href: string;
  target?: string;
  title?: string;
  children?: NavItem[];
}
interface Props {
  items: NavItem[];
  depth?: number;
}
const { items, depth = 0 } = Astro.props;
const listClass = depth === 0 ? 'nav-menu' : 'nav-submenu';
---

<ul class={listClass}>
  {items.map((item) => (
    <li class:list={{ 'nav-item': true, 'has-sub': !!(item.children && item.children.length) }}>
      <a href={item.href} {...(item.target ? { target: item.target } : {})} {...(item.title ? { title: item.title } : {})}>{item.label}</a>
      {item.children && item.children.length ? (
        <NavMenu items={item.children} depth={depth + 1} />
      ) : null}
    </li>
  ))}
</ul>
`,

    'src/layouts/BaseLayout.astro': `---
import { getCollection } from 'astro:content';
import menu from '../data/menu.json';
import NavMenu from '../components/NavMenu.astro';

interface Props {
  title: string;
  description?: string;
}

const { title, description = 'Astro site powered by WordPress Playground' } = Astro.props;

type NavItem = { label: string; href: string; children?: NavItem[] };

function pickPrimaryNav(loc: Record<string, NavItem[] | undefined> | undefined): NavItem[] {
  if (!loc || typeof loc !== 'object') return [];
  if (loc.primary?.length) return loc.primary;
  const first = Object.values(loc).find((v) => Array.isArray(v) && v.length) as NavItem[] | undefined;
  return first ?? [];
}

const menuData = menu as { locations?: Record<string, NavItem[]> };
const primaryItems = pickPrimaryNav(menuData.locations);
const useWpMenu = primaryItems.length > 0;

const sitePages = (await getCollection('pages', ({ data }) => !data.draft))
  .sort((a, b) => a.data.menuOrder - b.data.menuOrder);
---

<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <title>{title}</title>
  </head>
  <body>
    <header class="site-header">
      <div class="header-inner">
        <a href="/" class="site-title">My Site</a>
        <nav class="nav-links" aria-label="Main">
          {useWpMenu ? (
            <NavMenu items={primaryItems} />
          ) : (
            <>
              <a href="/">Home</a>
              <a href="/blog/">Blog</a>
              {sitePages.map((page) => (
                <a href={\`/\${page.id.replace(/\\.md$/, '')}/\`}>{page.data.title}</a>
              ))}
            </>
          )}
        </nav>
      </div>
    </header>
    <main class="site-main"><slot /></main>
    <footer class="site-footer">
      <div class="footer-inner">
        <span class="footer-brand">My Site</span>
        <span>Powered by <a href="https://astro.build">Astro</a></span>
      </div>
    </footer>
  </body>
</html>

<style is:global>
  *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }

  body {
    font-family: Georgia, 'Times New Roman', serif;
    color: #2d2d2d;
    line-height: 1.75;
    background-color: #faf9f7;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  h1, h2, h3, h4 {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    line-height: 1.3;
    color: #1a1a2e;
    margin-top: 2rem;
    margin-bottom: 0.75rem;
  }

  a { color: #5b6af0; text-decoration-color: transparent; transition: color 0.15s, text-decoration-color 0.15s; }
  a:hover { color: #3a4bdb; text-decoration-color: currentColor; }

  img { max-width: 100%; height: auto; }

  p { margin-bottom: 1.25rem; }

  /* Header */
  .site-header {
    background: linear-gradient(135deg, #1a1a2e 0%, #2d2b55 60%, #3d3580 100%);
    box-shadow: 0 2px 12px rgba(26, 26, 46, 0.18);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .header-inner {
    max-width: 860px;
    margin: 0 auto;
    padding: 0 2rem;
    height: 64px;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .site-title {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-weight: 700;
    font-size: 1.25rem;
    color: #fff;
    text-decoration: none;
    letter-spacing: -0.01em;
    transition: opacity 0.15s;
  }
  .site-title:hover { opacity: 0.85; color: #fff; text-decoration-color: transparent; }

  .nav-links { display: flex; gap: 0.25rem; align-items: center; }

  .nav-menu {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
    align-items: center;
    list-style: none;
    margin: 0;
    padding: 0;
  }

  .nav-item { position: relative; }

  .nav-submenu {
    display: none;
    position: absolute;
    top: 100%;
    left: 0;
    min-width: 12rem;
    flex-direction: column;
    gap: 0;
    margin: 0;
    padding: 0.5rem 0;
    list-style: none;
    background: rgba(26, 26, 46, 0.98);
    border-radius: 8px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
    z-index: 200;
  }

  .nav-item.has-sub:hover > .nav-submenu {
    display: flex;
  }

  .nav-links > a,
  .nav-menu .nav-item > a {
    text-decoration: none;
    color: rgba(255, 255, 255, 0.8);
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.9rem;
    font-weight: 500;
    padding: 0.4rem 0.85rem;
    border-radius: 6px;
    transition: background 0.15s, color 0.15s;
  }

  .nav-submenu .nav-item > a {
    font-size: 0.85rem;
    padding: 0.35rem 1rem;
    border-radius: 4px;
  }

  .nav-links > a:hover,
  .nav-menu .nav-item > a:hover {
    color: #fff;
    background: rgba(255, 255, 255, 0.12);
    text-decoration-color: transparent;
  }

  /* Main content */
  .site-main {
    max-width: 760px;
    width: 100%;
    margin: 0 auto;
    padding: 3rem 2rem 4rem;
    flex: 1;
  }

  /* Footer */
  .site-footer {
    background: #1a1a2e;
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.85rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }

  .footer-inner {
    max-width: 860px;
    margin: 0 auto;
    padding: 1.5rem 2rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .footer-brand {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.7);
    letter-spacing: -0.01em;
  }

  .site-footer a { color: rgba(255, 255, 255, 0.6); }
  .site-footer a:hover { color: #fff; }
</style>
`,

    'src/layouts/BlogPost.astro': `---
import BaseLayout from './BaseLayout.astro';

interface Props {
  title: string;
  description?: string;
  pubDate: Date;
  updatedDate?: Date;
  author?: string;
  categories?: string[];
  tags?: string[];
  heroImage?: string;
}

const { title, description, pubDate, updatedDate, author, categories = [], tags = [], heroImage } = Astro.props;
---

<BaseLayout title={title} description={description}>
  <article class="blog-post">
    {heroImage && <img src={heroImage} alt={title} class="hero-image" />}
    <header class="post-header">
      <h1 class="post-title">{title}</h1>
      <div class="post-meta">
        <time datetime={pubDate.toISOString()}>
          {pubDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
        </time>
        {author && <span class="post-author">by {author}</span>}
        {updatedDate && (
          <span class="post-updated">Updated {updatedDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
        )}
      </div>
      {description && <p class="post-description">{description}</p>}
    </header>
    <div class="post-content"><slot /></div>
  </article>
</BaseLayout>

<style is:global>
  .blog-post { max-width: 680px; }

  .hero-image {
    width: 100%;
    max-height: 420px;
    object-fit: cover;
    border-radius: 10px;
    margin-bottom: 2rem;
    box-shadow: 0 4px 20px rgba(0,0,0,0.12);
  }

  .post-header { margin-bottom: 2.5rem; padding-bottom: 1.5rem; border-bottom: 2px solid #ede9e0; }

  .post-title { font-size: 2.2rem; margin-top: 0; margin-bottom: 1rem; color: #1a1a2e; letter-spacing: -0.02em; }

  .post-meta {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem 1rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.88rem;
    color: #888;
  }

  .post-meta time { font-weight: 500; color: #666; }
  .post-author { color: #5b6af0; font-weight: 500; }
  .post-author::before { content: '·'; margin-right: 1rem; color: #ccc; }
  .post-updated { font-style: italic; }
  .post-updated::before { content: '·'; margin-right: 1rem; color: #ccc; }

  .post-description {
    margin-top: 1rem;
    margin-bottom: 0;
    font-size: 1.1rem;
    color: #666;
    font-style: italic;
    line-height: 1.6;
  }

  .post-content { font-size: 1.05rem; }
  .post-content h2 { font-size: 1.5rem; margin-top: 2.5rem; padding-bottom: 0.4rem; border-bottom: 1px solid #ede9e0; }
  .post-content h3 { font-size: 1.2rem; margin-top: 2rem; }
  .post-content blockquote { border-left: 3px solid #5b6af0; padding: 0.75rem 1.25rem; margin: 1.5rem 0; background: #f4f4ff; border-radius: 0 6px 6px 0; color: #555; font-style: italic; }
  .post-content pre { background: #1a1a2e; color: #e8e8f0; padding: 1.25rem 1.5rem; border-radius: 8px; overflow-x: auto; font-size: 0.9rem; margin: 1.5rem 0; }
  .post-content code { background: #ede9e0; padding: 0.15em 0.4em; border-radius: 4px; font-size: 0.88em; }
  .post-content pre code { background: none; padding: 0; font-size: inherit; }
</style>
`,

    'src/layouts/PageLayout.astro': `---
import BaseLayout from './BaseLayout.astro';

interface Props {
  title: string;
  description?: string;
  heroImage?: string;
}

const { title, description, heroImage } = Astro.props;
---

<BaseLayout title={title} description={description}>
  <article>
    {heroImage && <img src={heroImage} alt={title} style="width:100%;max-height:400px;object-fit:cover;border-radius:6px;margin-bottom:1.5rem;" />}
    <h1 style="margin-top:0;">{title}</h1>
    <div class="content"><slot /></div>
  </article>
</BaseLayout>
`,

    'src/pages/index.astro': `---
import BaseLayout from '../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog', ({ data }) => !data.draft))
  .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
  .slice(0, 5);
---

<BaseLayout title="Home">
  <section class="hero">
    <h1 class="hero-title">Welcome to My Site</h1>
    <p class="hero-subtitle">Thoughts, stories, and ideas — fresh from the editor.</p>
    <a href="/blog/" class="hero-cta">Read the Blog &rarr;</a>
  </section>

  <section class="recent-posts">
    <h2 class="section-heading">Recent Posts</h2>
    {posts.length > 0 ? (
      <div class="post-list">
        {posts.map((post) => (
          <a href={\`/blog/\${post.id.replace(/\\.md$/, '')}/\`} class="post-card">
            <h3 class="post-card-title">{post.data.title}</h3>
            {post.data.description && <p class="post-card-excerpt">{post.data.description}</p>}
            <span class="post-card-date">{post.data.pubDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</span>
          </a>
        ))}
      </div>
    ) : (
      <div class="empty-state">
        <p>No posts yet. Open the editor and create your first post!</p>
      </div>
    )}
  </section>
</BaseLayout>

<style>
  .hero {
    background: linear-gradient(135deg, #f0f0ff 0%, #faf0ff 100%);
    border: 1px solid #e4e0f8;
    border-radius: 16px;
    padding: 3.5rem 3rem;
    margin-bottom: 3.5rem;
    text-align: center;
  }

  .hero-title {
    font-size: 2.6rem;
    margin-top: 0;
    margin-bottom: 0.75rem;
    color: #1a1a2e;
    letter-spacing: -0.03em;
  }

  .hero-subtitle {
    font-size: 1.15rem;
    color: #666;
    margin-bottom: 1.75rem;
    font-style: italic;
  }

  .hero-cta {
    display: inline-block;
    background: #5b6af0;
    color: #fff;
    text-decoration: none;
    padding: 0.65rem 1.5rem;
    border-radius: 8px;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.95rem;
    font-weight: 600;
    transition: background 0.15s, transform 0.1s;
  }
  .hero-cta:hover { background: #3a4bdb; color: #fff; text-decoration-color: transparent; transform: translateY(-1px); }

  .section-heading {
    font-size: 1.1rem;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #999;
    margin-top: 0;
    margin-bottom: 1.25rem;
    font-weight: 600;
  }

  .post-list { display: flex; flex-direction: column; gap: 1rem; }

  .post-card {
    display: block;
    background: #fff;
    border: 1px solid #e8e4de;
    border-radius: 10px;
    padding: 1.4rem 1.6rem;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
  }
  .post-card:hover {
    border-color: #5b6af0;
    box-shadow: 0 4px 16px rgba(91, 106, 240, 0.1);
    transform: translateY(-2px);
    text-decoration-color: transparent;
    color: inherit;
  }

  .post-card-title {
    font-size: 1.15rem;
    margin-top: 0;
    margin-bottom: 0.4rem;
    color: #1a1a2e;
  }
  .post-card:hover .post-card-title { color: #5b6af0; }

  .post-card-excerpt {
    font-size: 0.92rem;
    color: #777;
    margin-bottom: 0.75rem;
    line-height: 1.55;
    font-style: italic;
  }

  .post-card-date {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.8rem;
    color: #aaa;
    font-weight: 500;
  }

  .empty-state {
    background: #fff;
    border: 2px dashed #ddd;
    border-radius: 10px;
    padding: 2.5rem;
    text-align: center;
    color: #999;
    font-style: italic;
  }
</style>
`,

    'src/pages/blog/index.astro': `---
import BaseLayout from '../../layouts/BaseLayout.astro';
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog', ({ data }) => !data.draft))
  .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
---

<BaseLayout title="Blog">
  <div class="blog-index-header">
    <h1 class="blog-index-title">Blog</h1>
    <p class="blog-index-count">{posts.length} {posts.length === 1 ? 'post' : 'posts'}</p>
  </div>

  {posts.length > 0 ? (
    <div class="blog-post-list">
      {posts.map((post) => (
        <a href={\`/blog/\${post.id.replace(/\\.md$/, '')}/\`} class="blog-card">
          <div class="blog-card-body">
            <h2 class="blog-card-title">{post.data.title}</h2>
            {post.data.description && <p class="blog-card-excerpt">{post.data.description}</p>}
          </div>
          <div class="blog-card-meta">
            <time class="blog-card-date">{post.data.pubDate.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</time>
            {post.data.author && <span class="blog-card-author">{post.data.author}</span>}
            <span class="blog-card-arrow">&rarr;</span>
          </div>
        </a>
      ))}
    </div>
  ) : (
    <div class="empty-state">
      <p>No posts yet. Open the editor and create your first post!</p>
    </div>
  )}
</BaseLayout>

<style>
  .blog-index-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 2rem;
    padding-bottom: 1rem;
    border-bottom: 2px solid #ede9e0;
  }

  .blog-index-title { font-size: 2rem; margin: 0; letter-spacing: -0.02em; color: #1a1a2e; }

  .blog-index-count {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.85rem;
    color: #aaa;
    font-weight: 500;
    margin: 0;
  }

  .blog-post-list { display: flex; flex-direction: column; gap: 1rem; }

  .blog-card {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    background: #fff;
    border: 1px solid #e8e4de;
    border-radius: 10px;
    padding: 1.5rem 1.75rem;
    text-decoration: none;
    color: inherit;
    transition: border-color 0.15s, box-shadow 0.15s, transform 0.1s;
  }
  .blog-card:hover {
    border-color: #5b6af0;
    box-shadow: 0 4px 18px rgba(91, 106, 240, 0.1);
    transform: translateY(-2px);
    text-decoration-color: transparent;
    color: inherit;
  }

  .blog-card-title {
    font-size: 1.2rem;
    margin: 0;
    color: #1a1a2e;
    transition: color 0.15s;
  }
  .blog-card:hover .blog-card-title { color: #5b6af0; }

  .blog-card-excerpt {
    font-size: 0.93rem;
    color: #777;
    margin: 0;
    line-height: 1.55;
    font-style: italic;
  }

  .blog-card-meta {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    font-size: 0.8rem;
    color: #aaa;
  }

  .blog-card-date { font-weight: 500; }

  .blog-card-author { color: #5b6af0; }
  .blog-card-author::before { content: '·'; margin-right: 0.75rem; color: #ddd; }

  .blog-card-arrow { margin-left: auto; font-size: 1rem; color: #ccc; transition: color 0.15s, transform 0.15s; }
  .blog-card:hover .blog-card-arrow { color: #5b6af0; transform: translateX(3px); }

  .empty-state {
    background: #fff;
    border: 2px dashed #ddd;
    border-radius: 10px;
    padding: 2.5rem;
    text-align: center;
    color: #999;
    font-style: italic;
  }
</style>
`,

    'src/pages/blog/[...slug].astro': `---
import { getCollection, render } from 'astro:content';
import BlogPost from '../../layouts/BlogPost.astro';

export async function getStaticPaths() {
  const posts = await getCollection('blog');
  return posts.map((post) => ({
    params: { slug: post.id.replace(/\\.md$/, '') },
    props: post,
  }));
}

const post = Astro.props;
const { Content } = await render(post);
---

<BlogPost
  title={post.data.title}
  description={post.data.description}
  pubDate={post.data.pubDate}
  updatedDate={post.data.updatedDate}
  author={post.data.author}
  categories={post.data.categories}
  tags={post.data.tags}
  heroImage={post.data.heroImage}
>
  <Content />
</BlogPost>
`,

    'src/pages/[...slug].astro': `---
import { getCollection, render } from 'astro:content';
import PageLayout from '../layouts/PageLayout.astro';

export async function getStaticPaths() {
  const pages = await getCollection('pages');
  return pages.map((page) => ({
    params: { slug: page.id.replace(/\\.md$/, '') },
    props: page,
  }));
}

const page = Astro.props;
const { Content } = await render(page);
---

<PageLayout
  title={page.data.title}
  description={page.data.description}
  heroImage={page.data.heroImage}
>
  <Content />
</PageLayout>
`,

    // Placeholder content so Astro doesn't complain about empty collections
    'src/content/blog/.gitkeep': '',
    'src/content/pages/.gitkeep': '',
    'public/assets/images/.gitkeep': '',

    // GitHub Actions: auto-deploy to Cloudflare Pages on push to main
    '.github/workflows/deploy.yml': `name: Deploy to Cloudflare Pages

on:
  push:
    branches: [main]

jobs:
  deploy:
    runs-on: ubuntu-latest
    permissions:
      contents: read
      deployments: write
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm install
      - run: npm run build

      - name: Create CF Pages project if needed
        run: |
          curl -s -X POST "https://api.cloudflare.com/client/v4/accounts/\${{ secrets.CLOUDFLARE_ACCOUNT_ID }}/pages/projects" \\
            -H "Authorization: Bearer \${{ secrets.CLOUDFLARE_API_TOKEN }}" \\
            -H "Content-Type: application/json" \\
            -d '{"name":"\${{ github.event.repository.name }}","production_branch":"main"}' \\
            || true

      - name: Deploy to Cloudflare Pages
        id: deploy
        uses: cloudflare/wrangler-action@v3
        with:
          apiToken: \${{ secrets.CLOUDFLARE_API_TOKEN }}
          accountId: \${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
          command: pages deploy dist --project-name=\${{ github.event.repository.name }}

      - name: Save site URL as deployment
        env:
          GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
          DEPLOY_URL: \${{ steps.deploy.outputs.deployment-url }}
        run: |
          # Extract production URL from per-commit URL (e.g. abc123.my-site.pages.dev -> my-site.pages.dev)
          SITE_URL=\$(echo "\$DEPLOY_URL" | sed 's|https://[a-f0-9]*\\.||')
          if [ -z "\$SITE_URL" ]; then exit 0; fi
          SITE_URL="https://\$SITE_URL"
          echo "Site URL: \$SITE_URL"

          DEPLOY_ID=\$(curl -sf -X POST "https://api.github.com/repos/\${{ github.repository }}/deployments" \\
            -H "Authorization: token \$GITHUB_TOKEN" \\
            -H "Accept: application/vnd.github+json" \\
            -d "{\"ref\":\"main\",\"environment\":\"production\",\"auto_merge\":false,\"required_contexts\":[]}" \\
            | grep -o '"id":[0-9]*' | head -1 | cut -d: -f2)
          if [ -n "\$DEPLOY_ID" ]; then
            curl -sf -X POST "https://api.github.com/repos/\${{ github.repository }}/deployments/\$DEPLOY_ID/statuses" \\
              -H "Authorization: token \$GITHUB_TOKEN" \\
              -H "Accept: application/vnd.github+json" \\
              -d "{\"state\":\"success\",\"environment_url\":\"\$SITE_URL\",\"environment\":\"production\"}"
          fi
`,
  };
}
