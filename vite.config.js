import { defineConfig } from 'vite';
import phpInlinePlugin from './vite-plugin-php-inline.js';

export default defineConfig({
  plugins: [
    phpInlinePlugin(),
  ],
});
