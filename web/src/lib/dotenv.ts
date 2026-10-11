/**
 * Parses a .env file. Runs in the browser (preview) and on the server (import), so it has no dependencies.
 *
 * NAME=value, optional `export`, # comments, inline " #" comments on unquoted values, 'single' (literal) and
 * "double" quotes (\n \r \t \" \\ escapes); quoted values may span lines. A name given twice keeps the last value.
 * Problems are reported by line number only: the line itself may hold a secret.
 */
export interface EnvEntry {
  name: string
  value: string
  line: number
}

export interface EnvProblem {
  line: number
  reason: string
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/
const ESCAPES: Record<string, string> = { n: '\n', r: '\r', t: '\t', '"': '"', '\\': '\\' }

export function parseEnv(text: string): { entries: EnvEntry[]; problems: EnvProblem[] } {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/)
  const found = new Map<string, EnvEntry>()
  const problems: EnvProblem[] = []

  for (let i = 0; i < lines.length; i++) {
    const lineNo = i + 1
    const raw = lines[i].trim()
    if (!raw || raw.startsWith('#')) continue
    const body = raw.replace(/^export\s+/, '')
    const eq = body.indexOf('=')
    const name = eq > 0 ? body.slice(0, eq).trim() : ''
    if (!NAME.test(name)) {
      problems.push({ line: lineNo, reason: 'not NAME=value' })
      continue
    }
    let rest = body.slice(eq + 1).trimStart()
    let value: string

    const quote = rest[0]
    if (quote === '"' || quote === "'") {
      // Collect until the closing quote, across lines if needed.
      let buf = rest.slice(1)
      let close = findClose(buf, quote)
      while (close === -1 && i + 1 < lines.length) {
        i++
        buf += '\n' + lines[i]
        close = findClose(buf, quote)
      }
      if (close === -1) {
        problems.push({ line: lineNo, reason: 'quote is never closed' })
        continue
      }
      value = buf.slice(0, close)
      if (quote === '"') value = value.replace(/\\([nrt"\\])/g, (_m, c: string) => ESCAPES[c])
      rest = buf.slice(close + 1).trim()
      if (rest && !rest.startsWith('#')) {
        problems.push({ line: lineNo, reason: 'text after the closing quote' })
        continue
      }
    } else {
      value = rest.replace(/\s+#.*$/, '').trim()
    }

    if (!value) {
      problems.push({ line: lineNo, reason: `${name} is empty` })
      continue
    }
    found.set(name, { name, value, line: lineNo })
  }
  return { entries: [...found.values()], problems }
}

function findClose(s: string, quote: string): number {
  for (let i = 0; i < s.length; i++) {
    if (quote === '"' && s[i] === '\\') {
      i++
      continue
    }
    if (s[i] === quote) return i
  }
  return -1
}
