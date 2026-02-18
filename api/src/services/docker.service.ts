import Docker from 'dockerode'
import path from 'path'
import { getCredential } from '../lib/credentials.js'

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
   * Crear un nuevo contenedor para un agente OpenClaw
   */
  async createAgentContainer(agentId: string, agent: AgentConfig): Promise<string> {
    const containerName = `hq-agent-${agentId}`
    const image = process.env.AGENT_BASE_IMAGE || 'hq-agent:latest'
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
      // Path a archivos de misiones (read-only para inputs, write para task outputs)
      HQ_FILES_PATH: filesPath
    }

    // Agregar API key si el agente tiene una específica
    if (agent.apiKey) {
      env[`${agent.provider.toUpperCase()}_API_KEY`] = agent.apiKey
      console.log(`Using agent-specific API key for ${agent.provider}`)
    } else {
      // Buscar credenciales en MongoDB
      const credential = await getCredential(agent.provider)
      if (credential && credential.token) {
        env[`${agent.provider.toUpperCase()}_API_KEY`] = credential.token
        console.log(`Using API key from MongoDB for ${agent.provider} (${credential.name})`)
      } else {
        console.warn(`No API key found in MongoDB for provider: ${agent.provider}`)
      }
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
      throw error
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
