#!/usr/bin/env node
/**
 * Print which delta fields an OpenAI-compatible chat stream emits (reasoning vs answer).
 *
 * Usage:
 *   DO_INFERENCE_API_KEY=... node scripts/diagnose-llm-stream-delta.mjs \
 *     --base-url https://inference.do-ai.run/v1 \
 *     --model deepseek-v4-pro-0813
 *
 * Options:
 *   --base-url <url>   API root including /v1 (default: $LLM_BASE_URL or DO inference)
 *   --model <id>       Model id (default: deepseek-v4-pro-0813)
 *   --api-key-env <n>  Env var for bearer token (default: DO_INFERENCE_API_KEY)
 *   --max-chunks <n>   Stop after N SSE data lines (default: 40)
 */

import { parseArgs } from 'node:util'

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    model: { type: 'string', default: 'deepseek-v4-pro-0813' },
    'api-key-env': { type: 'string', default: 'DO_INFERENCE_API_KEY' },
    'max-chunks': { type: 'string', default: '40' },
  },
})

const apiKeyEnv = values['api-key-env']
const apiKey = process.env[apiKeyEnv]
if (!apiKey) {
  console.error(`diagnose-llm-stream-delta: set ${apiKeyEnv}`)
  process.exit(1)
}

const baseURL = (values['base-url'] ?? process.env.LLM_BASE_URL ?? 'https://inference.do-ai.run/v1').replace(/\/$/, '')
const model = values.model
const maxChunks = Number(values['max-chunks'])
if (!Number.isInteger(maxChunks) || maxChunks <= 0) {
  console.error('diagnose-llm-stream-delta: --max-chunks must be a positive integer')
  process.exit(1)
}

const url = `${baseURL}/chat/completions`
const response = await fetch(url, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model,
    stream: true,
    max_tokens: 256,
    messages: [{ role: 'user', content: 'Reply with one short sentence. Think briefly first if the model supports it.' }],
  }),
})

if (!response.ok) {
  const body = await response.text()
  console.error(`HTTP ${response.status}: ${body}`)
  process.exit(1)
}

const deltaKeys = new Set()
const sampleDeltas = []
let chunks = 0
let buffer = ''
const reader = response.body.getReader()
const decoder = new TextDecoder()

while (chunks < maxChunks) {
  const { done, value } = await reader.read()
  if (done) break
  buffer += decoder.decode(value, { stream: true })
  let newline = buffer.indexOf('\n')
  while (newline !== -1) {
    const raw = buffer.slice(0, newline)
    buffer = buffer.slice(newline + 1)
    newline = buffer.indexOf('\n')
    const trimmed = raw.trim()
    if (!trimmed.startsWith('data:')) continue
    const payload = trimmed.slice(5).trim()
    if (payload === '[DONE]') continue
    chunks += 1
    try {
      const json = JSON.parse(payload)
      const delta = json?.choices?.[0]?.delta
      if (delta && typeof delta === 'object') {
        for (const key of Object.keys(delta)) deltaKeys.add(key)
        if (sampleDeltas.length < 5) sampleDeltas.push(delta)
      }
    } catch {
      // ignore non-JSON lines
    }
    if (chunks >= maxChunks) break
  }
}
await reader.cancel().catch(() => { })

console.log(`model: ${model}`)
console.log(`baseURL: ${baseURL}`)
console.log(`SSE data chunks read: ${chunks}`)
console.log(`delta keys seen: ${[...deltaKeys].sort().join(', ') || '(none)'}`)
console.log('sample deltas:')
for (const delta of sampleDeltas) console.log(JSON.stringify(delta))
