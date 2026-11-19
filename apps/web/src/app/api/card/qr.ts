/** Fixed QR Model 2 version 5, ECC L, byte mode, mask 0. No external service.
 * The 106-byte limit fails closed; quiet zone is added by the renderer.
 * Algorithm reference: https://www.nayuki.io/page/qr-code-generator-library
 */
export function qrMatrix(text: string): boolean[][] {
  const bytes = new TextEncoder().encode(text);
  if (bytes.length > 106) throw new Error("Receipt URL is too long for QR");
  const bits: number[] = [];
  const append = (v: number, n: number) => { for (let i = n - 1; i >= 0; i--) bits.push((v >>> i) & 1); };
  append(4, 4); append(bytes.length, 8);
  for (const byte of bytes) append(byte, 8);
  append(0, Math.min(4, 864 - bits.length));
  while (bits.length % 8) bits.push(0);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) data.push(bits.slice(i, i + 8).reduce((v, b) => v * 2 + b, 0));
  for (let i = 0; data.length < 108; i++) data.push(i % 2 === 0 ? 236 : 17);
  const multiply = (a: number, b: number) => {
    let product = 0;
    for (let i = 7; i >= 0; i--) { product = (product << 1) ^ ((product >>> 7) * 285); product ^= ((b >>> i) & 1) * a; }
    return product;
  };
  const divisor = Array<number>(26).fill(0); divisor[25] = 1;
  let root = 1;
  for (let i = 0; i < 26; i++) {
    for (let j = 0; j < divisor.length; j++) { divisor[j] = multiply(divisor[j], root); if (j + 1 < divisor.length) divisor[j] ^= divisor[j + 1]; }
    root = multiply(root, 2);
  }
  const remainder = Array<number>(26).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder.shift()!; remainder.push(0);
    for (let i = 0; i < 26; i++) remainder[i] ^= multiply(divisor[i], factor);
  }
  const codewords = [...data, ...remainder];
  const size = 37;
  const matrix = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const reserved = Array.from({ length: size }, () => Array<boolean>(size).fill(false));
  const set = (x: number, y: number, dark: boolean) => { matrix[y][x] = dark; reserved[y][x] = true; };
  for (let i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx, y = cy + dy, d = Math.max(Math.abs(dx), Math.abs(dy));
      if (x >= 0 && x < size && y >= 0 && y < size) set(x, y, d !== 2 && d !== 4);
    }
  }
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) set(30 + dx, 30 + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
  // BCH-protected format for ECC L (01), mask 000: 111011111000100.
  const format = 30660;
  const bit = (i: number) => ((format >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bit(i));
  set(8, 7, bit(6)); set(8, 8, bit(7)); set(7, 8, bit(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bit(i));
  set(8, size - 8, true);
  let index = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical++) for (let j = 0; j < 2; j++) {
      const x = right - j, y = ((right + 1) & 2) === 0 ? size - 1 - vertical : vertical;
      if (reserved[y][x]) continue;
      const dark = index < codewords.length * 8 && ((codewords[index >>> 3] >>> (7 - (index & 7))) & 1) !== 0;
      matrix[y][x] = dark !== ((x + y) % 2 === 0); index++;
    }
  }
  return matrix;
}
