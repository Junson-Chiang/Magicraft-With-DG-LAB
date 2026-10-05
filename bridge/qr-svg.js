import QRCode from 'qrcode-terminal/vendor/QRCode/index.js';
import QRErrorCorrectLevel from 'qrcode-terminal/vendor/QRCode/QRErrorCorrectLevel.js';
export function pairingSvg(url) {
  if (!url) return '';
  const qr = new QRCode(-1, QRErrorCorrectLevel.L);
  qr.addData(url); qr.make();
  const n = qr.getModuleCount(), size = n + 8;
  let path = '';
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++)
    if (qr.isDark(y, x)) path += `M${x + 4},${y + 4}h1v1h-1z`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" role="img" aria-label="DG-LAB APP 配对二维码" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="white"/><path d="${path}" fill="black"/></svg>`;
}
