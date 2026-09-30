// Bundles the desktop app's main process and preload script (TypeScript → CommonJS).
import { build } from 'esbuild';

export async function buildElectron({ watch = false } = {}) {
  const common = {
    bundle: true,
    platform: 'node',
    target: 'node22',
    format: 'cjs',
    sourcemap: true,
    // `electron` is provided at runtime; `usocket` and `x11` are optional dbus-next extras we don't need.
    external: ['electron', 'usocket', 'x11'],
    logLevel: watch ? 'info' : 'warning',
    define: { 'process.env.npm_package_version': JSON.stringify(process.env.npm_package_version ?? '') },
  };
  await build({ ...common, entryPoints: ['electron/main.ts'], outfile: 'dist-electron/main.cjs' });
  await build({ ...common, entryPoints: ['electron/preload.ts'], outfile: 'dist-electron/preload.cjs' });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await buildElectron();
  console.log('Built dist-electron/');
}
