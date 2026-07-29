const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const ARBITRARY_LOADS_TRUE = /(<key>NSAllowsArbitraryLoads<\/key>\s*)<true\/>/;
const ARBITRARY_LOADS_FALSE = /<key>NSAllowsArbitraryLoads<\/key>\s*<false\/>/;

async function hardenMacOSInfoPlist(plistPath) {
  const original = await readFile(plistPath, 'utf8');
  if (ARBITRARY_LOADS_FALSE.test(original)) return;
  if (!ARBITRARY_LOADS_TRUE.test(original)) {
    throw new Error(`Could not find NSAllowsArbitraryLoads in ${plistPath}`);
  }

  const hardened = original.replace(ARBITRARY_LOADS_TRUE, '$1<false/>');
  await writeFile(plistPath, hardened, 'utf8');
}

async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const plistPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`,
    'Contents',
    'Info.plist',
  );
  await hardenMacOSInfoPlist(plistPath);
}

module.exports = afterPack;
module.exports.default = afterPack;
module.exports.hardenMacOSInfoPlist = hardenMacOSInfoPlist;
