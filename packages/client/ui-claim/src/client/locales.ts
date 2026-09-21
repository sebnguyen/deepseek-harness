/** `claim` namespace dictionaries. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'claim'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'chip.pending': '核验声明中',
  'chip.passed': '声明已通过',
  'chip.tampered': '声明被篡改',
  'chip.blocked': '声明未通过',
  'dock.label': '声明',
  'detail.title': '标题',
  'detail.description': '描述',
  'detail.script': '核验脚本',
  'detail.blocked': '未通过原因',
  'detail.lastRun': '最近核验',
  'verifier.pass': '通过',
  'verifier.fail': '失败',
  'verifier.inconclusive': '未得出结论',
  'verifier.tampered': '输入被篡改',
  'verifier.none': '尚未执行',
}

/** English dictionary (same key set). */
export const en: Record<ClaimKey, string> = {
  'chip.pending': 'Verifying claim',
  'chip.passed': 'Claim passed',
  'chip.tampered': 'Claim tampered',
  'chip.blocked': 'Claim failed',
  'dock.label': 'Claims',
  'detail.title': 'Title',
  'detail.description': 'Description',
  'detail.script': 'Verifier script',
  'detail.blocked': 'Why it failed',
  'detail.lastRun': 'Last verifier run',
  'verifier.pass': 'passed',
  'verifier.fail': 'failed',
  'verifier.inconclusive': 'inconclusive',
  'verifier.tampered': 'tampered',
  'verifier.none': 'not run yet',
}

/** Union of this namespace's dictionary keys. */
export type ClaimKey = keyof typeof zh
