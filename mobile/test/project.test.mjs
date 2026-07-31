import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import test from 'node:test';

const mobileRoot = resolve(import.meta.dirname, '..');
const repoRoot = resolve(mobileRoot, '..');
const project = readFileSync(
  join(mobileRoot, 'CRAMMobile.xcodeproj', 'project.pbxproj'),
  'utf8',
);

function filesBelow(directory, suffix) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesBelow(path, suffix);
    return entry.name.endsWith(suffix) ? [path] : [];
  });
}

test('the shared Xcode project references every Swift source and test', () => {
  const swiftFiles = [
    ...filesBelow(join(mobileRoot, 'CRAMMobile'), '.swift'),
    ...filesBelow(join(mobileRoot, 'CRAMMobileTests'), '.swift'),
  ];

  assert.ok(swiftFiles.length >= 18);
  for (const path of swiftFiles) {
    const name = path.split('/').at(-1);
    assert.match(
      project,
      new RegExp(`\\b${name.replaceAll('.', '\\.')}\\b`),
      `${relative(repoRoot, path)} is missing from project.pbxproj`,
    );
  }
  assert.match(project, /Build Shared Renderer/);
  assert.match(project, /Web in Resources/);
  assert.match(project, /IPHONEOS_DEPLOYMENT_TARGET = 17\.0/);
});

test('the renderer build script is valid shell and wired into Xcode', () => {
  const script = join(mobileRoot, 'scripts', 'build-web.sh');
  const source = readFileSync(script, 'utf8');
  assert.match(source, /^#!\/usr\/bin\/env bash\n/);
  assert.match(source, /\nset -euo pipefail\n/);
  assert.match(source, /npm.*run build/s);
  assert.match(project, /scripts\/build-web\.sh/);
});

test('Swift and browser cache policies keep the same security boundary', () => {
  const swiftPolicy = readFileSync(
    join(mobileRoot, 'CRAMMobile', 'Sync', 'CachePolicy.swift'),
    'utf8',
  );
  const browserPolicy = readFileSync(
    join(repoRoot, 'gui', 'src', 'lib', 'offline.ts'),
    'utf8',
  );
  const resources = [
    'health',
    'accounts',
    'contacts',
    'meetings',
    'opportunities',
    'products',
    'product-categories',
    'vendors',
    'vendor-products',
    'events',
    'notes',
    'threads',
  ];

  for (const resource of resources) {
    assert.ok(swiftPolicy.includes(`"${resource}"`), `Swift omits ${resource}`);
    assert.ok(browserPolicy.includes(`\\/${resource}`), `browser omits ${resource}`);
  }
  for (const excluded of ['provisioning', 'backup', 'agent']) {
    assert.ok(!swiftPolicy.includes(`"${excluded}"`), `Swift admits ${excluded}`);
  }
});

test('the native bridge actions agree on both sides', () => {
  const swiftBridge = readFileSync(
    join(mobileRoot, 'CRAMMobile', 'Web', 'MobileBridge.swift'),
    'utf8',
  );
  const browserBridge = [
    readFileSync(join(repoRoot, 'gui', 'src', 'lib', 'clientCache.ts'), 'utf8'),
    readFileSync(join(repoRoot, 'gui', 'src', 'lib', 'mobile.ts'), 'utf8'),
  ].join('\n');

  for (const action of [
    'put',
    'get',
    'keys',
    'delete',
    'openMeetingNotes',
    'openSettings',
  ]) {
    assert.ok(swiftBridge.includes(action), `Swift bridge omits ${action}`);
    assert.ok(browserBridge.includes(action), `browser bridge omits ${action}`);
  }
});
