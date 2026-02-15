/**
 * Types for Agent Orchestration System
 * Defines interfaces for Squad Lead plans, agent templates, and orchestration
 */

/**
 * Definition of a task within a mission plan
 */
export interface AgentTaskDefinition {
  id: string
  title: string
  description: string
  type: 'web_search' | 'data_analysis' | 'content_generation' | 'code_execution' | 'custom' | 'coordination'
  dependencies: string[] // Task IDs that must complete first
  priority: 'high' | 'medium' | 'low'
  estimatedDuration?: number // in minutes
  input?: Record<string, any>
  assignedAgentRole?: string // Optional: which agent role should handle this
}

/**
 * Definition of an agent to be created
 */
export interface AgentDefinition {
  id: string
  name: string
  role: string
  template?: string // Reference to predefined template
  llmModel?: string
  capabilities: string[]
  personality?: string
}

/**
 * Complexity assessment of a mission
 */
export type MissionComplexity = 'low' | 'medium' | 'high' | 'critical'

/**
 * Output from Squad Lead after mission analysis
 */
export interface SquadLeadOutput {
  complexity: MissionComplexity
  summary: string
  estimatedDuration: number // total minutes
  tasks: AgentTaskDefinition[]
  agents: AgentDefinition[]
  dependencies: Array<{
    taskId: string
    dependsOn: string[]
  }>
  riskFactors?: string[]
  recommendations?: string[]
}

/**
 * Agent template for predefined agent types
 */
export interface AgentTemplate {
  id: string
  name: string
  role: string
  defaultLlmModel: string
  defaultProvider: string // 'zai', 'anthropic', 'openai', etc.
  capabilities: string[]
  personality: string
  isReusable: boolean
}

/**
 * Orchestration log entry
 */
export interface OrchestrationLogEntry {
  timestamp: Date
  action: string
  details: Record<string, any>
}

/**
 * Mission analysis task input
 */
export interface MissionAnalysisInput {
  missionId: string
  title: string
  description: string
  objective: string
  priority: string
  availableAgentTemplates: AgentTemplate[]
}

/**
 * Squad Lead response validation result
 */
export interface SquadLeadValidationResult {
  valid: boolean
  errors: string[]
  warnings?: string[]
}
