import { describe, expect, it } from 'vitest'

import { parseEnv } from '@/lib/dotenv'

const FILE = `﻿# antrotrip-server
NODE_ENV=development
export PORT=8000
DATABASE_URL="postgres://u:p#ss@db:5432/dev?sslmode=require"
LOG_LEVEL=debug # inline comment
JWT_SECRET='lit\\eral $value'
GREETING="line1\\nline2 \\"quoted\\""
PRIVATE_KEY="-----BEGIN KEY-----
abc
-----END KEY-----"
EMPTY=
   SPACED  =  padded value
URL=http://x/#anchor
bad line
1BAD=x
PORT=9000
OPEN="never closed
`

describe('parseEnv', () => {
  const { entries, problems } = parseEnv(FILE)
  const get = (n: string) => entries.find((e) => e.name === n)?.value

  it('reads plain, exported, quoted and commented values', () => {
    expect(get('NODE_ENV')).toBe('development')
    expect(get('DATABASE_URL')).toBe('postgres://u:p#ss@db:5432/dev?sslmode=require')
    expect(get('LOG_LEVEL')).toBe('debug')
    expect(get('JWT_SECRET')).toBe('lit\\eral $value')
    expect(get('GREETING')).toBe('line1\nline2 "quoted"')
    expect(get('SPACED')).toBe('padded value')
    expect(get('URL')).toBe('http://x/#anchor') // '#' without a space before it is part of the value
  })
  it('joins multi-line quoted values', () => {
    expect(get('PRIVATE_KEY')).toBe('-----BEGIN KEY-----\nabc\n-----END KEY-----')
  })
  it('keeps the last value of a repeated name', () => {
    expect(get('PORT')).toBe('9000')
    expect(entries.filter((e) => e.name === 'PORT')).toHaveLength(1)
  })
  it('reports problems by line number, never with the value', () => {
    expect(problems).toEqual([
      { line: 11, reason: 'EMPTY is empty' },
      { line: 14, reason: 'not NAME=value' },
      { line: 15, reason: 'not NAME=value' },
      { line: 17, reason: 'quote is never closed' },
    ])
    expect(JSON.stringify(problems)).not.toMatch(/bad line|1BAD|\"never/)
  })
  it('handles CRLF and an empty file', () => {
    expect(parseEnv('A=1\r\nB=2\r\n').entries.map((e) => [e.name, e.value])).toEqual([['A', '1'], ['B', '2']])
    expect(parseEnv('')).toEqual({ entries: [], problems: [] })
  })
})
