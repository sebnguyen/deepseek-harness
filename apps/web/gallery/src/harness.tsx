import { createElement, type ComponentType, type ReactNode } from 'react'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime/src/translate.ts'
import { en as chatEn } from '@deepseek-ai/dsh-client-ui-chat/src/client/locale.ts'
import { en as conversationEn } from '@deepseek-ai/dsh-client-ui-conversation/src/client/locales.ts'
import { en as commonEn } from '@deepseek-ai/dsh-client-locale/src/locales/en.ts'
import { en as goalEn } from '@deepseek-ai/dsh-client-ui-goal/src/client/locales.ts'
import { en as workflowEn } from '@deepseek-ai/dsh-client-ui-workflow-run/src/client/locales.ts'
import { BashRow } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/toolviews/bash-row.tsx'
import { ReadRow } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/toolviews/read-row.tsx'
import { ReadImageRow } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/toolviews/read-image-row.tsx'
import { FileMutationRow } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/toolviews/file-mutation-row.tsx'
import { SearchRow } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/toolviews/search-row.tsx'
import { WebRow } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/toolviews/web-row.tsx'
import { TodoRow } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/toolviews/todo-row.tsx'
import { AskQuestionRow } from '@deepseek-ai/dsh-client-ui-tool/src/client/tool/toolviews/ask-question-row.tsx'

export const t = makeTranslate(chatEn, conversationEn, goalEn, workflowEn, commonEn) as never

export const APP_CWD = '/home/demo/app'
export const APP_HOME = '/home/demo'

let sequence = 1
let callSequence = 1

/** One final Chat node with a stable key and anchor. */
export function node(kind: string, data: unknown, location: unknown = { kind: 'unresolved' }): never {
  const id = String(sequence)
  const anchorSeq = sequence
  sequence += 1
  return {
    key: `gallery:${kind}:${id}`,
    kind,
    id,
    target: 'chat',
    anchorSeq,
    location,
    visibility: 'visible',
    data,
  } as never
}

export function userMessage(text: string, time = Date.now()): never {
  return node('user', {
    kind: 'user',
    seq: sequence,
    time,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

export function steeringMessage(text: string, time = Date.now()): never {
  return node('steering', {
    kind: 'steering',
    messageId: `steering-${sequence}`,
    seq: sequence,
    time,
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  })
}

export function assistantMessage(
  text: string,
  status: 'running' | 'settled' | 'interrupted' = 'settled',
  kind: 'assistant-step-message' | 'assistant-step-reason' = 'assistant-step-message',
): never {
  const block = kind === 'assistant-step-reason'
    ? { kind: 'reasoning' as const, text }
    : { kind: 'text' as const, text }
  return node(kind, {
    status,
    turn: 1,
    step: 1,
    blocks: [block],
    time: Date.now(),
  })
}

export function contextMessage(form: string | null, label: string | null, text: string): never {
  return node('context', {
    kind: 'context',
    seq: sequence,
    time: Date.now(),
    content: [{ type: 'text', text }],
    source: { kind: form ?? 'opaque' },
    provenance: { role: 'inject', label },
    form,
  })
}

export function commandNode(
  name: string,
  outcome: { kind: 'success' | 'error'; text?: string } | null = { kind: 'success', text: 'Done.' },
): never {
  return node('command', {
    kind: 'command',
    seq: sequence,
    time: Date.now(),
    commandId: `command-${sequence}`,
    name,
    args: '',
    outcome,
  })
}

export function toolResult(
  name: string,
  argsRaw: string,
  text: string,
  overrides: Record<string, unknown> = {},
): never {
  const seq = sequence
  callSequence += 1
  return node('tool-call', {
    root: {
      kind: 'tool-result',
      seq,
      time: Date.now(),
      callId: `call-${callSequence}`,
      call: { name, argsRaw },
      callTime: Date.now() - 1_200,
      content: [{ type: 'text', text }],
      isError: false,
      subCalls: [],
      ...overrides,
    },
  })
}

export function runningTool(
  name: string,
  argsRaw: string,
  subCalls: unknown[] = [],
): never {
  callSequence += 1
  return node('tool-call', {
    root: {
      callId: `call-${callSequence}`,
      name,
      argsRaw,
      turn: 1,
      step: 1,
      time: Date.now(),
      subCalls,
    },
  })
}

export function toolNode(root: unknown): never {
  return node('tool-call', { root })
}

export const resultBlock = (name: string, argsRaw: string, text: string, overrides: Record<string, unknown> = {}) => ({
  kind: 'tool-result' as const,
  seq: sequence,
  time: Date.now(),
  callId: `call-${++callSequence}`,
  call: { name, argsRaw },
  callTime: Date.now() - 1_200,
  content: [{ type: 'text', text }],
  isError: false,
  subCalls: [],
  ...overrides,
})

export const runningBlock = (name: string, argsRaw: string, subCalls: unknown[] = []) => ({
  callId: `call-${++callSequence}`,
  name,
  argsRaw,
  turn: 1,
  step: 1,
  time: Date.now(),
  subCalls,
})

const toolViews: Record<string, ComponentType<Record<string, unknown>>> = {
  bash: BashRow,
  multi_bash: BashRow,
  read: ReadRow,
  multi_read: ReadRow,
  read_image: ReadImageRow,
  write: FileMutationRow,
  edit: FileMutationRow,
  multi_write: FileMutationRow,
  grep: SearchRow,
  glob: SearchRow,
  web_search: WebRow,
  web_fetch: WebRow,
  todo_write: TodoRow,
  ask_user_question: AskQuestionRow,
}

export const baseProps = {
  t,
  sessionId: 'gallery-session',
  cwd: APP_CWD,
  openFile: () => Promise.resolve(),
  openSkill: () => {},
  inspectCall: () => {},
  revealFile: () => {},
  loadImage: () => Promise.resolve(undefined),
  renderMessageImages: () => null,
  fileMentions: () => undefined,
  useProjection: () => undefined,
  useTurnData: () => undefined,
  useHostInfo: (selector: (info: { home: string }) => unknown) => selector({ home: APP_HOME }),
  useSessions: (selector: (state: { byId: Record<string, { cwd: string }> }) => unknown) => selector({
    byId: { 'gallery-session': { cwd: APP_CWD } },
  }),
  openSession: () => {},
  useSession: (selector: (state: Record<string, unknown>) => unknown) => selector({
    sessionId: 'gallery-session',
    running: false,
    blank: false,
  }),
} as never

/** The one dispatcher the real Tool slot would use, with the repository's keyed views. */
export function renderToolSlot(
  key: string,
  owner: Record<string, unknown>,
  opts?: { fallback?: ReactNode },
): ReactNode {
  if (key === 'tool.call.toolview') {
    const View = toolViews[String(owner.toolName)]
    if (View !== undefined) {
      return createElement(View as never, { ...baseProps, ...owner, renderSlot: renderToolSlot as never })
    }
  }
  if (key === 'tool.call.images') return null
  return opts?.fallback ?? null
}
