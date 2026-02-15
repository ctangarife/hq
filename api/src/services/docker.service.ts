import Docker from 'dockerode'
import path from 'path'
import { getCredential } from '../lib/credentials.js'

const docker = new Docker({
  socketPath: process.env.DOCKER_SOCKET || '/var/run/docker.sock'
})

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
          `${workspacePath}/${agentId}:/data:rw`
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
   * Obtener logs de un contenedor
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
