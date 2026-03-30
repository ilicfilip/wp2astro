/**
 * GitHub API wrapper using Octokit.
 *
 * Handles authentication, repo operations, and file commits.
 * Uses the Git Trees API for multi-file commits.
 */
import { Octokit } from 'octokit';
import nacl from 'tweetnacl';
import { decodeBase64, encodeBase64, decodeUTF8 } from 'tweetnacl-util';
import { blake2b } from 'blakejs';

let octokit = null;
let currentUser = null;

/**
 * Initialize Octokit with a Personal Access Token.
 * @param {string} token GitHub PAT with `repo` scope.
 * @returns {Promise<{login: string, name: string}>} Authenticated user info.
 */
export async function connect(token) {
  octokit = new Octokit({ auth: token });
  const { data } = await octokit.rest.users.getAuthenticated();
  currentUser = { login: data.login, name: data.name || data.login };
  return currentUser;
}

/**
 * List repos the authenticated user can push to.
 * @returns {Promise<Array<{full_name: string, name: string, owner: string}>>}
 */
export async function listRepos() {
  const repos = [];
  for await (const response of octokit.paginate.iterator(
    octokit.rest.repos.listForAuthenticatedUser,
    { sort: 'updated', per_page: 50 }
  )) {
    for (const repo of response.data) {
      if (repo.permissions?.push) {
        repos.push({
          full_name: repo.full_name,
          name: repo.name,
          owner: repo.owner.login,
        });
      }
    }
    // Stop after 100 repos to keep it snappy
    if (repos.length >= 100) break;
  }
  return repos;
}

/**
 * Create a new repo from scratch with the Astro template files.
 * @param {string} name Repo name.
 * @param {Object} templateFiles Object of { path: content } to commit.
 * @returns {Promise<{full_name: string, name: string, owner: string}>}
 */
export async function createRepo(name) {
  // Create repo with auto_init. Template files are pushed on first sync
  // (avoids race conditions with GitHub's git object propagation).
  const { data: repo } = await octokit.rest.repos.createForAuthenticatedUser({
    name,
    description: 'Astro site powered by WordPress Playground',
    auto_init: true,
    private: false,
  });

  return {
    full_name: repo.full_name,
    name: repo.name,
    owner: repo.owner.login,
  };
}

/**
 * Fetch content files from a repo (blog posts, pages, images).
 * @param {string} owner Repo owner.
 * @param {string} repo Repo name.
 * @returns {Promise<{posts: Object[], pages: Object[], images: Object[], menu: Object|null}>}
 */
export async function fetchContent(owner, repo) {
  const result = { posts: [], pages: [], images: [], menu: null };

  // Fetch blog posts
  try {
    const { data: blogFiles } = await octokit.rest.repos.getContent({
      owner, repo, path: 'src/content/blog',
    });
    for (const file of blogFiles) {
      if (file.name.endsWith('.md')) {
        const { data } = await octokit.rest.repos.getContent({
          owner, repo, path: file.path, mediaType: { format: 'raw' },
        });
        result.posts.push({ name: file.name, content: data, sha: file.sha });
      }
    }
  } catch (e) {
    if (e.status !== 404) throw e;
    // Directory doesn't exist yet — that's fine
  }

  // Fetch pages
  try {
    const { data: pageFiles } = await octokit.rest.repos.getContent({
      owner, repo, path: 'src/content/pages',
    });
    for (const file of pageFiles) {
      if (file.name.endsWith('.md')) {
        const { data } = await octokit.rest.repos.getContent({
          owner, repo, path: file.path, mediaType: { format: 'raw' },
        });
        result.pages.push({ name: file.name, content: data, sha: file.sha });
      }
    }
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  // Fetch images with binary content (base64)
  try {
    const { data: imgFiles } = await octokit.rest.repos.getContent({
      owner, repo, path: 'public/assets/images',
    });
    for (const file of imgFiles) {
      if (file.type !== 'file' || file.name === '.gitkeep') continue;
      // Fetch individual file to get base64 content
      const { data: imgData } = await octokit.rest.repos.getContent({
        owner, repo, path: file.path,
      });
      result.images.push({
        name: file.name,
        sha: file.sha,
        base64: imgData.content.replace(/\n/g, ''), // GitHub returns base64 with newlines
      });
    }
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  try {
    const { data } = await octokit.rest.repos.getContent({
      owner, repo, path: 'src/data/menu.json',
    });
    if (data.type === 'file' && data.content) {
      const binary = atob(data.content.replace(/\n/g, ''));
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const text = new TextDecoder().decode(bytes);
      result.menu = { content: text, sha: data.sha };
    }
  } catch (e) {
    if (e.status !== 404) throw e;
  }

  return result;
}

/**
 * Commit multiple files to a repo in a single commit.
 *
 * Uses the Git Trees API to batch everything into one commit.
 *
 * @param {string} owner Repo owner.
 * @param {string} repo Repo name.
 * @param {string} branch Branch name (e.g. 'main').
 * @param {Object} files Object of { 'path/to/file': content }.
 *   String content for text files, base64 string prefixed with 'base64:' for binary.
 * @param {string} message Commit message.
 */
/**
 * Set a GitHub Actions secret on a repository.
 *
 * GitHub requires secrets to be encrypted with the repo's public key
 * using libsodium sealed box encryption before being set via the API.
 *
 * @param {string} owner Repo owner.
 * @param {string} repo Repo name.
 * @param {string} secretName Secret name (e.g. 'CLOUDFLARE_API_TOKEN').
 * @param {string} secretValue Plain-text secret value.
 */
export async function setRepoSecret(owner, repo, secretName, secretValue) {
  // 1. Get the repo's public key for encrypting secrets
  const { data: publicKey } = await octokit.rest.actions.getRepoPublicKey({
    owner, repo,
  });

  // 2. Encrypt the secret using NaCl sealed box (tweetnacl + blakejs)
  //    Sealed box: ephemeral keypair → blake2b nonce → crypto_box → prepend ephemeral pk
  const recipientPk = decodeBase64(publicKey.key);
  const ephemeral = nacl.box.keyPair();

  // Nonce = blake2b(ephemeral_pk || recipient_pk, outputLength=24)
  const nonceInput = new Uint8Array(64);
  nonceInput.set(ephemeral.publicKey, 0);
  nonceInput.set(recipientPk, 32);
  const nonce = blake2b(nonceInput, null, 24);

  const messageBytes = decodeUTF8(secretValue);
  const encrypted = nacl.box(messageBytes, nonce, recipientPk, ephemeral.secretKey);

  // Sealed box output = ephemeral_pk (32 bytes) + encrypted
  const sealedBox = new Uint8Array(32 + encrypted.length);
  sealedBox.set(ephemeral.publicKey, 0);
  sealedBox.set(encrypted, 32);
  const encryptedBase64 = encodeBase64(sealedBox);

  // 3. Set the secret
  await octokit.rest.actions.createOrUpdateRepoSecret({
    owner, repo,
    secret_name: secretName,
    encrypted_value: encryptedBase64,
    key_id: publicKey.key_id,
  });
}

export async function commitFiles(owner, repo, branch, files, message, deletePaths = []) {
  console.log('[commitFiles] owner:', owner, 'repo:', repo, 'branch:', branch, 'files:', Object.keys(files).length, 'deletions:', deletePaths.length);

  // Get current branch HEAD OID via GraphQL (REST can return stale data)
  const { repository } = await octokit.graphql(`
    query($owner: String!, $repo: String!, $branch: String!) {
      repository(owner: $owner, name: $repo) {
        ref(qualifiedName: $branch) {
          target { oid }
        }
      }
    }
  `, { owner, repo, branch: `refs/heads/${branch}` });
  const headOid = repository.ref.target.oid;
  console.log('[commitFiles] headOid:', headOid);

  // Build file additions for GraphQL createCommitOnBranch mutation.
  const additions = [];
  for (const [path, content] of Object.entries(files)) {
    if (typeof content === 'string' && content.startsWith('base64:')) {
      additions.push({ path, contents: content.slice(7) });
    } else {
      additions.push({ path, contents: btoa(unescape(encodeURIComponent(content))) });
    }
  }

  // Build deletions
  const deletions = deletePaths.map(path => ({ path }));

  console.log('[commitFiles] committing', additions.length, 'additions,', deletions.length, 'deletions via GraphQL');

  const fileChanges = {};
  if (additions.length > 0) fileChanges.additions = additions;
  if (deletions.length > 0) fileChanges.deletions = deletions;

  const result = await octokit.graphql(`
    mutation($input: CreateCommitOnBranchInput!) {
      createCommitOnBranch(input: $input) {
        commit { oid }
      }
    }
  `, {
    input: {
      branch: {
        repositoryNameWithOwner: `${owner}/${repo}`,
        branchName: branch,
      },
      expectedHeadOid: headOid,
      message: { headline: message },
      fileChanges,
    },
  });

  const newOid = result.createCommitOnBranch.commit.oid;
  console.log('[commitFiles] committed:', newOid);
  return newOid;
}

/**
 * Get the production deployment URL from GitHub Deployments.
 * The wrangler-action creates a deployment with the CF Pages URL.
 */
export async function getDeploymentUrl(owner, repo) {
  try {
    // List recent deployments (wrangler-action may use various environment names)
    const { data: deployments } = await octokit.rest.repos.listDeployments({
      owner, repo, per_page: 10,
    });

    // Find the first deployment that has a pages.dev URL in its status
    for (const deployment of deployments) {
      const { data: statuses } = await octokit.rest.repos.listDeploymentStatuses({
        owner, repo, deployment_id: deployment.id, per_page: 1,
      });
      if (statuses.length > 0 && statuses[0].environment_url) {
        const url = statuses[0].environment_url;
        // Return the production URL (strip per-commit hash prefix)
        const match = url.match(/https?:\/\/[a-f0-9]+\.(.+\.pages\.dev)/);
        if (match) {
          return `https://${match[1]}`;
        }
        // Already a clean production URL
        if (url.includes('.pages.dev')) {
          return url;
        }
      }
    }
  } catch (e) {
    console.warn('Could not fetch deployment URL:', e.message);
  }
  return null;
}

/**
 * Poll GitHub Deployments until one created after `afterTimestamp` reaches
 * a terminal state (success/failure/error). Calls `onStatus(state, url)`
 * on each poll. Returns the final { state, url }.
 *
 * @param {string} owner
 * @param {string} repo
 * @param {number} afterTimestamp - Only consider deployments created after this (ms since epoch)
 * @param {function} onStatus - Callback: (state: string, url: string|null) => void
 * @param {object} [opts]
 * @param {number} [opts.interval=8000] - Poll interval in ms
 * @param {number} [opts.timeout=300000] - Give up after this many ms (default 5 min)
 */
export async function waitForDeploy(owner, repo, afterTimestamp, onStatus, opts = {}) {
  const interval = opts.interval || 8000;
  const timeout = opts.timeout || 300000;
  const start = Date.now();

  while (Date.now() - start < timeout) {
    try {
      const { data: deployments } = await octokit.rest.repos.listDeployments({
        owner, repo, per_page: 5,
      });

      for (const dep of deployments) {
        // Only look at deployments created after our commit
        if (new Date(dep.created_at).getTime() < afterTimestamp) continue;

        const { data: statuses } = await octokit.rest.repos.listDeploymentStatuses({
          owner, repo, deployment_id: dep.id, per_page: 1,
        });

        if (statuses.length === 0) continue;

        const status = statuses[0];
        let url = null;
        if (status.environment_url) {
          const match = status.environment_url.match(/https?:\/\/[a-f0-9]+\.(.+\.pages\.dev)/);
          url = match ? `https://${match[1]}` : status.environment_url;
        }

        if (status.state === 'success') {
          onStatus('success', url);
          return { state: 'success', url };
        }
        if (status.state === 'failure' || status.state === 'error') {
          onStatus(status.state, url);
          return { state: status.state, url };
        }

        // Still pending/in_progress
        onStatus(status.state, url);
      }
    } catch (e) {
      console.warn('[waitForDeploy] poll error:', e.message);
    }

    await new Promise(r => setTimeout(r, interval));
  }

  onStatus('timeout', null);
  return { state: 'timeout', url: null };
}
