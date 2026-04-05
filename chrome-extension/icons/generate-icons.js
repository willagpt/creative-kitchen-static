#!/usr/bin/env node
/**
 * Generate Chrome extension icons for Creative Kitchen.
 * 
 * Usage:
 *   cd chrome-extension/icons
 *   npm install canvas
 *   node generate-icons.js
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function generateIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');

  // Orange rounded rectangle
  const radius = Math.max(2, Math.floor(size / 8));
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fillStyle = '#f97316';
  ctx.fill();

  // White "CK" text
  const fontSize = Math.max(8, Math.floor(size / 2.8));
  ctx.font = `bold ${fontSize}px sans-serif`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('CK', size / 2, size / 2 + 1);

  const outPath = path.join(__dirname, `icon${size}.png`);
  const buffer = canvas.toBuffer('image/png');
  fs.writeFileSync(outPath, buffer);
  console.log(`  Created ${outPath}`);
}

console.log('Generating Creative Kitchen extension icons...');
[16, 48, 128].forEach(generateIcon);
console.log('Done!');
