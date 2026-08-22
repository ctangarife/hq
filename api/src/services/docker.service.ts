import Docker from 'dockerode'
import path from 'path'
import { getCredential } from '../lib/credentials.js'
import { litellmService } from './litellm.service.js'

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
})

export interface LogLine {
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
}

export interface ContainerConfig {
  name: string
  image: string
  env: Record<string, string>
  network: string
  volumes: Record<string, string>
}

export interface AgentConfig {
  name: string
  role: string
  personality: string
  llmModel: string
  provider: string
  apiKey?: string
}

/**
 * Servico de Docker para gestión de contenedores de agentes HQ
 * ARQUITECTURA SIMPLIFICADA:
 * - Los agentes ejecutan OpenClaw Agent directamente (sin gateway HTTP)
 * - Solo pasan variables de entorno del modelo
 */
export class DockerService {
  /**
   * Crear un nuevo contenedor para un agente.
   *
   * Selección de imagen por rol (arquitectura híbrida Goose):
   *   - Orquestadores (squad_lead, auditor) → hq-agent-orchestrator (persistente,
   *     proceso Node con polling loop que spawnea Goose por tarea).
   *   - Especialistas (researcher, writer, developer, analyst) → hq-agent-goose
   *     (efímero, 1 tarea = 1 container). En la práctica estos se ejecutan vía
   *     runEphemeralTask(), pero createAgentContainer puede instanciarlos si
   *     la arquitectura lo requiere.
   */
  async createAgentContainer(agentId: string, agent: AgentConfig): Promise<string> {
    const containerName = `hq-agent-${agentId}`

    // Orquestadores (persistentes) vs especialistas (efímeros)
    const ORCHESTRATOR_ROLES = ['squad_lead', 'auditor']
    const isOrchestrator = ORCHESTRATOR_ROLES.includes(agent.role)
    const image = isOrchestrator
      ? process.env.HQ_AGENT_ORCHESTRATOR_IMAGE || 'hq-agent-orchestrator:latest'
      : process.env.AGENT_BASE_IMAGE || 'hq-agent-goose:latest'

    const network = process.env.AGENT_NETWORK || 'hq-network'
    const workspacePath = process.env.AGENT_WORKSPACE_PATH || '/data/agent-workspace'
    const filesPath = process.env.HQ_FILES_PATH || '/data/hq-files'

    // Variables de entorno para HQ Agent (imagen personalizada)
    const env: Record<string, string> = {
      // Identificación del agente
      AGENT_ID: agentId,  // Importante: ID del agente para polling
      // Configuración del agente
      AGENT_NAME: agent.name,
      AGENT_ROLE: agent.role,
      AGENT_PERSONALITY: agent.personality,
      // Configuración LLM para HQ Agent
      LLM_MODEL: agent.llmModel,
      LLM_PROVIDER: agent.provider,
      // MongoDB URI para que el agente pueda cargar API keys
      MONGO_URI: `mongodb://${process.env.MONGODB_USERNAME}:${process.env.MONGODB_PASSWORD}@mongodb:27017/${process.env.MONGODB_DATABASE}?authSource=admin`,
      HQ_API_URL: process.env.HQ_API_URL || 'http://api:3001/api',
      // Token que el skill del orchestrator usa para autenticarse contra la
      // API HQ al hacer polling y resolver prompts. El middleware de auth
      // acepta cualquier Bearer token hoy (TODO: validar JWT de verdad).
      HQ_API_TOKEN: process.env.HQ_API_TOKEN || 'hq-agent-token',
      // Path a archivos de misiones (read-only para inputs, write para task outputs)
      HQ_FILES_PATH: filesPath
    }

    // Resolver la virtual key de LiteLLM desde MongoDB (vía litellmService).
    // Reemplaza el patrón viejo getCredential(agent.provider) que buscaba
    // keys de providers directo. HQ ahora centraliza todo vía LiteLLM proxy.
    // La imagen hq-agent-goose lee la key de OPENAI_API_KEY y la usa contra
    // el proxy (openai-compatible).
    try {
      const virtualKey = await litellmService.getKey()
      env['OPENAI_API_KEY'] = virtualKey
      env['OPENAI_HOST'] = process.env.LITELLM_API_URL || 'https://litellm.ctangarife.com'
      env['GOOSE_MODEL'] = agent.llmModel || 'glm-4.7'
      console.log(`Using LiteLLM virtual key for agent ${agent.name}`)
    } catch (err: any) {
      console.warn(`Could not resolve LiteLLM key, agent will fail LLM calls: ${err.message}`)
    }

    // Configuración del contenedor (HQ Agent no necesita volúmenes complejos)
    const containerConfig: ContainerConfig = {
      name: containerName,
      Image: image,
      Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
      HostConfig: {
        Binds: [
          `${workspacePath}/${agentId}:/data:rw`,
          `${filesPath}:/data/hq-files:ro`  // Read-only access to mission files
        ],
        RestartPolicy: {
          Name: 'unless-stopped'
        }
      },
      NetworkingConfig: {
        EndpointsConfig: {
          [network]: {}
        }
      },
      Labels: {
        'com.docker.compose.project': 'hq',
        'com.docker.compose.service': `agent-${agentId}`,
        'com.docker.compose.oneoff': 'false',
        'hq-agent-id': agentId,
        'hq-managed': 'true'
      }
    }

    try {
      // Pull imagen si no existe
      await this.pullImageIfNeeded(image)

      // Crear contenedor
      const container = await docker.createContainer(containerConfig)

      // Iniciar contenedor
      await container.start()

      return container.id
    } catch (error) {
      console.error('Error creating agent container:', error)
      throw new Error(`Failed to create container: ${error}`)
    }
  }

  /**
   * Ejecutar UNA tarea en un container efímero de Goose y devolver el output.
   *
   * Arquitectura híbrida: los especialistas (researcher, writer, developer,
   * analyst) son efímeros. La API spawnea este container, Goose ejecuta la
   * tarea, el output va a stdout, el container muere (--rm).
   *
   * Flujo:
   *   1. Resolver la virtual key de LiteLLM desde MongoDB (vía litellmService)
   *   2. Crear container hq-agent-goose con la key como ENV (OPENAI_API_KEY)
   *   3. Pasar el prompt por stdin (validamos que es lo que da output limpio)
   *   4. Capturar stdout = respuesta del modelo
   *   5. Auto-remover el container (--rm)
   *
   * El threat model de pasar la key por ENV es aceptable: quien puede hacer
   * `docker inspect` en el host ya está comprometido; el container vive minutos.
   *
   * @param prompt - la tarea a ejecutar (se pasa por stdin)
   * @param options.model - modelo (default: del config de LiteLLM, resuelto por el proxy)
   * @param options.workspaceId - para resolver la key correcta en el futuro multi-tenant
   * @param options.timeoutMs - timeout del container (default: 5 min)
   * @returns el output del modelo (texto limpio de stdout)
   */
  async runEphemeralTask(
    prompt: string,
    options: {
      model?: string
      workspaceId?: string
      timeoutMs?: number
    } = {},
  ): Promise<string> {
    const image = process.env.HQ_AGENT_GOOSE_IMAGE || 'hq-agent-goose:latest'
    const network = process.env.AGENT_NETWORK || 'hq-network'

    // 1. Resolver la virtual key desde MongoDB (no desde .env)
    const virtualKey = await litellmService.getKey(options.workspaceId)

    // 2. Variables de entorno para el container efímero
    const env: string[] = [
      `OPENAI_API_KEY=${virtualKey}`,
      // OPENAI_HOST y GOOSE_MODEL ya están baked en la imagen (litellm.ctangarife.com, glm-4.7)
    ]
    if (options.model) {
      env.push(`GOOSE_MODEL=${options.model}`)
    }

    console.log(`[ephemeral] spawning Goose container for task (${prompt.length} chars)`)

    // 3. Crear container efímero con auto-remove
    const container = await docker.createContainer({
      Image: image,
      Env: env,
      AttachStdin: true,
      AttachStdout: true,
      AttachStderr: true,
      OpenStdin: true,
      Tty: false,
      HostConfig: {
        AutoRemove: true,  // --rm: el container se borra solo al terminar
        NetworkMode: network,
      },
      Labels: {
        'hq-managed': 'true',
        'hq-agent-type': 'ephemeral-goose',
      },
    })

    try {
      // Secuencia start→attach→write (la validada en producción). Nota: un
      // attach ANTES de start se cuelga en podman (docker API exige container
      // running para attach stream) — probado y descartado.
      await container.start()

      const stream = await container.attach({ stream: true, stdin: true, stdout: true, stderr: true })
      stream.write(prompt)
      stream.end()

      // Capturar stdout
      const output = await this.captureContainerOutput(container, options.timeoutMs ?? 300000)
      console.log(`[ephemeral] task completed (${output.length} chars output)`)
      return output.trim()
    } catch (error) {
      // AutoRemove se encarga del cleanup, pero forzamos por si acaso
      try { await container.remove({ force: true }) } catch {}
      console.error('[ephemeral] task failed:', error)
      throw error
    }
  }

  /**
   * Capturar el stdout de un container hasta que termine o timeout.
   * Filtra el banner ASCII de Goose (las líneas con "__(", "L L", etc.)
   * dejando solo la respuesta del modelo.
   */
  private async captureContainerOutput(container: any, timeoutMs: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      let settled = false

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          try { container.kill() } catch {}
          reject(new Error(`Ephemeral task timed out after ${timeoutMs}ms`))
        }
      }, timeoutMs)

      container.wait().then(() => {
        if (!settled) {
          settled = true
          clearTimeout(timer)
          const raw = Buffer.concat(chunks).toString('utf-8')
          // Filtrar el banner de Goose y líneas vacías iniciales
          const cleaned = this.cleanGooseOutput(raw)
          resolve(cleaned)
        }
      }).catch(reject)

      // Capturar stdout vía log stream (follow hasta que el container termine)
      container.logs({
        stdout: true,
        stderr: false,
        follow: true,
      }).then((logStream: any) => {
        logStream.on('data', (chunk: Buffer) => chunks.push(chunk))
        logStream.on('end', () => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            const raw = Buffer.concat(chunks).toString('utf-8')
            resolve(this.cleanGooseOutput(raw))
          }
        })
        logStream.on('error', (err: Error) => {
          if (!settled) {
            settled = true
            clearTimeout(timer)
            reject(err)
          }
        })
      }).catch(reject)
    })
  }

  /**
   * Limpiar el output de Goose: quitar el banner ASCII art y metadata de sesión,
   * dejando solo la respuesta del modelo.
   *
   * Goose imprime al arrancar:
   *       __( O)>  ● new session · openai glm-4.7
   *      \____)    20260617_1 · /workspace
   *        L L     goose is ready
   */
  private cleanGooseOutput(raw: string): string {
    const lines = raw.split('\n')
    const cleaned: string[] = []
    let pastBanner = false

    for (const line of lines) {
      // Detectar el fin del banner ("goose is ready")
      if (!pastBanner) {
        if (line.includes('goose is ready') || line.includes('new session')) {
          continue
        }
        // Líneas del ASCII art del ganso
        if (line.includes('__( O)>') || line.includes('\\____)') || line.includes('L L')) {
          continue
        }
        pastBanner = true
      }
      cleaned.push(line)
    }

    return cleaned.join('\n').trim()
  }

  /**
   * Obtener información de un contenedor
   */
  async getContainer(containerId: string) {
    try {
      const container = docker.getContainer(containerId)
      return await container.inspect()
    } catch (error) {
      console.error('Error getting container:', error)
      return null
    }
  }

  /**
   * Detener un contenedor
   */
  async stopContainer(containerId: string): Promise<void> {
    try {
      const container = docker.getContainer(containerId)
      await container.stop({ t: 10 })
    } catch (error: any) {
      // Si el contenedor no existe, no es error
      if (error.statusCode === 404) {
        console.log(`Container ${containerId} not found, already removed`)
        return
      }
      console.error('Error stopping container:', error)
      throw new Error(`Failed to stop container: ${error}`)
    }
  }

  /**
   * Iniciar un contenedor detenido
   */
  async startContainer(containerId: string): Promise<void> {
    try {
      const container = docker.getContainer(containerId)
      await container.start()
    } catch (error) {
      console.error('Error starting container:', error)
      throw new Error(`Failed to start container: ${error}`)
    }
  }

  /**
   * Reiniciar un contenedor
   */
  async restartContainer(containerId: string): Promise<void> {
    try {
      const container = docker.getContainer(containerId)
      await container.restart({ t: 10 })
    } catch (error) {
      // Si el contenedor no existe, no es error
      if (error.statusCode === 404) {
        console.log(`Container ${containerId} not found, cannot restart`)
        return
      }
      console.error('Error restarting container:', error)
      throw new Error(`Failed to restart container: ${error}`)
    }
  }

  /**
   * Eliminar un contenedor
   */
  async removeContainer(containerId: string): Promise<void> {
    try {
      const container = docker.getContainer(containerId)
      await container.remove({ force: true })
    } catch (error) {
      // Si el contenedor no existe, no es error (ya fue eliminado)
      if (error.statusCode === 404) {
        console.log(`Container ${containerId} not found, already removed`)
        return
      }
      console.error('Error removing container:', error)
      throw new Error(`Failed to remove container: ${error}`)
    }
  }

  /**
   * Obtener logs de un contenedor (raw string)
   */
  async getContainerLogs(containerId: string, tail: number = 100): Promise<string> {
    try {
      const container = docker.getContainer(containerId)
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: tail,
        timestamps: true
      })
      return logs.toString('utf-8')
    } catch (error) {
      console.error('Error getting logs:', error)
      return ''
    }
  }

  /**
   * Obtener logs de un contenedor (parseados como array de líneas)
   */
  async getContainerLogsParsed(containerId: string, options: { tail?: number; since?: number } = {}): Promise<LogLine[]> {
    const { tail = 100, since } = options
    try {
      const container = docker.getContainer(containerId)
      const logs = await container.logs({
        stdout: true,
        stderr: true,
        tail: tail,
        since: since,
        timestamps: true
      })

      const logString = logs.toString('utf-8')
      return this.parseDockerLogs(logString)
    } catch (error: any) {
      console.error('Error getting logs:', error)
      if (error.statusCode === 404) {
        return [{ timestamp: new Date().toISOString(), level: 'error', message: 'Container not found' }]
      }
      return []
    }
  }

  /**
   * Stream de logs de un contenedor en tiempo real
   */
  streamContainerLogs(containerId: string, callback: (log: LogLine) => void): NodeJS.ReadableStream {
    try {
      const container = docker.getContainer(containerId)
      const stream = container.logs({
        stdout: true,
        stderr: true,
        follow: true,
        timestamps: true,
        tail: 1
      })

      // Validate that stream is a valid object with 'on' method
      if (!stream || typeof stream.on !== 'function') {
        console.error('Invalid stream object returned from container.logs()')
        callback({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Invalid stream object'
        })
        // Return a dummy stream to prevent crashes
        const { Readable } = require('stream')
        return Readable.from([''])
      }

      stream.on('data', (chunk: Buffer) => {
        const logString = chunk.toString('utf-8')
        const logs = this.parseDockerLogs(logString)
        logs.forEach(log => callback(log))
      })

      stream.on('error', (error) => {
        console.error('Error streaming logs:', error)
        callback({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: `Stream error: ${error.message}`
        })
      })

      return stream
    } catch (error: any) {
      console.error('Error setting up log stream:', error)
      if (error.statusCode === 404) {
        callback({
          timestamp: new Date().toISOString(),
          level: 'error',
          message: 'Container not found'
        })
      }
      // Return a dummy stream to prevent crashes
      const { Readable } = require('stream')
      return Readable.from([''])
    }
  }

  /**
   * Parsear logs de Docker a un formato estructurado
   */
  private parseDockerLogs(logString: string): LogLine[] {
    const lines = logString.split('\n').filter(line => line.trim())
    const parsed: LogLine[] = []

    for (const line of lines) {
      // Docker logs format: timestamp + stream prefix + message
      // Stream prefix: \x01 for stdout, \x02 for stderr
      let cleanLine = line

      // Remove stream prefix
      if (line.startsWith('\x01')) {
        cleanLine = line.substring(1)
      } else if (line.startsWith('\x02')) {
        cleanLine = line.substring(1)
      }

      // Extract timestamp (ISO format at start)
      const timestampMatch = cleanLine.match(/^(\d{4}-\d{2}-\d{2}T[\d:.]+Z)\s+(.+)/)
      if (timestampMatch) {
        const [, timestamp, message] = timestampMatch
        parsed.push({
          timestamp,
          level: this.detectLogLevel(message),
          message: message.trim()
        })
      } else {
        // No timestamp found, use current time
        parsed.push({
          timestamp: new Date().toISOString(),
          level: this.detectLogLevel(cleanLine),
          message: cleanLine.trim()
        })
      }
    }

    return parsed
  }

  /**
   * Detectar nivel de log basado en el contenido
   */
  private detectLogLevel(message: string): 'info' | 'warn' | 'error' | 'debug' {
    const lower = message.toLowerCase()

    if (lower.includes('error') || lower.includes('fail') || lower.includes('❌')) {
      return 'error'
    }
    if (lower.includes('warn') || lower.includes('⚠️')) {
      return 'warn'
    }
    if (lower.includes('debug') || lower.includes('🐛')) {
      return 'debug'
    }

    return 'info'
  }

  /**
   * Obtener estadísticas de un contenedor
   */
  async getContainerStats(containerId: string) {
    try {
      const container = docker.getContainer(containerId)
      const stats = await container.stats({ stream: false })
      return stats
    } catch (error) {
      console.error('Error getting stats:', error)
      return null
    }
  }

  /**
   * Verificar si una imagen existe localmente
   */
  private async imageExists(image: string): Promise<boolean> {
    try {
      await docker.getImage(image).inspect()
      return true
    } catch {
      return false
    }
  }

  /**
   * Pull de una imagen si no existe localmente
   */
  private async pullImageIfNeeded(image: string): Promise<void> {
    const exists = await this.imageExists(image)
    if (!exists) {
      console.log(`Pulling image ${image}...`)
      return new Promise((resolve, reject) => {
        docker.pull(image, (err: Error, stream: NodeJS.ReadableStream) => {
          if (err) {
            reject(err)
            return
          }

          stream.on('data', (chunk) => {
            const status = JSON.parse(chunk.toString())
            if (status.status) {
              console.log(`Docker: ${status.status}`)
            }
            if (status.progress) {
              console.log(`Docker: ${status.progress} ${status.progressDetail || ''}`)
            }
          })

          stream.on('error', (err) => {
            console.error('Error pulling image:', err)
            reject(err)
            return
          })

          stream.on('end', () => {
            console.log(`Image ${image} pulled successfully`)
            resolve()
          })
        })
      })
    }
  }

  /**
   * Listar contenedores gestionados por HQ
   */
  async listHQContainers(): Promise<any[]> {
    try {
      const containers = await docker.listContainers({ all: true })
      return containers.filter((c: any) =>
        c.Labels?.['hq-managed'] === 'true'
      )
    } catch (error) {
      console.error('Error listing containers:', error)
      return []
    }
  }

  /**
   * Obtener estado de un contenedor
   */
  async getContainerStatus(containerId: string): Promise<'running' | 'exited' | 'paused' | null> {
    const container = await this.getContainer(containerId)
    if (!container) return null

    if (container.State.Running) return 'running'
    if (container.State.Paused) return 'paused'
    if (container.State.Status === 'exited') return 'exited'

    return null
  }
}

export const dockerService = new DockerService()
