/** Localized desktop pairing controls. */
export const en = {
  title: 'Mobile access', close: 'Close mobile access', enabled: 'Allow mobile access',
  description: 'Connect your phone to the same Tailscale network, then scan this code.',
  off: 'Mobile access is off. Turning it on creates a private Tailscale link.',
  restart: 'Mobile access turns off when Harness restarts.',
  qr: 'Scan to open Harness on your phone', link: 'Open mobile link',
  loading: 'Loading mobile access…', pending: 'Updating mobile access…',
  error: 'Mobile access could not be updated. Check that Tailscale is running and try again.',
  qrError: 'The QR code could not be generated. Use the mobile link below.',
} satisfies Record<string, string>
/** Keys shared by the mobile access dictionaries. */
export type MobileAccessKey = keyof typeof en
/** Simplified Chinese pairing controls. */
export const zh = {
  title: '手机访问', close: '关闭手机访问', enabled: '允许手机访问',
  description: '将手机连接到同一个 Tailscale 网络，然后扫描二维码。',
  off: '手机访问已关闭。开启后将创建私有 Tailscale 链接。',
  restart: 'Harness 重启后会关闭手机访问。',
  qr: '扫描以在手机上打开 Harness', link: '打开手机链接',
  loading: '正在加载手机访问…', pending: '正在更新手机访问…',
  error: '无法更新手机访问。请检查 Tailscale 是否运行后重试。',
  qrError: '无法生成二维码。请使用下方的手机链接。',
} satisfies Record<MobileAccessKey, string>
