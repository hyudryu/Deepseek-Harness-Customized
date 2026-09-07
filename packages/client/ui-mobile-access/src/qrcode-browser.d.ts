/** The browser entry exposes only canvas and SVG rendering, without Node filesystem exports. */
declare module 'qrcode/lib/browser.js' {
  import type { toDataURL } from 'qrcode'
  const QRCode: { toDataURL: typeof toDataURL }
  export default QRCode
}
