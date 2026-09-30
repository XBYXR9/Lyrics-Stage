// `npm run app:dev` — runs the lyrics page with live reload inside the desktop app.
import { spawn } from 'node:child_process';
import electronPath from 'electron';
import { createServer } from 'vite';
import { buildElectron } from './build-electron.mjs';

await buildElectron();
const server = await createServer({ server: { open: false } });
await server.listen();
const url = server.resolvedUrls?.local[0] ?? 'http://127.0.0.1:5173/';
console.log(`Lyrics page at ${url} — starting the app…`);

const child = spawn(electronPath, ['.', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});
child.on('exit', async (code) => {
  await server.close();
  process.exit(code ?? 0);
});
