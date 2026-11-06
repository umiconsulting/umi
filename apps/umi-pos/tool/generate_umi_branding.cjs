// Development tool. Pass an installed Sharp directory and optional --check.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const dependency = process.argv[2];
if (!dependency) throw new Error('Pass the installed sharp directory');
const sharp = require(path.resolve(dependency));
if (sharp.versions.sharp !== '0.35.5') throw new Error('Use Sharp 0.35.5');
const check = process.argv.slice(3).includes('--check');
const app = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(app, 'assets/branding/umi-wordmark.svg'), 'utf8');
const [, width, height] = source.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
const [, ink, outline] = source.match(
  /<path fill="(#[0-9A-Fa-f]{6})" fill-rule="nonzero" d="([^"]+)"/,
);
const surface = '#FFFEFA';
const outputs = new Map();
const res = 'android/app/src/main/res';
const fixed = (value) => Number(value.toFixed(8));

function placement(canvas, inkWidth) {
  const scale = inkWidth / Number(width);
  return {
    scale: fixed(scale),
    x: fixed((canvas - inkWidth) / 2),
    y: fixed((canvas - Number(height) * scale) / 2),
  };
}

function svg(canvas, inkWidth) {
  const { scale, x, y } = placement(canvas, inkWidth);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}" viewBox="0 0 ${canvas} ${canvas}"><g transform="translate(${x} ${y}) scale(${scale})"><path fill="${ink}" fill-rule="nonzero" d="${outline}"/></g></svg>`;
}

function vector(canvas, inkWidth) {
  const { scale, x, y } = placement(canvas, inkWidth);
  return `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from assets/branding/umi-wordmark.svg. -->
<vector xmlns:android="http://schemas.android.com/apk/res/android"
    android:width="${canvas}dp" android:height="${canvas}dp"
    android:viewportWidth="${canvas}" android:viewportHeight="${canvas}">
    <group android:scaleX="${scale}" android:scaleY="${scale}"
        android:translateX="${x}" android:translateY="${y}">
        <path android:fillColor="${ink}" android:pathData="${outline}" />
    </group>
</vector>
`;
}

async function raster(size, canvas = 1024, inkWidth = canvas * 0.66, opaque = true) {
  let pipeline = sharp(Buffer.from(svg(canvas, inkWidth)), { density: 72 })
    .resize(size, size, { kernel: 'lanczos3' })
    .toColourspace('srgb');
  if (opaque) pipeline = pipeline.flatten({ background: surface }).removeAlpha();
  return pipeline.png({ compressionLevel: 9, adaptiveFiltering: false }).toBuffer();
}

async function main() {
  for (const platform of ['ios', 'macos']) {
    const catalog = `${platform}/Runner/Assets.xcassets/AppIcon.appiconset`;
    const { images } = JSON.parse(fs.readFileSync(path.join(app, catalog, 'Contents.json')));
    for (const image of images) {
      const size = Number(image.size.split('x')[0]) * Number(image.scale.replace('x', ''));
      outputs.set(`${catalog}/${image.filename}`, await raster(size));
    }
  }
  for (const [density, size] of Object.entries({
    mdpi: 48,
    hdpi: 72,
    xhdpi: 96,
    xxhdpi: 144,
    xxxhdpi: 192,
  })) {
    outputs.set(`${res}/mipmap-${density}/ic_launcher.png`, await raster(size));
  }
  for (const size of [192, 512]) {
    for (const name of ['Icon', 'Icon-maskable'])
      outputs.set(`web/icons/${name}-${size}.png`, await raster(size));
  }
  outputs.set('web/favicon.png', await raster(32));
  // UIImageView uses a 288pt square. The visible wordmark is 168pt wide.
  for (const scale of [1, 2, 3]) {
    const suffix = scale === 1 ? '' : `@${scale}x`;
    outputs.set(
      `ios/Runner/Assets.xcassets/LaunchImage.imageset/LaunchImage${suffix}.png`,
      await raster(288 * scale, 288, 168, false),
    );
  }
  // Pillow owns the ICO container and its official multi-size implementation.
  const icoSource = await raster(256);
  const python = spawnSync(
    process.env.UMI_BRAND_PYTHON || 'python3',
    [path.join(__dirname, 'umi_branding_ico.py')],
    { input: icoSource, maxBuffer: 1024 * 1024 },
  );
  if (python.status !== 0)
    throw new Error(python.stderr?.toString() || python.error?.message || 'ICO generation failed');
  outputs.set('windows/runner/resources/app_icon.ico', python.stdout);
  outputs.set(`${res}/drawable/umi_launcher_foreground.xml`, vector(108, 58.32));
  outputs.set(`${res}/drawable/umi_splash.xml`, vector(288, 168));
  outputs.set(
    `${res}/values/umi_brand_colors.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<!-- Generated from the approved PosPalette light surface. -->
<resources>
    <color name="umi_brand_surface">${surface}</color>
</resources>
`,
  );
  outputs.set(
    `${res}/mipmap-anydpi-v26/ic_launcher.xml`,
    `<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@color/umi_brand_surface" />
    <foreground android:drawable="@drawable/umi_launcher_foreground" />
</adaptive-icon>
`,
  );
  const stale = [];
  for (const [relative, data] of outputs) {
    const file = path.join(app, relative);
    const bytes = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (check) {
      if (!fs.existsSync(file) || !fs.readFileSync(file).equals(bytes)) stale.push(relative);
    } else {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, bytes);
    }
  }
  if (stale.length) throw new Error(`Stale assets:\n${stale.join('\n')}`);
  console.log(
    `${check ? 'Checked' : 'Generated'} ${outputs.size} assets; Sharp ${sharp.versions.sharp}, librsvg ${sharp.versions.rsvg}, libvips ${sharp.versions.vips}`,
  );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
