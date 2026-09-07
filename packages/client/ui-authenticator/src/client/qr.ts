/** Decode provisioning QR images locally; image bytes are never uploaded. */
import jsQR from 'jsqr'

/**
 * Decode one standard authenticator provisioning URI from RGBA pixels.
 * @param pixels - RGBA pixels in row order.
 * @param width - image width.
 * @param height - image height.
 * @returns the provisioning URI, or throws for unsupported QR content.
 */
export function decodeAuthenticatorQr(pixels: Uint8ClampedArray, width: number, height: number): string {
  const result = jsQR(pixels, width, height)
  if (result === null || !result.data.startsWith('otpauth://totp/')) throw new Error('invalid-qr')
  return result.data
}

/**
 * Read a user-selected QR image and discard its object URL after decoding.
 * @param file - PNG, JPEG, or WebP image, limited to 8 MB.
 * @returns the decoded provisioning URI.
 */
export async function readAuthenticatorQr(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 8 * 1024 * 1024) {
    throw new Error('invalid-qr')
  }
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => { resolve() }
      image.onerror = () => { reject(new Error('invalid-qr')) }
      image.src = url
    })
    const scale = Math.min(1, 2048 / Math.max(image.naturalWidth, image.naturalHeight))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale))
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale))
    const context = canvas.getContext('2d')
    if (context === null) throw new Error('invalid-qr')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)
    return decodeAuthenticatorQr(context.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)
  } finally { URL.revokeObjectURL(url) }
}
