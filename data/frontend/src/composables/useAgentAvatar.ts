/**
 * Mapeo de roles de agentes HQ → estilos DiceBear.
 *
 * Cada rol tiene un estilo visual distintivo para que el usuario pueda
 * diferenciar rápidamente qué tipo de agente es (researcher vs developer,
 * etc.) sin leer el texto. El seed determina el avatar concreto dentro de
 * cada estilo (mismo seed = mismo avatar siempre).
 *
 * Adaptado del sistema de avatars de Papa por papa (DiceBear).
 */

// Roles de agentes de HQ y su estilo DiceBear asignado
const ROLE_STYLES: Record<string, string> = {
  // Orquestadores (estilos humanoides/personales)
  squad_lead: 'avataaars',      // líder, personaje completo
  auditor: 'lorelei',           // auditor, rasgos definidos

  // Especialistas (estilos distintivos por tipo de trabajo)
  researcher: 'adventurer',     // explorador/busca info
  developer: 'bottts',          // robot técnico
  analyst: 'big-smile',         // analista, amigable
  writer: 'pixel-art',          // escritor, retro
  reviewer: 'avataaars',        // revisor, humano

  // Roles genéricos
  coder: 'bottts',
  planner: 'lorelei',
  default: 'bottts',
}

const ROLE_FALLBACK_SEEDS: Record<string, string> = {
  squad_lead: 'commander',
  auditor: 'inspector',
  researcher: 'scout',
  developer: 'codec',
  analyst: 'data',
  writer: 'quill',
  reviewer: 'lens',
  default: 'agent',
}

/**
 * Obtener el estilo DiceBear para un rol de agente.
 */
export function getStyleForRole(role: string): string {
  return ROLE_STYLES[role] || ROLE_STYLES.default
}

/**
 * Obtener un seed apropiado para un agente.
 * Si el agente tiene nombre propio, lo usa; si no, usa un default por rol.
 */
export function getSeedForAgent(agent: { name?: string; role?: string }): string {
  if (agent.name && agent.name.trim()) {
    return agent.name
  }
  const role = agent.role || 'default'
  return ROLE_FALLBACK_SEEDS[role] || ROLE_FALLBACK_SEEDS.default
}

/**
 * Helper directo: dado un agente, devuelve { seed, styleKey } para AvatarImage.
 */
export function getAvatarProps(agent: { name?: string; role?: string }): {
  seed: string
  styleKey: string
} {
  return {
    seed: getSeedForAgent(agent),
    styleKey: getStyleForRole(agent.role || 'default'),
  }
}
