import { describe, expect, it } from 'vitest'

import { applySuggestions, configToForm, formToConfig } from '@/lib/repo-form'
import { defaultPort, isStack, stackGroups, stackLabel, STACK_IDS } from '@/lib/stack'
import { validateRepoConfig } from '@/lib/validate'

describe('stack catalog', () => {
  it('offers the kinds, grouped', () => {
    expect(STACK_IDS).toEqual(['nodejs', 'express', 'nestjs', 'nextjs', 'python', 'fastapi', 'docker'])
    expect(stackGroups().map((g) => [g.label, g.stacks.map((s) => s.id)])).toEqual([
      ['Node.js / TypeScript', ['nodejs', 'express', 'nestjs', 'nextjs']],
      ['Python', ['python', 'fastapi']],
      ['Container', ['docker']],
    ])
  })
  it('knows what is in the catalog', () => {
    expect(isStack('express')).toBe(true)
    expect(isStack('')).toBe(false)
    expect(isStack('toString')).toBe(false) // not an inherited property
    expect(isStack(5)).toBe(false)
  })
  it('shows names, and unknown ids as they are', () => {
    expect(stackLabel('nextjs')).toBe('Next.js')
    expect(stackLabel('nodejs')).toBe('Node.js (raw)')
    expect(stackLabel('rails')).toBe('rails')
    expect(stackLabel(undefined)).toBe('')
  })
  it('has a usual port per kind', () => {
    expect([defaultPort('express'), defaultPort('fastapi'), defaultPort('docker'), defaultPort('?')]).toEqual([3000, 8000, 3000, 3000])
  })
})

describe('validateRepoConfig: stack', () => {
  it.each(['nodejs', 'express', 'nestjs', 'nextjs', 'python', 'fastapi', 'docker', ''])('accepts %j', (stack) => {
    expect(validateRepoConfig({ stack })).toEqual({ stack })
  })
  it('leaves it out when the config does not mention it', () => {
    expect(validateRepoConfig({ gates: ['x'] })).not.toHaveProperty('stack')
  })
  it.each([[{ stack: 'cobol' }], [{ stack: 5 }], [{ stack: ['express'] }], [{ stack: null }], [{ stack: 'toString' }]])(
    'rejects %j',
    (config) => expect(typeof validateRepoConfig(config)).toBe('string'),
  )
})

describe('repo form: stack', () => {
  it('round-trips the saved stack', () => {
    expect(formToConfig(configToForm({ stack: 'fastapi' })).stack).toBe('fastapi')
  })
  it('an old config without a stack means not set', () => {
    expect(configToForm({})).toMatchObject({ stack: '' })
    expect(formToConfig(configToForm({})).stack).toBe('')
  })
  const suggestions = { install: '', checks: [], test_cmd: '', start: '', app_url: '', env_names: [] }
  it('never sets the type from what was detected: it is only suggested', () => {
    expect(applySuggestions(configToForm({}), { ...suggestions, stack: 'python' })).toMatchObject({ stack: '' })
    expect(applySuggestions(configToForm({ stack: 'docker' }), { ...suggestions, stack: 'python' })).toMatchObject({ stack: 'docker' })
  })
  it('copes with a detected stack in the old shape and with none', () => {
    const old = { language: 'python', frameworks: ['fastapi'] }
    expect(applySuggestions(configToForm({}), { ...suggestions, stack: old })).toMatchObject({ stack: '' })
    expect(applySuggestions(configToForm({}), suggestions)).toMatchObject({ stack: '' })
  })
})
