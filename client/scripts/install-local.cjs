const { execFileSync } = require('node:child_process');
const {
  accessSync,
  constants,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} = require('node:fs');
const os = require('node:os');
const path = require('node:path');

if (process.platform !== 'darwin') {
  throw new Error('The local CRAM Desktop installer only runs on macOS.');
}

const clientRoot = path.resolve(__dirname, '..');
const releaseRoot = path.join(clientRoot, 'release');
const productName = 'CRAM Desktop.app';
const installRoot = process.env.CRAM_LOCAL_INSTALL_DIR
  ? path.resolve(process.env.CRAM_LOCAL_INSTALL_DIR)
  : path.join(os.homedir(), 'Applications');
const destination = path.join(installRoot, productName);
const staging = path.join(installRoot, `.cram-desktop-installing-${process.pid}.app`);
const backupRoot = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'CRAM Desktop',
  'Updates',
);
// Keep rollback bits without a .app extension. Two discoverable bundles with
// the same identifier can confuse macOS Local Network privacy attribution.
const backup = path.join(backupRoot, 'Previous CRAM Desktop.bundle-backup');
const legacyBackup = path.join(backupRoot, 'Previous CRAM Desktop.app');
const sourceCandidates = [
  path.join(releaseRoot, `mac-${process.arch}`, productName),
  path.join(releaseRoot, 'mac', productName),
  path.join(releaseRoot, 'mac-universal', productName),
];
const source = sourceCandidates.find(existsSync);

if (!source) {
  throw new Error([
    'No packaged CRAM Desktop application was found.',
    `Expected one of:\n${sourceCandidates.map((value) => `  ${value}`).join('\n')}`,
    'Run npm run pack:local first.',
  ].join('\n'));
}

accessSync(path.join(source, 'Contents', 'MacOS', 'CRAM Desktop'), constants.X_OK);

try {
  execFileSync('/usr/bin/pgrep', ['-x', 'CRAM Desktop'], { stdio: 'ignore' });
  throw new Error('Quit CRAM Desktop before installing an update, then run this command again.');
} catch (error) {
  if (error?.status === undefined) throw error;
}

mkdirSync(installRoot, { recursive: true, mode: 0o700 });
mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
rmSync(legacyBackup, { recursive: true, force: true });
rmSync(staging, { recursive: true, force: true });

try {
  execFileSync('/usr/bin/ditto', [source, staging], { stdio: 'inherit' });
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', staging], {
    stdio: 'inherit',
  });

  if (existsSync(destination)) {
    rmSync(backup, { recursive: true, force: true });
    renameSync(destination, backup);
  }
  try {
    renameSync(staging, destination);
  } catch (error) {
    if (!existsSync(destination) && existsSync(backup)) renameSync(backup, destination);
    throw error;
  }
} finally {
  rmSync(staging, { recursive: true, force: true });
}

process.stdout.write(`Installed ${destination}\n`);
if (existsSync(backup)) process.stdout.write(`Previous build: ${backup}\n`);

if (!process.argv.includes('--no-launch')) {
  execFileSync('/usr/bin/open', [destination], { stdio: 'inherit' });
}
