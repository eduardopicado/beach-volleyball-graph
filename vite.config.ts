import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// `base` is set from BASE_PATH so the same build works on a user/org Pages site
// (served at /) and on a project Pages site (served at /<repo>/).
export default defineConfig({
  root: 'web',
  base: process.env.BASE_PATH ?? '/',
  plugins: [react()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
