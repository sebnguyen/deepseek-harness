/** Chat-owned approval detail resolving a correlated Tool call's command. */
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-approval/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

interface ApprovalToolCall {
  readonly callId: string
  readonly argsRaw: string
}

/**
 * Extract a shell command from a correlated Tool call when its arguments carry
 * one: the singular face carries it at the root, the `commands` batch face at
 * its first element with a command string.
 * @param call - Tool call arguments, when a correlated call exists.
 * @returns command text, or undefined for absent, malformed, or unrelated arguments.
 */
export function commandOf(call: ApprovalToolCall | undefined): string | undefined {
  if (call === undefined) return undefined
  try {
    const args = JSON.parse(call.argsRaw) as Record<string, unknown>
    if (typeof args.command === 'string') return args.command
    if (!Array.isArray(args.commands)) return undefined
    for (const element of args.commands) {
      if (typeof element === 'object' && element !== null
        && typeof (element as { command?: unknown }).command === 'string') {
        return (element as { command: string }).command
      }
    }
    return undefined
  } catch {
    return undefined
  }
}

/**
 * Render the command of the Chat Tool node correlated with an approval.
 * @param props - Approval identity and Session-standard Chat selector hook.
 * @returns command text when the correlated call carries one.
 */
export function ApprovalCommand({ callId, useChat }: PropsRuntime<'conversation.approval.detail'>) {
  const command = useChat((snapshot) => {
    for (const node of snapshot.nodes.values()) {
      const root = node.kind === 'tool-call' ? (node as ChatNode<'tool-call'>).data.root : undefined
      if (root !== undefined && root.callId === callId && !('kind' in root)) return commandOf(root)
    }
    return undefined
  })
  return command ?? null
}
