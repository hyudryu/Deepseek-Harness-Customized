/** The project-system-prompt namespace dictionaries (en/zh). */
export const en = {
  menuLabel: 'System prompt override…',
  title: 'System prompt override',
  restore: 'Restore DeepSeek default',
  placeholder: 'Leave empty to use the DeepSeek Harness system prompt.',
  hint: 'Saving non-empty text replaces the entire system prompt for every session in this project. An empty field removes the override.',
  save: 'Save',
  cancel: 'Cancel',
  close: 'Close',
  loading: 'Loading…',
} as const

export const zh = {
  menuLabel: '系统提示词覆盖…',
  title: '系统提示词覆盖',
  restore: '恢复 DeepSeek 默认提示词',
  placeholder: '留空则使用 DeepSeek Harness 系统提示词。',
  hint: '保存非空文本会替换该项目中所有会话的完整系统提示词。留空并保存可移除覆盖。',
  save: '保存',
  cancel: '取消',
  close: '关闭',
  loading: '加载中…',
} as const

/** The key union over this feature's own dictionary. */
export type ProjectSystemPromptKey = keyof typeof en
