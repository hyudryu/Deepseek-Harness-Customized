/** Browser panel copy, one per locale; zh is the source of truth for keys. */

export const NS = 'browser'

/** Chinese browser panel dictionary. */
export const zh = {
  stop: '停止浏览器',
  panelTitle: '浏览器',
  start: '启动浏览器',
  navigate: '导航',
  closePanel: '关闭面板',
  closed: '点击“启动浏览器”为本会话启动一个浏览器实例。',
  actions: '操作',
  noActions: '暂无操作',
  statusOpen: '运行中',
  statusClosed: '未启动',
  errorStart: '启动浏览器失败',
  openUrlPlaceholder: '输入 URL（可选）',
  actionOk: '成功',
  actionFail: '失败',
  showActions: '显示操作',
  hideActions: '收起操作',
} as const

/** Keys shared by the browser panel dictionaries. */
export type BrowserKey = keyof typeof zh

/** English browser panel dictionary. */
export const en: Record<BrowserKey, string> = {
  stop: 'Stop browser',
  panelTitle: 'Browser',
  start: 'Start Browser',
  navigate: 'Navigate',
  closePanel: 'Close panel',
  closed: 'Click “Start Browser” to open a browser instance for this session.',
  actions: 'Actions',
  noActions: 'No actions yet',
  statusOpen: 'Running',
  statusClosed: 'Stopped',
  errorStart: 'Failed to start browser',
  openUrlPlaceholder: 'Enter URL (optional)',
  actionOk: 'ok',
  actionFail: 'failed',
  showActions: 'Show actions',
  hideActions: 'Hide actions',
}
