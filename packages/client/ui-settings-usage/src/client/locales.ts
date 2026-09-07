/** Usage dashboard copy, including accessible chart and unit labels. */
export const en = {
  nav: 'Usage', title: 'Usage stats', subtitle: 'Token activity across your saved sessions',
  refresh: 'Refresh', loading: 'Loading usage…', error: 'Could not load usage. Try refreshing.',
  empty: 'No recorded token usage yet. Start a conversation to see your activity here.',
  total: 'Total tokens', peak: 'Peak daily tokens', longestSession: 'Longest session',
  currentStreak: 'Current streak', longestStreak: 'Longest streak',
  activity: 'Token activity', activityData: 'Activity data', date: 'Date', daily: 'Daily', weekly: 'Weekly', cumulative: 'Cumulative',
  range: 'Time range', seven: 'Last 7 days', thirty: 'Last 30 days',
  trend: 'Daily token trend', models: 'Model usage', tokens: 'tokens', days: 'd',
  hours: 'h', minutes: 'm', less: 'Less', more: 'More', utc: 'Dates use UTC. Tokens include input and output.',
  missing: 'Some recorded requests did not report token usage and are excluded.',
  noRange: 'No token usage in this time range.', language: 'en',
  unknownModel: 'Unknown model', unknownProvider: 'Unknown provider',
} satisfies Record<string, string>

/** Keys owned by the usage settings namespace. */
export type UsageKey = keyof typeof en

/** Simplified Chinese translations with the same complete key set. */
export const zh = {
  nav: '用量', title: '用量统计', subtitle: '已保存会话的令牌使用情况',
  refresh: '刷新', loading: '正在加载用量…', error: '无法加载用量，请刷新重试。',
  empty: '尚无令牌用量记录。开始对话后即可在此查看活动。',
  total: '令牌总数', peak: '单日令牌峰值', longestSession: '最长会话',
  currentStreak: '当前连续天数', longestStreak: '最长连续天数',
  activity: '令牌活动', activityData: '活动数据', date: '日期', daily: '每日', weekly: '每周', cumulative: '累计',
  range: '时间范围', seven: '最近 7 天', thirty: '最近 30 天',
  trend: '每日令牌趋势', models: '模型用量', tokens: '令牌', days: '天',
  hours: '小时', minutes: '分钟', less: '少', more: '多', utc: '日期使用 UTC。令牌包含输入和输出。',
  missing: '部分已记录的请求未报告令牌用量，未计入统计。',
  noRange: '此时间范围内没有令牌用量。', language: 'zh-CN',
  unknownModel: '未知模型', unknownProvider: '未知提供方',
} satisfies Record<UsageKey, string>
