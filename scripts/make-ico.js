// PNG → ICO 转换（用于 electron-builder Windows 图标）
const fs = require('fs');
const path = require('path');

const pngPath = path.join(__dirname, '..', 'assets', 'deepseek-icon.png');
const icoPath = path.join(__dirname, '..', 'icon.ico');

const png = fs.readFileSync(pngPath);

// 读取 PNG 尺寸（IHDR 在偏移 16 处，width 在 16，height 在 20）
const w = png.readUInt32BE(16);
const h = png.readUInt32BE(20);
console.log(`PNG: ${w}x${h}, ${png.length} bytes`);

// ICO 格式：6 字节头 + 16 字节目录 + PNG 数据
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0);  // reserved
header.writeUInt16LE(1, 2);  // ICO type
header.writeUInt16LE(1, 4);  // image count

const dir = Buffer.alloc(16);
dir.writeUInt8(w >= 256 ? 0 : w, 0);  // 0 = 256 in ICO
dir.writeUInt8(h >= 256 ? 0 : h, 1);
dir.writeUInt8(0, 2);   // color palette
dir.writeUInt8(0, 3);   // reserved
dir.writeUInt16LE(1, 4); // planes
dir.writeUInt16LE(32, 6); // bpp
dir.writeUInt32LE(png.length, 8); // image size
dir.writeUInt32LE(22, 12); // offset (after header + dir)

const ico = Buffer.concat([header, dir, png]);
fs.writeFileSync(icoPath, ico);
console.log(`ICO: ${ico.length} bytes → ${icoPath}`);
