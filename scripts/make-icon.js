// 图标生成脚本 — 生成 DeepSeek 品牌 256x256 PNG
// 用法: node scripts/make-icon.js
// 纯 Node.js，无外部依赖

const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const SIZE = 256;
const outputPath = path.join(__dirname, '..', 'assets', 'icon.png');

// ── 像素数据生成 ──────────────────────────────────────────
// RGBA 像素数组 (每个像素 4 字节)
const pixels = Buffer.alloc(SIZE * SIZE * 4);

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || x >= SIZE || y < 0 || y >= SIZE) return;
  const idx = (y * SIZE + x) * 4;
  pixels[idx] = r;
  pixels[idx + 1] = g;
  pixels[idx + 2] = b;
  pixels[idx + 3] = a;
}

// 填充圆角矩形
function fillRoundedRect(rx, ry, rw, rh, radius, r, g, b, a) {
  for (let y = ry; y < ry + rh; y++) {
    for (let x = rx; x < rx + rw; x++) {
      // 圆角检测
      let inside = true;
      if (x < rx + radius && y < ry + radius) {
        const dx = rx + radius - x - 1;
        const dy = ry + radius - y - 1;
        if (dx * dx + dy * dy > radius * radius) inside = false;
      } else if (x >= rx + rw - radius && y < ry + radius) {
        const dx = x - (rx + rw - radius);
        const dy = ry + radius - y - 1;
        if (dx * dx + dy * dy > radius * radius) inside = false;
      } else if (x < rx + radius && y >= ry + rh - radius) {
        const dx = rx + radius - x - 1;
        const dy = y - (ry + rh - radius);
        if (dx * dx + dy * dy > radius * radius) inside = false;
      } else if (x >= rx + rw - radius && y >= ry + rh - radius) {
        const dx = x - (rx + rw - radius);
        const dy = y - (ry + rh - radius);
        if (dx * dx + dy * dy > radius * radius) inside = false;
      }
      if (inside) setPixel(x, y, r, g, b, a);
    }
  }
}

// 填充圆形
function fillCircle(cx, cy, radius, r, g, b, a) {
  for (let y = cy - radius; y <= cy + radius; y++) {
    for (let x = cx - radius; x <= cx + radius; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= radius * radius) {
        setPixel(x, y, r, g, b, a);
      }
    }
  }
}

// 绘制水平线
function drawHLine(x1, x2, y, r, g, b, a, thickness = 1) {
  for (let t = 0; t < thickness; t++) {
    for (let x = x1; x <= x2; x++) {
      setPixel(x, y + t, r, g, b, a);
    }
  }
}

// ── 绘制 DeepSeek 图标 ────────────────────────────────────

// 背景: DeepSeek 蓝圆角方形 (占居中 70%)
const margin = Math.floor(SIZE * 0.15);
const rectSize = SIZE - margin * 2;
const radius = Math.floor(SIZE * 0.18);

// 渐变效果：上半部分亮蓝，下半部分深蓝
const centerY = SIZE / 2;

for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // 检查是否在圆角矩形内
    let inside = true;
    const rx = margin, ry = margin, rw = rectSize, rh = rectSize;

    if (x < rx + radius && y < ry + radius) {
      const dx = rx + radius - x - 1;
      const dy = ry + radius - y - 1;
      if (dx * dx + dy * dy > radius * radius) inside = false;
    } else if (x >= rx + rw - radius && y < ry + radius) {
      const dx = x - (rx + rw - radius);
      const dy = ry + radius - y - 1;
      if (dx * dx + dy * dy > radius * radius) inside = false;
    } else if (x < rx + radius && y >= ry + rh - radius) {
      const dx = rx + radius - x - 1;
      const dy = y - (ry + rh - radius);
      if (dx * dx + dy * dy > radius * radius) inside = false;
    } else if (x >= rx + rw - radius && y >= ry + rh - radius) {
      const dx = x - (rx + rw - radius);
      const dy = y - (ry + rh - radius);
      if (dx * dx + dy * dy > radius * radius) inside = false;
    }

    if (inside) {
      // 垂直渐变: 从上到下 #4D6BFE → #3A52D6
      const t = (y - margin) / rectSize;
      const r = Math.round(77 + (58 - 77) * t);   // 77 → 58
      const g = Math.round(107 + (82 - 107) * t); // 107 → 82
      const b = Math.round(254 + (214 - 254) * t); // 254 → 214
      setPixel(x, y, r, g, b, 255);
    } else {
      setPixel(x, y, 0, 0, 0, 0); // 透明
    }
  }
}

// 白色 "DS" 字母简化 — 用几何图形表示
// 画三条水平线代表能耗监控
const barY1 = Math.floor(SIZE * 0.38);
const barY2 = Math.floor(SIZE * 0.50);
const barY3 = Math.floor(SIZE * 0.62);
const barLeft = Math.floor(SIZE * 0.30);
const barRight = Math.floor(SIZE * 0.70);

drawHLine(barLeft, Math.floor(SIZE * 0.55), barY1, 255, 255, 255, 255, Math.floor(SIZE * 0.04));
drawHLine(barLeft, Math.floor(SIZE * 0.62), barY2, 255, 255, 255, 255, Math.floor(SIZE * 0.04));
drawHLine(barLeft, Math.floor(SIZE * 0.50), barY3, 255, 255, 255, 255, Math.floor(SIZE * 0.04));

// ── 构建 PNG ──────────────────────────────────────────────

function crc32(buf) {
  let crc = 0xFFFFFFFF;
  const table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c;
  }
  for (let i = 0; i < buf.length; i++) {
    crc = table[(crc ^ buf[i]) & 0xFF] ^ (crc >>> 8);
  }
  return (crc ^ 0xFFFFFFFF) >>> 0;
}

function pngChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(crcData), 0);
  return Buffer.concat([len, typeB, data, crcBuf]);
}

// PNG 签名
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

// IHDR
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0);  // width
ihdr.writeUInt32BE(SIZE, 4);  // height
ihdr[8] = 8;   // bit depth
ihdr[9] = 6;   // color type: RGBA
ihdr[10] = 0;  // compression
ihdr[11] = 0;  // filter
ihdr[12] = 0;  // interlace

// 原始像素数据（每行前加 filter byte = 0）
const rawData = Buffer.alloc(SIZE * (1 + SIZE * 4));
for (let y = 0; y < SIZE; y++) {
  const rowStart = y * (1 + SIZE * 4);
  rawData[rowStart] = 0; // filter: None
  pixels.copy(rawData, rowStart + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}

// IDAT: zlib 压缩
const compressed = zlib.deflateSync(rawData, { level: 9 });

// 组装 PNG
const png = Buffer.concat([
  signature,
  pngChunk('IHDR', ihdr),
  pngChunk('IDAT', compressed),
  pngChunk('IEND', Buffer.alloc(0))
]);

fs.writeFileSync(outputPath, png);
console.log(`✅ 图标已生成: ${outputPath} (${png.length} bytes)`);
