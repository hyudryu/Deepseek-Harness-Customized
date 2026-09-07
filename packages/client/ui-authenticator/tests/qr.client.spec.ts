/** Real QR module pixels decode into TOTP provisioning URIs without a network service. */
import { describe, expect, it } from 'vitest'
import QRCode from 'qrcode'
import { decodeAuthenticatorQr } from '../src/client/qr.ts'
function pixels(text: string) {
  const modules = QRCode.create(text).modules
  const scale = 4
  const width = (modules.size + 8) * scale
  const rgba = new Uint8ClampedArray(width * width * 4).fill(255)
  for (let y = 0; y < width; y++) for (let x = 0; x < width; x++) {
    const row = Math.floor(y / scale) - 4
    const col = Math.floor(x / scale) - 4
    const black = row >= 0 && col >= 0 && row < modules.size && col < modules.size && modules.get(row, col)
    const offset = (y * width + x) * 4
    if (black) { rgba[offset] = 0; rgba[offset + 1] = 0; rgba[offset + 2] = 0 }
  }
  return { rgba, width }
}
describe('authenticator QR decoding', () => {
  it('decodes an actual generated authenticator QR', () => {
    const uri = 'otpauth://totp/Example:alice?secret=JBSWY3DPEHPK3PXP&issuer=Example'
    const image = pixels(uri)
    expect(decodeAuthenticatorQr(image.rgba, image.width, image.width)).toBe(uri)
  })
  it.each(['https://example.com', 'otpauth://hotp/Example?secret=JBSWY3DPEHPK3PXP&counter=0'])('rejects unsupported QR content %s', (text) => {
    const image = pixels(text)
    expect(() => decodeAuthenticatorQr(image.rgba, image.width, image.width)).toThrow('invalid-qr')
  })
  it('rejects an image without a QR', () => {
    expect(() => decodeAuthenticatorQr(new Uint8ClampedArray(64 * 64 * 4).fill(255), 64, 64)).toThrow('invalid-qr')
  })
})
