const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const iconDir = __dirname;
const sourcePath = path.join(iconDir, 'app-icon-source.png');
const pngPath = path.join(iconDir, 'app-icon.png');
const icoPath = path.join(iconDir, 'app.ico');

function removeChromaKey(source) {
  const output = new PNG({ width: source.width, height: source.height });

  for (let y = 0; y < source.height; y += 1) {
    for (let x = 0; x < source.width; x += 1) {
      const index = (source.width * y + x) << 2;
      const red = source.data[index];
      const green = source.data[index + 1];
      const blue = source.data[index + 2];
      const alpha = source.data[index + 3];
      const greenScore = green - Math.max(red, blue);

      output.data[index] = red;
      output.data[index + 1] = green;
      output.data[index + 2] = blue;

      if (green > 145 && greenScore > 45) {
        const matte = Math.max(0, Math.min(255, 255 - ((greenScore - 45) * 6)));
        output.data[index + 3] = matte < 55 ? 0 : matte;
      } else {
        output.data[index + 3] = alpha;
      }
    }
  }

  return output;
}

function resizeNearest(source, size) {
  const output = new PNG({ width: size, height: size });
  const xRatio = source.width / size;
  const yRatio = source.height / size;

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const sourceX = Math.min(source.width - 1, Math.floor(x * xRatio));
      const sourceY = Math.min(source.height - 1, Math.floor(y * yRatio));
      const sourceIndex = (source.width * sourceY + sourceX) << 2;
      const outputIndex = (size * y + x) << 2;

      output.data[outputIndex] = source.data[sourceIndex];
      output.data[outputIndex + 1] = source.data[sourceIndex + 1];
      output.data[outputIndex + 2] = source.data[sourceIndex + 2];
      output.data[outputIndex + 3] = source.data[sourceIndex + 3];
    }
  }

  return output;
}

function makeIco(pngImages) {
  const headerSize = 6 + (pngImages.length * 16);
  const totalSize = headerSize + pngImages.reduce((sum, image) => sum + image.bytes.length, 0);
  const buffer = Buffer.alloc(totalSize);
  let cursor = 0;

  buffer.writeUInt16LE(0, cursor);
  cursor += 2;
  buffer.writeUInt16LE(1, cursor);
  cursor += 2;
  buffer.writeUInt16LE(pngImages.length, cursor);
  cursor += 2;

  let imageOffset = headerSize;
  for (const image of pngImages) {
    const dimension = image.size === 256 ? 0 : image.size;
    buffer.writeUInt8(dimension, cursor);
    cursor += 1;
    buffer.writeUInt8(dimension, cursor);
    cursor += 1;
    buffer.writeUInt8(0, cursor);
    cursor += 1;
    buffer.writeUInt8(0, cursor);
    cursor += 1;
    buffer.writeUInt16LE(1, cursor);
    cursor += 2;
    buffer.writeUInt16LE(32, cursor);
    cursor += 2;
    buffer.writeUInt32LE(image.bytes.length, cursor);
    cursor += 4;
    buffer.writeUInt32LE(imageOffset, cursor);
    cursor += 4;
    imageOffset += image.bytes.length;
  }

  for (const image of pngImages) {
    image.bytes.copy(buffer, cursor);
    cursor += image.bytes.length;
  }

  return buffer;
}

const source = PNG.sync.read(fs.readFileSync(sourcePath));
const transparent = removeChromaKey(source);
fs.writeFileSync(pngPath, PNG.sync.write(transparent));

const sizes = [16, 24, 32, 48, 64, 128, 256];
const pngImages = sizes.map((size) => ({
  size,
  bytes: PNG.sync.write(resizeNearest(transparent, size))
}));
fs.writeFileSync(icoPath, makeIco(pngImages));

console.log(`Wrote ${pngPath}`);
console.log(`Wrote ${icoPath}`);
