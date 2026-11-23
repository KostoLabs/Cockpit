'use strict';
/* Hook electron-builder (afterPack) : sur macOS, sans certificat Developer ID,
 * signe l'app en ad hoc avec le codesign d'Apple. Sur Apple Silicon, un binaire
 * dont la signature est invalide (Info.plist réécrit par le packaging) est tué
 * au lancement ; la signature ad hoc le rend exécutable après « xattr -cr ».
 * Avec CSC_LINK / CSC_NAME, electron-builder signe lui-même (Developer ID). */
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;
  if (process.platform !== 'darwin') {
    console.log('  • signature ad hoc ignorée : codesign n’existe que sur macOS (voir scripts/mac-adhoc-sign.sh)');
    return;
  }
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const app = path.join(context.appOutDir, context.packager.appInfo.productFilename + '.app');
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', '--timestamp=none', app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log('  • signature ad hoc : ' + app);
};
