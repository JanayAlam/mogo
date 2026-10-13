import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { detect, detectStack, envNames, installCommand } from '@/lib/detect'

/**
 * The detection here must give what the runner's (backend/mogo/profile/detect.py) gives. Both are checked against
 * backend/tests/data/detect_cases.json, which the Python side generates.
 */
interface Case {
  name: string
  files: Record<string, string>
  expected: unknown
}
const cases: Case[] = JSON.parse(readFileSync(join(__dirname, '../../backend/tests/data/detect_cases.json'), 'utf8'))
const run = (files: Record<string, string>) => detect(new Set(Object.keys(files)), (n) => files[n])

describe('detection agrees with the runner on the shared repos', () => {
  it('has the cases', () => expect(cases.length).toBeGreaterThan(30))
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(run(c.files)).toEqual(c.expected)
  })
})

describe('pieces', () => {
  it('install commands', () => {
    expect(installCommand(new Set(['package.json', 'pnpm-lock.yaml']))).toBe('corepack enable && pnpm install --frozen-lockfile')
    expect(installCommand(new Set(['pyproject.toml', 'uv.lock']))).toBe('uv sync')
    expect(installCommand(new Set(['README.md']))).toBe('')
  })
  it('env names: first occurrence, export and spaces, no comments, any line ending', () => {
    expect(envNames('A=1\r\nexport B = 2\r\n# C=3\r\n  D=4\r\nA=9\r\n')).toEqual(['A', 'B', 'D'])
  })
  it('the stack of a bare package.json is Node.js, of nothing is nothing', () => {
    expect(detectStack(new Set(['package.json']), () => '{}')).toBe('nodejs')
    expect(detectStack(new Set(['README.md']), () => undefined)).toBe('')
  })
})
