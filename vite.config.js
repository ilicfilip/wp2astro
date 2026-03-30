import { defineConfig } from 'vite';
import phpInlinePlugin from './vite-plugin-php-inline.js';

import { cloudflare } from "@cloudflare/vite-plugin";

export default defineConfig({
  plugins: [phpInlinePlugin(), cloudflare()],
});