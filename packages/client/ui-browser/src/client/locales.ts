/** Browser panel copy, one per locale; zh is the source of truth for keys. */

export const NS = 'browser'

/** Chinese browser panel dictionary. */
export const zh = {
  chromeInteraction: '\u8bf7\u5728 Chrome \u7a97\u53e3\u4e2d\u767b\u5f55\u6216\u64cd\u4f5c\u6b64\u9875\u9762\u3002',
  tabs: '\u6807\u7b7e\u9875',
  newTab: '\u65b0\u5efa\u6807\u7b7e\u9875',
  closeTab: '\u5173\u95ed\u6807\u7b7e\u9875',
  untitledTab: '\u65e0\u6807\u9898',
  address: '\u7f51\u5740',
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
  chromeInteraction: 'Use the Chrome window to sign in or interact with this page.',
  tabs: 'Browser tabs',
  newTab: 'New tab',
  closeTab: 'Close tab',
  untitledTab: 'Untitled tab',
  address: 'Address',
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
