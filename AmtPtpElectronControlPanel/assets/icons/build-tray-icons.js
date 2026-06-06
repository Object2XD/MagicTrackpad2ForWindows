const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const outDir = path.join(__dirname, 'tray');
fs.mkdirSync(outDir, { recursive: true });

const states = {
  unknown: { fill: [142, 142, 147, 255], width: 12, mark: true },
  green: { fill: [48, 209, 88, 255], width: 18 },
  yellow: { fill: [255, 214, 10, 255], width: 10 },
  red: { fill: [255, 69, 58, 255], width: 5 }
};

function setPixel(png, x, y, rgba) {
  if (x < 0 || y < 0 || x >= png.width || y >= png.height) {
    return;
  }

  const index = (png.width * y + x) << 2;
  png.data[index] = rgba[0];
  png.data[index + 1] = rgba[1];
  png.data[index + 2] = rgba[2];
  png.data[index + 3] = rgba[3];
}

function drawRect(png, x, y, width, height, rgba) {
  for (let yy = y; yy < y + height; yy += 1) {
    for (let xx = x; xx < x + width; xx += 1) {
      setPixel(png, xx, yy, rgba);
    }
  }
}

function drawIcon(state) {
  const png = new PNG({ width: 32, height: 32 });
  const graphite = [28, 28, 30, 255];
  const inner = [58, 58, 60, 255];
  const white = [245, 245, 247, 255];

  drawRect(png, 4, 9, 22, 14, graphite);
  drawRect(png, 26, 13, 3, 6, graphite);
  drawRect(png, 7, 12, 18, 8, inner);
  drawRect(png, 7, 12, state.width, 8, state.fill);

  if (state.mark) {
    drawRect(png, 15, 13, 3, 8, white);
    drawRect(png, 15, 22, 3, 3, white);
  }

  return png;
}

for (const [name, state] of Object.entries(states)) {
  fs.writeFileSync(path.join(outDir, `tray-${name}.png`), PNG.sync.write(drawIcon(state)));
}

console.log(`Wrote tray icons to ${outDir}`);
