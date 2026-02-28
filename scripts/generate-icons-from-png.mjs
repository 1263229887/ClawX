#!/usr/bin/env zx

import 'zx/globals';
import sharp from 'sharp';
import png2icons from 'png2icons';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(PROJECT_ROOT, 'resources', 'icons');
const SOURCE_PNG = path.join(PROJECT_ROOT, 'temp', 'icon.png');

echo`🎨 Generating icons from PNG source...`;

if (!fs.existsSync(SOURCE_PNG)) {
  echo`❌ Source PNG not found: ${SOURCE_PNG}`;
  process.exit(1);
}

try {
  // Read source PNG and resize to 256x256 (max size available)
  const masterPngBuffer = await sharp(SOURCE_PNG)
    .resize(256, 256)
    .png()
    .toBuffer();

  // Generate icon.png
  await sharp(masterPngBuffer).toFile(path.join(ICONS_DIR, 'icon.png'));
  echo`  ✅ Created icon.png`;

  // Generate Windows .ico
  echo`🪟 Generating Windows .ico...`;
  const icoBuffer = png2icons.createICO(masterPngBuffer, png2icons.HERMITE, 0, false);
  if (icoBuffer) {
    writeFileSync(path.join(ICONS_DIR, 'icon.ico'), icoBuffer);
    echo`  ✅ Created icon.ico`;
  } else {
    echo`  ❌ Failed to create icon.ico`;
  }

  // Generate macOS .icns
  echo`🍎 Generating macOS .icns...`;
  const icnsBuffer = png2icons.createICNS(masterPngBuffer, png2icons.HERMITE, 0);
  if (icnsBuffer) {
    writeFileSync(path.join(ICONS_DIR, 'icon.icns'), icnsBuffer);
    echo`  ✅ Created icon.icns`;
  } else {
    echo`  ❌ Failed to create icon.icns`;
  }

  // Generate Linux PNGs
  echo`🐧 Generating Linux PNG icons...`;
  for (const size of [16, 32, 48, 64, 128, 256]) {
    await sharp(masterPngBuffer)
      .resize(size, size)
      .toFile(path.join(ICONS_DIR, `${size}x${size}.png`));
  }
  echo`  ✅ Created Linux PNG icons`;

  echo`\n✨ Icon generation complete!`;
} catch (error) {
  echo`❌ Error: ${error.message}`;
  process.exit(1);
}
