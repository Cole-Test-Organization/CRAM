import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import plistHook from '../scripts/harden-macos-plist.cjs';

test('macOS post-pack hardening disables arbitrary network loads', async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cram-client-plist-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const plistPath = path.join(directory, 'Info.plist');
  await writeFile(plistPath, [
    '<plist><dict>',
    '<key>NSAppTransportSecurity</key>',
    '<dict>',
    '<key>NSAllowsArbitraryLoads</key>',
    '<true/>',
    '<key>NSAllowsLocalNetworking</key>',
    '<true/>',
    '</dict>',
    '</dict></plist>',
  ].join('\n'));

  await plistHook.hardenMacOSInfoPlist(plistPath);
  await plistHook.hardenMacOSInfoPlist(plistPath);
  const hardened = await readFile(plistPath, 'utf8');

  assert.match(hardened, /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/);
  assert.doesNotMatch(hardened, /<key>NSAllowsArbitraryLoads<\/key>\s*<true\/>/);
});
