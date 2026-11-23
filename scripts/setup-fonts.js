#!/usr/bin/env node
/* Copie les polices du design system Fin (Fontsource, SIL OFL 1.1) depuis
 * node_modules vers design-system/fonts. Versions épinglées dans package.json,
 * aucun téléchargement hors du registre npm. Lancé automatiquement par
 * `npm install` (postinstall). */
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'design-system', 'fonts');

// [paquet, préfixe de fichier, graisses]
const FONTS = [
  ['@fontsource/outfit', 'outfit', [200, 300, 400, 500]],
  ['@fontsource/inter', 'inter', [300, 400, 500]],
  ['@fontsource/ibm-plex-mono', 'ibm-plex-mono', [300, 400, 500]]
];

let copied = 0;
let missing = 0;
fs.mkdirSync(OUT, { recursive: true });
for (const [pkg, prefix, weights] of FONTS) {
  for (const w of weights) {
    const name = `${prefix}-latin-${w}-normal.woff2`;
    const src = path.join(ROOT, 'node_modules', pkg, 'files', name);
    if (!fs.existsSync(src)) { missing++; console.warn('police absente :', src); continue; }
    const buf = fs.readFileSync(src);
    if (buf.slice(0, 4).toString('latin1') !== 'wOF2') { console.error('signature invalide :', name); process.exit(1); }
    fs.writeFileSync(path.join(OUT, name), buf);
    copied++;
  }
}
console.log(`Polices : ${copied} copiées${missing ? `, ${missing} absentes (npm install ?)` : ''}.`);
