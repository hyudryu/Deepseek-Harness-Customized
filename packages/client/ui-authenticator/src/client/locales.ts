/** Authenticator configuration labels. */
export const en = {
  title: 'Authenticator MCP',
  description: 'Import authenticator QR codes and share current verification codes with session agents.',
  import: 'Import QR code',
  empty: 'No authenticator accounts saved.',
  remove: 'Delete',
  confirm: 'Delete this authenticator account?',
  cancel: 'Cancel',
  loading: 'Loading accounts…',
  invalidQr: 'Choose a PNG, JPEG, or WebP image containing an authenticator QR code (up to 8 MB).',
  failed: 'Could not update authenticator accounts. Please try again.',
  invalidRequest: 'The request was not accepted. Please refresh and try again.',
  invalidProvisioning: 'This QR code does not contain valid authenticator account details.',
  unsupportedProvisioning: 'This authenticator format is not supported. Import a standard six-digit TOTP QR code.',
  duplicateAccount: 'This authenticator account is already saved.',
  accountNotFound: 'This authenticator account no longer exists. Refresh the account list.',
  expires: 'seconds remaining',
  expired: 'Expired',
  imported: 'Authenticator account added.',
  deleted: 'Authenticator account deleted.',
} as const

/** Authenticator locale keys. */
export type AuthenticatorKey = keyof typeof en

/** Chinese authenticator configuration labels. */
export const zh: Record<AuthenticatorKey, string> = {
  invalidRequest: '请求未被接受。请刷新后重试。',
  invalidProvisioning: '此二维码不包含有效的验证器账户信息。',
  unsupportedProvisioning: '不支持此验证器格式。请导入标准六位 TOTP 二维码。',
  duplicateAccount: '此验证器账户已保存。',
  accountNotFound: '此验证器账户已不存在。请刷新账户列表。',
  title: '身份验证器 MCP',
  description: '导入身份验证器二维码，并向会话代理提供当前验证码。',
  import: '导入二维码',
  empty: '尚未保存身份验证器账户。',
  remove: '删除',
  confirm: '删除此身份验证器账户？',
  cancel: '取消',
  loading: '正在加载账户…',
  invalidQr: '请选择包含身份验证器二维码的 PNG、JPEG 或 WebP 图片（最大 8 MB）。',
  failed: '无法更新身份验证器账户，请重试。',
  expires: '秒后过期',
  expired: '已过期',
  imported: '已添加身份验证器账户。',
  deleted: '已删除身份验证器账户。',
}
