/** `contextWindow` namespace dictionaries for the Context Window tab. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'contextWindow'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'view.contextWindow': '上下文',
  'header.turn': '第 {turn} 轮',
  'header.usage': '{used} / {capacity} tokens',
  'header.cacheHit': '缓存命中 {percent}%',
  'header.turnPending': '第 {newestTurn} 轮尚未结算，显示第 {shownTurn} 轮的已结算上下文。',
  'header.cacheUnknown': '该轮次的缓存统计不完整（并非每次请求尝试都上报了缓存读取数），因此无法判断命中/未命中。',
  'role.system': '系统',
  'role.user': '用户',
  'role.assistant': '助手',
  'role.tool': '工具',
  'role.tools': '工具定义',
  'segment.hit': '缓存命中',
  'segment.miss': '缓存未命中',
  'segment.partial': '部分命中',
  'segment.unknown': '缓存状态未知',
  'empty.noRequest': '本会话尚无已结算的请求。',
  'empty.noComposition': '正在等待上下文组成数据…',
  'content.empty': '（无文本预览 — 图片、文件或空内容）',
  'content.notLoaded': '（尚未加载到本视图 — 正在加载更早的历史记录…）',
  'detail.role': '角色',
  'detail.tokens': 'Token 数',
  'detail.cacheClass': '缓存状态',
  'detail.close': '关闭',
  'disclaimer': '基于启发式 token 估算得出的近似构成；缓存命中/未命中的分界点是推断值,并非逐块的真实边界。',
} as const

/** The contextWindow dictionary key union. */
export type ContextWindowKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The Context Window tab's header, segment labels, and disclaimer copy. */
    contextWindow: ContextWindowKey
  }
}

/** English dictionary, checked complete against the Chinese source of truth. */
export const en: Record<ContextWindowKey, string> = {
  'view.contextWindow': 'Context',
  'header.turn': 'Turn {turn}',
  'header.usage': '{used} / {capacity} tokens',
  'header.cacheHit': '{percent}% cache hit',
  'header.turnPending': "Turn {newestTurn} hasn't settled yet — showing turn {shownTurn}'s context.",
  'header.cacheUnknown': "This turn's cache accounting is incomplete (not every request attempt reported a cache-read count), so hit/miss can't be determined.",
  'role.system': 'System',
  'role.user': 'User',
  'role.assistant': 'Assistant',
  'role.tool': 'Tool',
  'role.tools': 'Tool definitions',
  'segment.hit': 'Cache hit',
  'segment.miss': 'Cache miss',
  'segment.partial': 'Partial hit',
  'segment.unknown': 'Cache state unknown',
  'empty.noRequest': 'No settled request in this session yet.',
  'empty.noComposition': 'Waiting for context composition data…',
  'content.empty': '(no text preview — image, file, or empty content)',
  'content.notLoaded': '(not loaded in this view yet — loading earlier history…)',
  'detail.role': 'Role',
  'detail.tokens': 'Tokens',
  'detail.cacheClass': 'Cache state',
  'detail.close': 'Close',
  'disclaimer': 'Approximate composition from heuristic token estimates; the cache hit/miss cut point is inferred, not an exact per-block boundary.',
}
