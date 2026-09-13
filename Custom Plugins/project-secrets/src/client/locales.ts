/** The project-secrets namespace dictionaries (en/zh). */
export const en = {
  menuLabel: 'Project Secrets',
  title: 'Project Secrets',
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  placeholder: 'Paste project secrets here (username/password, tokens, etc.)',
} as const

export const zh = {
  menuLabel: '项目密钥',
  title: '项目密钥',
  save: '保存',
  cancel: '取消',
  close: '关闭',
  placeholder: '在此粘贴项目密钥（用户名/密码、令牌等）',
} as const

/** The key union over this feature's own dictionary (commen vocabulary is looked up separately). */
export type ProjectSecretsKey = keyof typeof en
