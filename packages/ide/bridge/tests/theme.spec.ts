/** Theme map skeleton assertions. */
import { describe, expect, it } from 'vitest'
import { dshDarkTheme, DSH_DARK_TOKENS } from '../src/theme.ts'

describe('dshDarkTheme', () => {
  it('maps every shiki dark token onto a scope group', () => {
    const theme = dshDarkTheme() as { id: string; type: string; tokenColors: Array<{ settings: { foreground: string } }> }
    expect(theme.id).toBe('dsh-dark')
    expect(theme.type).toBe('dark')
    const colors = theme.tokenColors.map(group => group.settings.foreground)
    for (const value of Object.values(DSH_DARK_TOKENS)) expect(colors).toContain(value)
  })
})
