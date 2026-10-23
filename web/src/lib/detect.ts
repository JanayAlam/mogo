import type { Suggestions } from '@/lib/projects'

/**
 * Reads a repo's own root files and suggests what the settings page needs: the Docker files (and the port a Dockerfile
 * exposes), the variable names in .env.example and the convention files (CLAUDE.md, ...). The same detection as the runner's (backend/mogo/profile/detect.py),
 * so a repo can be read straight from GitHub by the web app without starting the runner.
 *
 * The two must agree: backend/tests/data/detect_cases.json holds repos and what the Python detection makes of them,
 * and web/tests/detect.test.ts checks this one against it. Change one, change the other, regenerate the file
 * (PYTHONPATH=. python tests/regen_detect_cases.py in backend/).
 */
export const ENV_EXAMPLES = ['.env.example', '.env.sample', '.env.template', '.env.dist']
/** The root files `detect` may read. */
export const DETECT_FILES = ['Dockerfile', ...ENV_EXAMPLES]

/** The files a team or an agent keeps its rules in, in the order the runner reads them (backend/mogo/profile/detect.py). */
export const CONVENTION_FILES = ['CLAUDE.md', 'AGENTS.md', 'GEMINI.md', '.cursorrules', '.windsurfrules', 'CONVENTIONS.md', 'CONTRIBUTING.md']

const COMPOSE_NAMES = ['compose.yaml', 'compose.yml', 'docker-compose.yaml', 'docker-compose.yml']

export type Read = (name: string) => string | undefined

export function envNames(text: string): string[] {
  const names: string[] = []
  for (const line of text.split(/\r\n|\r|\n/)) {
    const m = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line)
    if (m && !names.includes(m[1])) names.push(m[1])
  }
  return names
}

/** The root Docker files: the default Dockerfile (and its first EXPOSE port, 0 when none), every Dockerfile-like name and Compose file. */
export function detectDocker(names: Set<string>, read: Read) {
  const sorted = [...names].sort()
  const dockerfile = names.has('Dockerfile')
  const expose = dockerfile ? /^\s*EXPOSE\s+(\d{1,5})/im.exec(read('Dockerfile') ?? '') : null
  return {
    dockerfile,
    docker_port: expose ? Number(expose[1]) : 0,
    dockerfiles: sorted.filter((n) => n === 'Dockerfile' || n.startsWith('Dockerfile.') || n.endsWith('.Dockerfile')),
    compose_files: sorted.filter((n) => COMPOSE_NAMES.includes(n) || /^(docker-)?compose[.-].+\.ya?ml$/.test(n)),
  }
}

/** The known convention files at the root, and every other root .md file for the repo page to offer. */
export function detectConventions(names: Set<string>) {
  return {
    convention_files: CONVENTION_FILES.filter((n) => names.has(n)),
    markdown_files: [...names].filter((n) => n.endsWith('.md') && !CONVENTION_FILES.includes(n)).sort(),
  }
}

type Detected = Required<Pick<Suggestions, 'env_names'>> & ReturnType<typeof detectDocker> & ReturnType<typeof detectConventions>

/** Suggested settings. `names` are the file names at the repo root, `read(name)` returns a root file's text. */
export function detect(names: Set<string>, read: Read): Detected {
  const envFile = ENV_EXAMPLES.find((n) => names.has(n))
  return { env_names: envNames(envFile ? (read(envFile) ?? '') : ''), ...detectDocker(names, read), ...detectConventions(names) }
}
