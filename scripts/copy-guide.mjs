// Copies the user guide and its images into public/guide/ so the app serves them at /help
// (the Docker image carries public/, not docs/). Runs before `next dev` and `next build`.
import { cpSync, mkdirSync, rmSync } from 'node:fs';

rmSync('public/guide', { recursive: true, force: true });
mkdirSync('public/guide', { recursive: true });
cpSync('docs/user-guide.md', 'public/guide/user-guide.md');
cpSync('docs/images', 'public/guide/images', { recursive: true });
