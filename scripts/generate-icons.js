#!/usr/bin/env node
/**
 * generate-icons.js
 *
 * Generates SVG-based icons for the Smart Mirror PWA.
 * Outputs:
 *   frontend/public/icons/icon.svg   — scalable vector icon (any size)
 *   frontend/public/favicon.svg      — compact 32px favicon
 *
 * The icons depict a rounded mirror frame (accent color #6b62e0) with a
 * dark glass surface and a clock face inside.
 *
 * To generate raster PNG variants (192x192, 512x512) you can install:
 *   npm install -g sharp-cli
 *   sharp -i frontend/public/icons/icon.svg -o frontend/public/icons/icon-512.png resize 512 512
 *   sharp -i frontend/public/icons/icon.svg -o frontend/public/icons/icon-192.png resize 192 192
 *
 * Or use the Inkscape CLI:
 *   inkscape --export-type=png --export-width=512 --export-filename=icon-512.png icon.svg
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'frontend', 'public', 'icons');
const PUBLIC_DIR = path.join(ROOT, 'frontend', 'public');

// ── Main icon SVG (512x512 viewbox) ──────────────────────────────────────────

const iconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <!-- Background: rounded rectangle (mirror frame) -->
  <rect x="32" y="32" width="448" height="448" rx="72" ry="72" fill="#6b62e0"/>

  <!-- Inner mirror glass surface -->
  <rect x="72" y="72" width="368" height="368" rx="48" ry="48" fill="#1a1830"/>

  <!-- Clock circle -->
  <circle cx="256" cy="240" r="110" fill="none" stroke="#6b62e0" stroke-width="12"/>
  <circle cx="256" cy="240" r="96" fill="#221f3d"/>

  <!-- Clock tick marks (12, 3, 6, 9) -->
  <line x1="256" y1="152" x2="256" y2="168" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
  <line x1="344" y1="240" x2="328" y2="240" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
  <line x1="256" y1="328" x2="256" y2="312" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>
  <line x1="168" y1="240" x2="184" y2="240" stroke="#ffffff" stroke-width="8" stroke-linecap="round"/>

  <!-- Hour hand (~10 o'clock) -->
  <line x1="256" y1="240" x2="216" y2="198" stroke="#ffffff" stroke-width="10" stroke-linecap="round"/>

  <!-- Minute hand (~2 o'clock) -->
  <line x1="256" y1="240" x2="296" y2="190" stroke="#ffffff" stroke-width="6" stroke-linecap="round"/>

  <!-- Center dot -->
  <circle cx="256" cy="240" r="8" fill="#6b62e0"/>

  <!-- Status bar at bottom (like mirror stand) -->
  <rect x="96" y="392" width="320" height="16" rx="8" ry="8" fill="#6b62e0" opacity="0.7"/>
</svg>`;

// ── Favicon SVG (32x32 viewbox) ───────────────────────────────────────────────

const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32">
  <!-- Mirror frame background -->
  <rect x="1" y="1" width="30" height="30" rx="5" ry="5" fill="#6b62e0"/>

  <!-- Mirror glass -->
  <rect x="4" y="4" width="24" height="24" rx="3" ry="3" fill="#1a1830"/>

  <!-- Clock circle -->
  <circle cx="16" cy="15" r="8" fill="none" stroke="#6b62e0" stroke-width="1.5"/>
  <circle cx="16" cy="15" r="6.5" fill="#221f3d"/>

  <!-- Clock hands -->
  <line x1="16" y1="15" x2="13.5" y2="12.5" stroke="#ffffff" stroke-width="1.5" stroke-linecap="round"/>
  <line x1="16" y1="15" x2="18.5" y2="12" stroke="#ffffff" stroke-width="1" stroke-linecap="round"/>
  <circle cx="16" cy="15" r="1" fill="#6b62e0"/>

  <!-- Status bar -->
  <rect x="6" y="25" width="20" height="2" rx="1" fill="#6b62e0" opacity="0.8"/>
</svg>`;

// ── Write files ───────────────────────────────────────────────────────────────

fs.mkdirSync(ICONS_DIR, { recursive: true });

const iconPath = path.join(ICONS_DIR, 'icon.svg');
fs.writeFileSync(iconPath, iconSvg, 'utf8');
console.log('Written:', iconPath);

const faviconPath = path.join(PUBLIC_DIR, 'favicon.svg');
fs.writeFileSync(faviconPath, faviconSvg, 'utf8');
console.log('Written:', faviconPath);

console.log('');
console.log('SVG icons generated successfully.');
console.log('');
console.log('To generate raster PNGs (optional, for older browsers):');
console.log('  npx sharp-cli -i frontend/public/icons/icon.svg -o frontend/public/icons/icon-512.png resize 512 512');
console.log('  npx sharp-cli -i frontend/public/icons/icon.svg -o frontend/public/icons/icon-192.png resize 192 192');
console.log('');
console.log('Or with Inkscape on Raspberry Pi:');
console.log('  inkscape --export-type=png --export-width=512 \\');
console.log('    --export-filename=frontend/public/icons/icon-512.png \\');
console.log('    frontend/public/icons/icon.svg');
