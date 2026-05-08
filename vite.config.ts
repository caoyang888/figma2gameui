import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vue from '@vitejs/plugin-vue';
import * as esbuild from 'esbuild';
import { defineConfig, type Plugin } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const uiRoot = path.resolve(__dirname, 'src', 'ui');
const distUi = path.resolve(__dirname, 'dist-ui');
const dist = path.resolve(__dirname, 'dist');

function bundleFigmaMain(): Plugin {
  return {
    name: 'bundle-figma-main',
    async closeBundle() {
      const srcHtml = path.join(distUi, 'index.html');
      if (!fs.existsSync(srcHtml)) {
        return;
      }
      fs.mkdirSync(dist, { recursive: true });
      const destHtml = path.join(dist, 'ui.html');
      fs.copyFileSync(srcHtml, destHtml);
      const html = fs.readFileSync(destHtml, 'utf8');
      await esbuild.build({
        absWorkingDir: __dirname,
        entryPoints: [path.join(__dirname, 'src', 'main.ts')],
        bundle: true,
        outfile: path.join(dist, 'code.js'),
        format: 'iife',
        platform: 'browser',
        target: 'es2017',
        define: {
          __html__: JSON.stringify(html),
        },
        logLevel: 'info',
      });
    },
  };
}

export default defineConfig({
  root: uiRoot,
  plugins: [vue(), viteSingleFile(), bundleFigmaMain()],
  build: {
    outDir: distUi,
    emptyOutDir: true,
    target: 'es2017',
    minify: 'esbuild',
  },
});
