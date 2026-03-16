import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const app = createApp();
const port = Number(process.env.PORT || 8787);
const isProduction = process.env.NODE_ENV === 'production';

if (isProduction) {
  app.use(express.static(path.join(rootDir, 'netlify-build')));
  app.get('*', (_request, response) => {
    response.sendFile(path.join(rootDir, 'netlify-build', 'index.html'));
  });
}

app.listen(port, () => {
  console.log(`Transit Finder API server listening on http://localhost:${port}`);
});
