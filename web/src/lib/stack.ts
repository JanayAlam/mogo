/**
 * How a repo is run: only with Docker. A repo needs a Compose file (the default) or a Dockerfile at its root; the
 * runner builds and starts it from there and removes it when the run ends. There are no other kinds of app.
 */
/** The port an app listens on when none is given. */
export const DEFAULT_PORT = 3000

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
  const port = d.port || DEFAULT_PORT
  const f = d.file ? `-f ${d.file} ` : ''
  return {
    prepare: [`docker build ${f}-t ${DOCKER_NAME} .`],
    start: `docker run --rm --name ${DOCKER_NAME} -p ${port}:${port} $MOGO_DOCKER_ENV ${DOCKER_NAME}`,
    services_down: `docker rm -f ${DOCKER_NAME}`,
    healthcheck: appUrl.trim() || `http://localhost:${port}`,
  }
}
