import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { detect, envNames } from '@/lib/detect'

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
  it('has the cases', () => expect(cases.length).toBeGreaterThan(5))
  it.each(cases.map((c) => [c.name, c] as const))('%s', (_name, c) => {
    expect(run(c.files)).toEqual(c.expected)
  })
})

describe('pieces', () => {
  it('env names: first occurrence, export and spaces, no comments, any line ending', () => {
    expect(envNames('A=1\r\nexport B = 2\r\n# C=3\r\n  D=4\r\nA=9\r\n')).toEqual(['A', 'B', 'D'])
  })
  it('Docker files: the default Dockerfile and its port, every Dockerfile and Compose name', () => {
    const files = { Dockerfile: 'FROM x\nEXPOSE 8080', 'Dockerfile.dev': '', 'compose.yml': '', 'docker-compose.prod.yaml': '', 'compose.txt': '' }
    expect(run(files)).toEqual({
      env_names: [], dockerfile: true, docker_port: 8080,
      dockerfiles: ['Dockerfile', 'Dockerfile.dev'], compose_files: ['compose.yml', 'docker-compose.prod.yaml'],
    })
  })
  it('nothing recognised: nothing suggested', () => {
    expect(run({ 'README.md': '' })).toEqual({ env_names: [], dockerfile: false, docker_port: 0, dockerfiles: [], compose_files: [] })
  })
})
