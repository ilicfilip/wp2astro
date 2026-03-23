/**
 * Astro WP — Browser CMS
 *
 * Main application entry point.
 * Connects GitHub, boots WP Playground, and handles the publish → commit flow.
 */
import { startPlaygroundWeb } from '@wp-playground/client';
import * as github from './github.js';
import { getPluginFiles } from './plugin.js';
import { getTemplateFiles } from './template.js';
import {
  markdownConverter,
  frontmatterBuilder,
  imageHandler,
  postExporter,
  mdToBlocks,
  mdImporter,
} from 'virtual:php-classes';

// ─── Auth gate ────────────────────────────────────────────────
const AUTH_HASH = import.meta.env.VITE_AUTH_HASH || '';

async function sha256(text) {
  const data = new TextEncoder().encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── State ────────────────────────────────────────────────────
let selectedRepo = null; // { owner, name, full_name }
let playgroundClient = null;
let contentManifest = {}; // path → hash (what's in GitHub)
let cfPagesUrl = null; // actual Cloudflare Pages URL (e.g. https://my-site-abc.pages.dev)

// ─── DOM refs ─────────────────────────────────────────────────
const $ = (sel) => document.querySelector(sel);

const authScreen    = $('#auth-screen');
const authPassword  = $('#auth-password');
const authSubmit    = $('#auth-submit');
const authStatus    = $('#auth-status');
const setupScreen   = $('#setup-screen');
const editorScreen  = $('#editor-screen');
const patInput      = $('#pat-input');
const patConnect    = $('#pat-connect');
const patStatus     = $('#pat-status');
const repoSection   = $('#repo-section');
const repoSelect    = $('#repo-select');
const newRepoName   = $('#new-repo-name');
const createRepoBtn = $('#create-repo');
const cfSection     = $('#cf-section');
const cfAccountId   = $('#cf-account-id');
const cfApiToken    = $('#cf-api-token');
const cfSave        = $('#cf-save');
const cfStatus      = $('#cf-status');
const cfSkip        = $('#cf-skip');
const launchSection = $('#launch-section');
const repoInfo      = $('#repo-info');
const launchBtn     = $('#launch-btn');
const editorRepo    = $('#editor-repo-name');
const syncStatus    = $('#sync-status');
const syncBtn       = $('#sync-btn');
const backBtn       = $('#back-btn');
const loadingOverlay = $('#loading-overlay');
const loadingMessage = $('#loading-message');
const wpIframe       = $('#wp-playground');
const resetSession   = $('#reset-session');

// ─── Renumber visible steps ──────────────────────────────────
function renumberSteps() {
  const sections = document.querySelectorAll('.setup-steps .setup-section');
  let num = 1;
  sections.forEach(section => {
    const badge = section.querySelector('.step-num');
    if (badge) {
      if (section.style.display === 'none') {
        badge.textContent = '';
      } else {
        badge.textContent = num++;
      }
    }
  });
}

// ─── Setup: PAT Connect ───────────────────────────────────────
patInput.addEventListener('input', () => {
  patConnect.disabled = patInput.value.trim().length < 10;
});

patConnect.addEventListener('click', async () => {
  const token = patInput.value.trim();
  patStatus.textContent = 'Connecting...';
  patStatus.className = 'status working';
  patConnect.disabled = true;

  try {
    const user = await github.connect(token);
    patStatus.textContent = `Connected as ${user.login}`;
    patStatus.className = 'status success';

    // Save token for session
    sessionStorage.setItem('gh_token', token);

    // Show repo section
    repoSection.style.display = '';
    renumberSteps();
    await loadRepos();
  } catch (e) {
    patStatus.textContent = `Error: ${e.message}`;
    patStatus.className = 'status error';
    patConnect.disabled = false;
  }
});

// ─── Setup: Repo Selection ────────────────────────────────────
async function loadRepos() {
  repoSelect.innerHTML = '<option value="">Loading...</option>';
  try {
    const repos = await github.listRepos();
    repoSelect.innerHTML = '<option value="">— Select a repository —</option>';
    for (const repo of repos) {
      const opt = document.createElement('option');
      opt.value = JSON.stringify(repo);
      opt.textContent = repo.full_name;
      repoSelect.appendChild(opt);
    }
  } catch (e) {
    repoSelect.innerHTML = `<option value="">Error loading repos</option>`;
  }
}

repoSelect.addEventListener('change', () => {
  if (repoSelect.value) {
    selectedRepo = JSON.parse(repoSelect.value);
    showLaunchSection();
  }
});

createRepoBtn.addEventListener('click', async () => {
  // Sanitize: lowercase, replace spaces/underscores with dashes,
  // strip non-alphanumeric (except dashes), collapse multiple dashes,
  // remove leading/trailing dashes
  const name = newRepoName.value.trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^a-z0-9\-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+|-+$/g, '');
  if (!name) return;

  createRepoBtn.disabled = true;
  createRepoBtn.textContent = 'Creating...';

  try {
    selectedRepo = await github.createRepo(name);
    showLaunchSection();
  } catch (e) {
    alert(`Failed to create repo: ${e.message}`);
  } finally {
    createRepoBtn.disabled = false;
    createRepoBtn.textContent = 'Create New';
  }
});

function showLaunchSection() {
  // Skip CF step if already configured for this repo
  const cfDone = sessionStorage.getItem('cf_configured');
  if (cfDone === selectedRepo.full_name) {
    cfSection.style.display = 'none';
    showLaunchButton();
  } else {
    cfSection.style.display = '';
  }
  repoInfo.textContent = `Repository: ${selectedRepo.full_name}`;
  renumberSteps();
}

function showLaunchButton() {
  launchSection.style.display = '';
  repoInfo.textContent = `Repository: ${selectedRepo.full_name}`;
  renumberSteps();
}

// ─── Setup: Cloudflare Deploy (optional) ─────────────────────
cfSave.addEventListener('click', async () => {
  const accountId = cfAccountId.value.trim();
  const apiToken = cfApiToken.value.trim();

  if (!accountId || !apiToken) {
    cfStatus.textContent = 'Both fields are required';
    cfStatus.className = 'status error';
    return;
  }

  cfSave.disabled = true;
  cfStatus.textContent = 'Saving secrets...';
  cfStatus.className = 'status working';

  try {
    await github.setRepoSecret(selectedRepo.owner, selectedRepo.name, 'CLOUDFLARE_ACCOUNT_ID', accountId);
    await github.setRepoSecret(selectedRepo.owner, selectedRepo.name, 'CLOUDFLARE_API_TOKEN', apiToken);

    // Push the deploy workflow to the repo.
    // Requires PAT 'workflow' scope — if it fails we still save the secrets.
    try {
      const templateFiles = getTemplateFiles();
      const workflowFiles = {};
      for (const [path, content] of Object.entries(templateFiles)) {
        if (path.startsWith('.github/') && content !== '') {
          workflowFiles[path] = content;
        }
      }
      if (Object.keys(workflowFiles).length > 0) {
        await github.commitFiles(selectedRepo.owner, selectedRepo.name, 'main', workflowFiles, 'Add deploy workflow');
      }
    } catch (e) {
      console.warn('Could not push deploy workflow (needs PAT workflow scope):', e.message);
    }

    // Try to get existing deployment URL (only works if site was deployed before)
    const deployUrl = await github.getDeploymentUrl(selectedRepo.owner, selectedRepo.name);
    if (deployUrl) {
      cfPagesUrl = deployUrl;
      sessionStorage.setItem('cf_pages_url', cfPagesUrl);
    }

    cfStatus.textContent = 'Deploy keys saved! Site will auto-deploy on sync.';
    cfStatus.className = 'status success';
    // Remember that CF is configured for this repo
    sessionStorage.setItem('cf_configured', selectedRepo.full_name);
    showLaunchButton();
  } catch (e) {
    cfStatus.textContent = `Error: ${e.message}`;
    cfStatus.className = 'status error';
  } finally {
    cfSave.disabled = false;
  }
});

cfSkip.addEventListener('click', (e) => {
  e.preventDefault();
  showLaunchButton();
});

// ─── Launch Editor ────────────────────────────────────────────
launchBtn.addEventListener('click', async () => {
  setupScreen.style.display = 'none';
  editorScreen.style.display = '';
  editorRepo.textContent = selectedRepo.full_name;

  await bootEditor();
});

async function bootEditor() {
  setLoading('Fetching content from GitHub...');

  // 1. Fetch existing content from the repo
  let existingContent;
  try {
    existingContent = await github.fetchContent(selectedRepo.owner, selectedRepo.name);
  } catch (e) {
    existingContent = { posts: [], pages: [], images: [] };
  }

  // Seed the content manifest from repo so deletions can be detected on first sync
  for (const post of existingContent.posts) {
    contentManifest[`src/content/blog/${post.name}`] = post.sha;
  }
  for (const page of existingContent.pages) {
    contentManifest[`src/content/pages/${page.name}`] = page.sha;
  }
  for (const img of existingContent.images) {
    contentManifest[`public/assets/images/${img.name}`] = img.sha;
  }
  contentManifest._templatePushed = true; // repo already has templates if content exists

  // 2. Build blueprint with plugin files + existing content
  setLoading('Starting WordPress Playground...');

  const pluginFiles = getPluginFiles();
  const steps = [];

  // Create directories first (writeFile doesn't auto-create parents)
  const dirs = [
    '/wordpress/wp-content/plugins/wp-astro-exporter/includes',
    '/wordpress/wp-content/astro-content/blog',
    '/wordpress/wp-content/astro-content/pages',
    '/wordpress/wp-content/astro-images',
  ];
  for (const path of dirs) {
    steps.push({ step: 'mkdir', path });
  }

  // Write plugin files
  for (const [path, content] of Object.entries(pluginFiles)) {
    steps.push({ step: 'writeFile', path, data: content });
  }

  // Write the reusable PHP classes from the CLI plugin
  // (inlined at build time via Vite plugin)
  steps.push(...getCorePHPSteps());

  // Write existing content files into the virtual FS
  for (const post of existingContent.posts) {
    steps.push({
      step: 'writeFile',
      path: `/wordpress/wp-content/astro-content/blog/${post.name}`,
      data: post.content,
    });
  }
  for (const page of existingContent.pages) {
    steps.push({
      step: 'writeFile',
      path: `/wordpress/wp-content/astro-content/pages/${page.name}`,
      data: page.content,
    });
  }
  // Write images into the virtual FS so the importer can find them
  for (const img of existingContent.images) {
    if (img.base64) {
      steps.push({
        step: 'runPHP',
        code: `<?php
          $data = base64_decode('${img.base64}');
          file_put_contents('/wordpress/wp-content/astro-images/${img.name}', $data);
        ?>`,
      });
    }
  }

  // Activate plugin and configure WP
  steps.push(
    { step: 'activatePlugin', pluginPath: 'wp-astro-exporter/wp-astro-exporter.php' },
    { step: 'login', username: 'admin', password: 'password' },
    {
      step: 'runPHP',
      code: `<?php
        require_once '/wordpress/wp-load.php';
        update_option('blogname', 'My Site');
        update_option('permalink_structure', '/%postname%/');
        flush_rewrite_rules();
      ?>`
    }
  );

  // Also write the importer classes so existing MD gets imported into WP
  steps.push({
    step: 'runPHP',
    code: `<?php
      require_once '/wordpress/wp-load.php';
      // Trigger import of existing content
      if ( class_exists( 'Astro_MD_Importer' ) ) {
        $importer = new Astro_MD_Importer();
        $importer->maybe_import();
      }
    ?>`
  });

  // 3. Boot WP Playground
  try {
    playgroundClient = await startPlaygroundWeb({
      iframe: wpIframe,
      remoteUrl: 'https://playground.wordpress.net/remote.html',
      blueprint: {
        preferredVersions: { php: '8.0', wp: 'latest' },
        landingPage: '/wp-admin/edit.php',
        steps,
      },
    });

    await playgroundClient.isReady();

    setLoading(null); // Hide overlay
    wpIframe.style.display = '';

  } catch (e) {
    setLoading(`Error: ${e.message}`);
  }
}

/**
 * Returns Blueprint steps that write the core PHP classes
 * (inlined at build time from the CLI plugin via Vite plugin).
 */
function getCorePHPSteps() {
  const pluginDir = '/wordpress/wp-content/plugins/wp-astro-exporter';

  return [
    {
      step: 'writeFile',
      path: `${pluginDir}/includes/class-markdown-converter.php`,
      data: markdownConverter,
    },
    {
      step: 'writeFile',
      path: `${pluginDir}/includes/class-frontmatter-builder.php`,
      data: frontmatterBuilder,
    },
    {
      step: 'writeFile',
      path: `${pluginDir}/includes/class-image-handler.php`,
      data: imageHandler,
    },
    {
      step: 'writeFile',
      path: `${pluginDir}/includes/class-post-exporter.php`,
      data: postExporter,
    },
    {
      step: 'writeFile',
      path: `${pluginDir}/includes/class-md-to-blocks.php`,
      data: mdToBlocks,
    },
    {
      step: 'writeFile',
      path: `${pluginDir}/includes/class-md-importer.php`,
      data: mdImporter,
    },
  ];
}

// ─── Sync: Commit to GitHub ───────────────────────────────────
syncBtn.addEventListener('click', async () => {
  await syncToGitHub();
});

async function syncToGitHub() {
  if (!playgroundClient || !selectedRepo) return;

  syncStatus.textContent = 'Syncing...';
  syncStatus.className = 'status working';
  syncBtn.disabled = true;

  try {
    // 1. Fetch current content from WP via REST API
    //    Use playgroundClient.request() to avoid CORS — it routes
    //    through the iframe's service worker, not a cross-origin fetch.
    const [postsRes, pagesRes, imagesRes] = await Promise.all([
      playgroundClient.request({ url: '/wp-json/astro-export/v1/posts', method: 'GET' }),
      playgroundClient.request({ url: '/wp-json/astro-export/v1/pages', method: 'GET' }),
      playgroundClient.request({ url: '/wp-json/astro-export/v1/images', method: 'GET' }),
    ]);

    const posts  = JSON.parse(postsRes.text);
    const pages  = JSON.parse(pagesRes.text);
    const images = JSON.parse(imagesRes.text);

    // 2. Ensure template/scaffold files exist in the repo.
    //    On first sync (or if initial commit failed), push them.
    const files = {};
    let changeCount = 0;

    if (!contentManifest._templatePushed) {
      const templateFiles = getTemplateFiles();
      for (const [path, content] of Object.entries(templateFiles)) {
        // Skip empty .gitkeep files and the deploy workflow
        // (workflow requires PAT 'workflow' scope — pushed separately via CF setup)
        if (content !== '' && !path.startsWith('.github/')) {
          files[path] = content;
          changeCount++;
        }
      }
      // NOTE: flag is set AFTER commit succeeds (see below)
    }

    for (const post of posts) {
      const path = `src/content/blog/${post.filename}`;
      if (contentManifest[path] !== post.hash) {
        files[path] = post.markdown;
        changeCount++;
      }
    }

    for (const page of pages) {
      const path = `src/content/pages/${page.filename}`;
      if (contentManifest[path] !== page.hash) {
        files[path] = page.markdown;
        changeCount++;
      }
    }

    for (const img of images) {
      if (contentManifest[img.path] !== img.hash) {
        files[img.path] = `base64:${img.base64}`;
        changeCount++;
      }
    }

    // 2b. Detect deleted content (in manifest but no longer in WP)
    const deletePaths = [];
    const currentPosts = new Set(posts.map(p => `src/content/blog/${p.filename}`));
    const currentPages = new Set(pages.map(p => `src/content/pages/${p.filename}`));
    const currentImages = new Set(images.map(i => i.path));

    for (const path of Object.keys(contentManifest)) {
      if (path.startsWith('_')) continue; // skip internal flags like _templatePushed
      if (path.startsWith('src/content/blog/') && !currentPosts.has(path)) {
        deletePaths.push(path);
        changeCount++;
      } else if (path.startsWith('src/content/pages/') && !currentPages.has(path)) {
        deletePaths.push(path);
        changeCount++;
      } else if (path.startsWith('public/assets/images/') && !currentImages.has(path)) {
        deletePaths.push(path);
        changeCount++;
      }
    }

    if (deletePaths.length > 0) {
      console.log('[sync] deleting', deletePaths.length, 'files:', deletePaths);
    }

    if (changeCount === 0) {
      syncStatus.textContent = 'No changes to sync';
      syncStatus.className = 'status success';
      syncBtn.disabled = false;
      return;
    }

    // 3. Commit to GitHub (additions + deletions)
    await github.commitFiles(
      selectedRepo.owner,
      selectedRepo.name,
      'main',
      files,
      `Content update: ${new Date().toISOString()}`,
      deletePaths
    );

    // 4. Mark template as pushed (only after commit succeeds)
    contentManifest._templatePushed = true;

    // 5. Update local manifest
    for (const post of posts) {
      contentManifest[`src/content/blog/${post.filename}`] = post.hash;
    }
    for (const page of pages) {
      contentManifest[`src/content/pages/${page.filename}`] = page.hash;
    }
    for (const img of images) {
      contentManifest[img.path] = img.hash;
    }
    // Remove deleted paths from manifest
    for (const path of deletePaths) {
      delete contentManifest[path];
    }

    // Always try to get the real deployment URL from GitHub Deployments
    const deployUrl = await github.getDeploymentUrl(selectedRepo.owner, selectedRepo.name);
    if (deployUrl) {
      cfPagesUrl = deployUrl;
      sessionStorage.setItem('cf_pages_url', cfPagesUrl);
    }

    if (cfPagesUrl) {
      syncStatus.innerHTML = `Synced ${changeCount} file${changeCount > 1 ? 's' : ''} &mdash; <a href="${cfPagesUrl}" target="_blank" style="color:inherit;text-decoration:underline;">${cfPagesUrl}</a>`;
    } else {
      syncStatus.textContent = `Synced ${changeCount} file${changeCount > 1 ? 's' : ''}. Deploy will start shortly.`;
    }
    syncStatus.className = 'status success';

  } catch (e) {
    syncStatus.textContent = `Error: ${e.message}`;
    syncStatus.className = 'status error';
  } finally {
    syncBtn.disabled = false;
  }
}

// ─── Back button ──────────────────────────────────────────────
backBtn.addEventListener('click', () => {
  editorScreen.style.display = 'none';
  setupScreen.style.display = '';
  // Clean up playground
  if (playgroundClient) {
    wpIframe.src = '';
    playgroundClient = null;
  }
});

// ─── Loading helper ───────────────────────────────────────────
function setLoading(message) {
  if (message) {
    loadingOverlay.style.display = '';
    loadingMessage.textContent = message;
    wpIframe.style.display = 'none';
  } else {
    loadingOverlay.style.display = 'none';
  }
}

// ─── Reset session ───────────────────────────────────────────
resetSession.addEventListener('click', (e) => {
  e.preventDefault();
  sessionStorage.clear();
  localStorage.removeItem('wp2astro_auth');
  location.reload();
});

// ─── Auth gate ───────────────────────────────────────────────
authSubmit.addEventListener('click', async () => {
  const hash = await sha256(authPassword.value);
  if (hash === AUTH_HASH) {
    localStorage.setItem('wp2astro_auth', '1');
    authScreen.style.display = 'none';
    setupScreen.style.display = '';
    initApp();
  } else {
    authStatus.textContent = 'Wrong password';
    authStatus.className = 'status error';
  }
});

authPassword.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') authSubmit.click();
});

// ─── Init app (after auth) ───────────────────────────────────
function initApp() {
  const savedToken = sessionStorage.getItem('gh_token');
  cfPagesUrl = sessionStorage.getItem('cf_pages_url') || null;
  if (savedToken) {
    patInput.value = savedToken;
    patConnect.disabled = false;
    patConnect.click();
  }
  renumberSteps();
}

// ─── Restore session ──────────────────────────────────────────
(async () => {
  if (!AUTH_HASH || localStorage.getItem('wp2astro_auth') === '1') {
    // No auth configured or already authenticated
    setupScreen.style.display = '';
    initApp();
  } else {
    // Show auth screen
    authScreen.style.display = '';
  }
})();
