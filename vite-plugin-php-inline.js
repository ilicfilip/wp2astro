/**
 * Vite plugin: Inline PHP files as JavaScript string exports.
 *
 * Reads PHP class files from the CLI plugin directory and exposes
 * them as a virtual module `virtual:php-classes` with named exports.
 *
 * Usage in app code:
 *   import { markdownConverter, frontmatterBuilder, ... } from 'virtual:php-classes';
 *
 * Each export is the raw PHP file content as a string.
 */
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const VIRTUAL_MODULE_ID = 'virtual:php-classes';
const RESOLVED_ID = '\0' + VIRTUAL_MODULE_ID;

// Map of export name → PHP file path (relative to CLI plugin includes/)
const PHP_FILES = {
  markdownConverter:  'class-markdown-converter.php',
  frontmatterBuilder: 'class-frontmatter-builder.php',
  imageHandler:       'class-image-handler.php',
  postExporter:       'class-post-exporter.php',
  mdToBlocks:         'class-md-to-blocks.php',
  mdImporter:         'class-md-importer.php',
};

export default function phpInlinePlugin(options = {}) {
  // PHP classes are bundled in this repo under php-classes/
  const phpDir = options.phpDir || resolve(__dirname, 'php-classes');

  return {
    name: 'vite-plugin-php-inline',

    resolveId(id) {
      if (id === VIRTUAL_MODULE_ID) {
        return RESOLVED_ID;
      }
    },

    load(id) {
      if (id !== RESOLVED_ID) return;

      const exports = [];

      for (const [name, filename] of Object.entries(PHP_FILES)) {
        const filePath = resolve(phpDir, filename);
        try {
          const content = readFileSync(filePath, 'utf-8');
          // Use JSON.stringify to safely escape all special characters
          exports.push(`export const ${name} = ${JSON.stringify(content)};`);
        } catch (e) {
          console.warn(`[php-inline] Could not read ${filePath}: ${e.message}`);
          exports.push(`export const ${name} = '<?php /* ${filename} not found */ ?>';`);
        }
      }

      return exports.join('\n\n');
    },

    // Watch PHP files for HMR during development
    configureServer(server) {
      for (const filename of Object.values(PHP_FILES)) {
        const filePath = resolve(phpDir, filename);
        server.watcher.add(filePath);
      }

      server.watcher.on('change', (path) => {
        const isPhpFile = Object.values(PHP_FILES).some(
          f => path.endsWith(f)
        );
        if (isPhpFile) {
          const mod = server.moduleGraph.getModuleById(RESOLVED_ID);
          if (mod) {
            server.moduleGraph.invalidateModule(mod);
            server.ws.send({ type: 'full-reload' });
          }
        }
      });
    },
  };
}
