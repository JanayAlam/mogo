/**
 * What kind of app a repo is: one pick per repo. It decides how the app is started, so each kind can carry its own
 * start configuration (`startPreset`). The ids are what is stored (repo config `stack`) and what the runner's
 * detection reports (backend/mogo/profile/detect.py `detect_stack`): change them in both places. Docker is never
 * detected: it is chosen, and needs a Dockerfile at the root of the repo.
 *
 * To support another kind, add it here (and teach detect_stack to recognise it, if it can be told from the files).
 */
export const STACKS = {
  nodejs: { label: 'Node.js (raw)', group: 'Node.js / TypeScript', port: 3000 },
  express: { label: 'Express', group: 'Node.js / TypeScript', port: 3000 },
  nestjs: { label: 'NestJS', group: 'Node.js / TypeScript', port: 3000 },
  nextjs: { label: 'Next.js', group: 'Node.js / TypeScript', port: 3000 },
  python: { label: 'Python (raw)', group: 'Python', port: 8000 },
  fastapi: { label: 'FastAPI', group: 'Python', port: 8000 },
  docker: { label: 'Docker', group: 'Container', port: 3000 },
} as const satisfies Record<string, { label: string; group: string; port: number }>

export type Stack = keyof typeof STACKS

export const isStack = (v: unknown): v is Stack => typeof v === 'string' && Object.hasOwn(STACKS, v)
export const STACK_IDS = Object.keys(STACKS) as Stack[]

/** The kinds, in the order of STACKS, under their group headings. */
export function stackGroups(): { label: string; stacks: { id: Stack; label: string }[] }[] {
  const groups: { label: string; stacks: { id: Stack; label: string }[] }[] = []
  for (const id of STACK_IDS) {
    const { group, label } = STACKS[id]
    const g = groups.find((x) => x.label === group) ?? groups[groups.push({ label: group, stacks: [] }) - 1]
    g.stacks.push({ id, label })
  }
  return groups
}

/** Name for display. An id that is not in the catalog (an old or hand-edited value) shows as it is. */
export const stackLabel = (id: string | undefined): string => (isStack(id) ? STACKS[id].label : (id ?? ''))

/** The port a kind of app listens on by default. */
export const defaultPort = (id: string): number => (isStack(id) ? STACKS[id].port : 3000)

/** Node.js, TypeScript and JavaScript apps keep their commands in package.json scripts. */
export const NODE_STACKS = ['nodejs', 'express', 'nestjs', 'nextjs'] as const satisfies readonly Stack[]
export const isNodeStack = (id: string): boolean => (NODE_STACKS as readonly string[]).includes(id)
export const isDockerStack = (id: string): boolean => id === 'docker'

// --- Docker

export type DockerMode = 'dockerfile' | 'compose'
export const DEFAULT_DOCKERFILE = 'Dockerfile'
export const DEFAULT_COMPOSE_FILE = 'docker-compose.yaml'
/** A file at the root of the repo: letters, digits, dot, dash and underscore. Nothing a shell would read as more. */
export const DOCKER_FILE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
export const DOCKER_NAME = 'mogo-app'

export interface DockerSettings {
  mode: DockerMode
  file: string // '' = the default name
  port: number // a Dockerfile app's port, published on the same port (0 = the usual one)
}

/** The commands a Docker repo runs. Compiled into the settings the runner reads: it only executes commands. */
export interface DockerCommands {
  prepare: string[]
  start: string
  services_down: string
  healthcheck: string
}

/**
 * Compose (the default): bring the stack up, building it; follow its logs, which keeps the "app" running while the ready
 * URL is polled; take it down with its volumes afterwards. The file is `docker-compose.yaml` unless another is named.
 * The project is named `mogo-app`, so what a run starts is exactly what it removes. The repo's variables reach the
 * compose file through the environment. The ready URL may stay empty: the runner reads the port the app publishes from
 * the compose file (backend/mogo/docker.py compose_ready_url).
 *
 * Dockerfile: build the image, then run it with the app's port published. $MOGO_DOCKER_ENV is set by the runner to
 * `-e NAME` for each of the repo's variables, so they reach the container without their values appearing on the
 * command line; the container is removed when the run ends. No file name: `Dockerfile`.
 */
export function compileDocker(d: DockerSettings, appUrl: string): DockerCommands {
  if (d.mode === 'compose') {
    const f = `-p ${DOCKER_NAME} -f ${d.file || DEFAULT_COMPOSE_FILE}`
    return {
      prepare: [`docker compose ${f} up -d --build`],
      start: `docker compose ${f} logs -f`,
      services_down: `docker compose ${f} down -v --remove-orphans`,
      healthcheck: appUrl.trim(),
    }
  }
  const port = d.port || defaultPort('docker')
  const f = d.file ? `-f ${d.file} ` : ''
  return {
    prepare: [`docker build ${f}-t ${DOCKER_NAME} .`],
    start: `docker run --rm --name ${DOCKER_NAME} -p ${port}:${port} $MOGO_DOCKER_ENV ${DOCKER_NAME}`,
    services_down: `docker rm -f ${DOCKER_NAME}`,
    healthcheck: appUrl.trim() || `http://localhost:${port}`,
  }
}
