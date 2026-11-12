import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');
const withLinux = process.argv.slice(2).includes('--linux');

const WINDOWS_EXE = {
  from: 'src-tauri/target/x86_64-pc-windows-msvc/release/MiniImageEditor.exe',
  to: 'windows/MiniImageEditor.exe',
};
const DEB_DIR = 'src-tauri/target/release/bundle/deb';

function fail(message) {
  console.error(`\nrelease failed: ${message}`);
  process.exit(1);
}

function runScript(name) {
  console.log(`\n> npm run ${name}`);
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', name], { cwd: root, stdio: 'inherit' });
  if (result.error) fail(`could not start "npm run ${name}": ${result.error.message}`);
  if (result.status !== 0) {
    const reason = result.signal ? `signal ${result.signal}` : `exit code ${result.status}`;
    fail(`"npm run ${name}" stopped with ${reason}`);
  }
}

function formatSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}

/** The newest `.deb` file of the Linux bundle folder, so an old version left in the folder is not shipped. */
function newestDeb() {
  const dir = join(root, DEB_DIR);
  if (!existsSync(dir)) fail(`missing build folder: ${DEB_DIR}`);
  const debs = readdirSync(dir)
    .filter((name) => name.endsWith('.deb'))
    .map((name) => ({ name, time: statSync(join(dir, name)).mtimeMs }))
    .sort((a, b) => b.time - a.time);
  if (debs.length === 0) fail(`no .deb file in ${DEB_DIR}`);
  return { from: join(DEB_DIR, debs[0].name), to: join('linux', debs[0].name) };
}

const artifacts = [WINDOWS_EXE];

runScript('build:win');
if (!existsSync(join(root, WINDOWS_EXE.from))) fail(`missing build artifact: ${WINDOWS_EXE.from}`);

if (withLinux) {
  runScript('build:linux');
  artifacts.push(newestDeb());
}

rmSync(releaseDir, { recursive: true, force: true });

const written = [];
for (const { from, to } of artifacts) {
  const target = join(releaseDir, to);
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(join(root, from), target);
  written.push(target);
}

console.log('\nRelease artifacts:');
for (const path of written) {
  const size = statSync(path).size;
  if (size === 0) fail(`empty artifact: ${relative(root, path)}`);
  console.log(`  ${relative(root, path).padEnd(48)} ${formatSize(size)}`);
}
