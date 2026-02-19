import mongoose, { Schema, Model } from 'mongoose'

/**
 * Mission Template Model
 *
 * Plantillas predefinidas para crear misiones rápidamente
 */

export interface IMissionTemplate extends mongoose.Document {
  templateId: string           // ID único (para usar con string IDs)
  name: string                 // Nombre de la plantilla
  description: string          // Descripción corta
  category: string             // Categoría (analysis, development, content, research)

  // Configuración de misión por defecto
  defaultTitle: string         // Título sugerido (puede tener placeholders)
  defaultDescription: string   // Descripción base
  defaultObjective?: string    // Objetivo sugerido
  defaultType: 'AUTO_ORCHESTRATED' | 'TEMPLATE_BASED' | 'MANUAL'
  defaultPriority: 'high' | 'medium' | 'low'

  // Campos de contexto por defecto
  context?: string             // Contexto predefinido
  audience?: string            // Audiencia objetivo
  deliverableFormat?: string   // Formato de entrega esperado
  successCriteria?: string     // Criterios de éxito
  constraints?: string         // Restricciones
  tone?: string                // Tono de comunicación

  // Configuración de orquestación
  squadLeadRequired: boolean   // Requiere Squad Lead
  suggestedAgents: string[]    // Roles de agentes sugeridos

  // Estructura de tareas predefinida (para TEMPLATE_BASED)
  taskStructure?: Array<{
    title: string
    description: string
    type: string
    agentRole?: string
    estimatedDuration?: string
  }>

  // Metadata
  icon: string                 // Icono emoji para UI
  tags: string[]               // Tags para búsqueda
  examples: string[]           // Ejemplos de uso

  // Estado
  isActive: boolean            // Plantilla activa
  isSystem: boolean            // Plantilla del sistema (no editable por usuario)

  // Timestamps
  createdAt: Date
  updatedAt: Date
}

const missionTemplateSchema = new Schema<IMissionTemplate>({
  templateId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  name: {
    type: String,
    required: true
  },
  description: {
    type: String,
    required: true
  },
  category: {
    type: String,
    enum: ['analysis', 'development', 'content', 'research', 'automation'],
    required: true,
    index: true
  },
  defaultTitle: {
    type: String,
    required: true
  },
  defaultDescription: {
    type: String,
    required: true
  },
  defaultObjective: {
    type: String
  },
  defaultType: {
    type: String,
    enum: ['AUTO_ORCHESTRATED', 'TEMPLATE_BASED', 'MANUAL'],
    default: 'AUTO_ORCHESTRATED'
  },
  defaultPriority: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  // Context fields
  context: {
    type: String
  },
  audience: {
    type: String
  },
  deliverableFormat: {
    type: String
  },
  successCriteria: {
    type: String
  },
  constraints: {
    type: String
  },
  tone: {
    type: String
  },
  // Orchestration config
  squadLeadRequired: {
    type: Boolean,
    default: true
  },
  suggestedAgents: [{
    type: String
  }],
  // Task structure
  taskStructure: [{
    title: String,
    description: String,
    type: String,
    agentRole: String,
    estimatedDuration: String
  }],
  // Metadata
  icon: {
    type: String,
    default: '📋'
  },
  tags: [{
    type: String
  }],
  examples: [{
    type: String
  }],
  // Status
  isActive: {
    type: Boolean,
    default: true,
    index: true
  },
  isSystem: {
    type: Boolean,
    default: false
  }
}, {
  timestamps: true
})

// Índices
missionTemplateSchema.index({ category: 1, isActive: 1 })
missionTemplateSchema.index({ tags: 1 })

// Método estático para crear plantilla
missionTemplateSchema.statics.createTemplate = async function(data: {
  name: string
  description: string
  category: string
  defaultTitle: string
  defaultDescription: string
  [key: string]: any
}): Promise<IMissionTemplate> {
  const MissionTemplate = this as Model<IMissionTemplate>

  // Generar templateId único
  const templateId = `tpl-${Date.now()}-${Math.random().toString(36).substring(2, 15)}`

  const template = new MissionTemplate({
    templateId,
    ...data
  })

  return await template.save()
}

// Método estático para inicializar plantillas del sistema
missionTemplateSchema.statics.initializeSystemTemplates = async function(): Promise<void> {
  const MissionTemplate = this as Model<IMissionTemplate>

  // Verificar si ya existen plantillas del sistema
  const existingCount = await MissionTemplate.countDocuments({ isSystem: true })
  if (existingCount > 0) {
    console.log('System templates already initialized')
    return
  }

  const systemTemplates = [
    {
      templateId: 'tpl-system-data-analysis',
      name: 'Análisis de Datos',
      description: 'Analiza datos, extrae insights y genera visualizaciones',
      category: 'analysis',
      defaultTitle: 'Análisis de Datos: {tema}',
      defaultDescription: 'Analizar datos relacionados con {tema} para extraer insights accionables y generar visualizaciones claras.',
      defaultObjective: 'Proporcionar análisis detallado y visualizaciones de datos sobre {tema}',
      defaultType: 'AUTO_ORCHESTRATED',
      defaultPriority: 'medium',
      context: 'Análisis cuantitativo para soporte de decisiones',
      audience: 'Stakeholders de negocio y equipo técnico',
      deliverableFormat: 'Reporte con gráficos y tablas',
      successCriteria: 'Mínimo 5 insights accionables identificados, con visualizaciones claras',
      constraints: 'Usar datos verificables, citar fuentes',
      tone: 'Profesional pero accesible',
      squadLeadRequired: true,
      suggestedAgents: ['analyst', 'researcher'],
      icon: '📊',
      tags: ['datos', 'análisis', 'insights', 'gráficos'],
      examples: ['Análisis de ventas mensuales', 'Análisis de comportamiento de usuarios', 'Análisis de métricas de marketing'],
      isSystem: true,
      isActive: true
    },
    {
      templateId: 'tpl-system-pdf-report',
      name: 'Generación de Reporte PDF',
      description: 'Crea un reporte profesional en PDF desde múltiples fuentes',
      category: 'content',
      defaultTitle: 'Reporte: {tema}',
      defaultDescription: 'Generar un reporte profesional en PDF sobre {tema}, consolidando información de múltiples fuentes.',
      defaultObjective: 'Entregar reporte PDF completo y bien estructurado sobre {tema}',
      defaultType: 'AUTO_ORCHESTRATED',
      defaultPriority: 'high',
      context: 'Reporte formal para presentación ejecutiva',
      audience: 'Ejecutivos o clientes externos',
      deliverableFormat: 'PDF profesional con portada, índice y conclusiones',
      successCriteria: 'PDF de mínimo 5 páginas con estructura clara y contenido verificable',
      constraints: 'Máximo 20 páginas, lenguaje formal, incluir referencias',
      tone: 'Formal y ejecutivo',
      squadLeadRequired: true,
      suggestedAgents: ['writer', 'researcher', 'analyst'],
      icon: '📄',
      tags: ['pdf', 'reporte', 'documento', 'entregable'],
      examples: ['Reporte trimestral de resultados', 'Reporte de investigación de mercado', 'Propuesta comercial'],
      isSystem: true,
      isActive: true
    },
    {
      templateId: 'tpl-system-feature-dev',
      name: 'Desarrollo de Feature',
      description: 'Desarrolla una nueva funcionalidad de software completa',
      category: 'development',
      defaultTitle: 'Feature: {nombre_feature}',
      defaultDescription: 'Desarrollar la funcionalidad {nombre_feature} según las especificaciones, incluyendo código, tests y documentación.',
      defaultObjective: 'Entregar la funcionalidad {nombre_feature} completamente desarrollada y testeada',
      defaultType: 'AUTO_ORCHESTRATED',
      defaultPriority: 'high',
      context: 'Desarrollo de software en equipo, seguimiento de mejores prácticas',
      audience: 'Equipo de desarrollo y stakeholders técnicos',
      deliverableFormat: 'Código funcional + tests + documentación',
      successCriteria: 'Código funcionando, tests pasando, documentación completa',
      constraints: 'Seguir convenciones del proyecto, máximo 5 días de desarrollo',
      tone: 'Técnico y colaborativo',
      squadLeadRequired: true,
      suggestedAgents: ['developer', 'analyst', 'writer'],
      icon: '💻',
      tags: ['desarrollo', 'código', 'feature', 'programming'],
      examples: ['API REST para usuarios', 'Dashboard de analytics', 'Sistema de autenticación'],
      isSystem: true,
      isActive: true
    },
    {
      templateId: 'tpl-system-web-research',
      name: 'Investigación Web',
      description: 'Investiga un tema en la web y consolida información',
      category: 'research',
      defaultTitle: 'Investigación: {tema}',
      defaultDescription: 'Investigar sobre {tema} en la web, recopilando información de fuentes confiables y consolidando los hallazgos.',
      defaultObjective: 'Proporcionar un resumen completo y verificable sobre {tema}',
      defaultType: 'AUTO_ORCHESTRATED',
      defaultPriority: 'medium',
      context: 'Investigación exhaustiva para toma de decisiones',
      audience: 'Equipo de proyecto o stakeholders',
      deliverableFormat: 'Reporte estructurado con referencias',
      successCriteria: 'Mínimo 10 fuentes citadas, información verificable y actualizada',
      constraints: 'Fuentes de los últimos 12 meses, preferiblemente académicas o industrias reconocidas',
      tone: 'Objetivo y analítico',
      squadLeadRequired: true,
      suggestedAgents: ['researcher', 'analyst'],
      icon: '🔍',
      tags: ['investigación', 'web', 'research', 'búsqueda'],
      examples: ['Tendencias de IA 2026', 'Competidores en mercado X', 'Nuevas tecnologías para Y'],
      isSystem: true,
      isActive: true
    },
    {
      templateId: 'tpl-system-content-creation',
      name: 'Creación de Contenido',
      description: 'Crea contenido optimizado para diferentes formatos y audiencias',
      category: 'content',
      defaultTitle: 'Contenido: {tema}',
      defaultDescription: 'Crear contenido atractivo y optimizado sobre {tema} para el formato y audiencia especificados.',
      defaultObjective: 'Entregar contenido original y de alta calidad sobre {tema}',
      defaultType: 'AUTO_ORCHESTRATED',
      defaultPriority: 'medium',
      context: 'Creación de contenido para marketing o educación',
      audience: 'Público objetivo general o específico',
      deliverableFormat: 'Artículo, post de blog, o guión según necesidad',
      successCriteria: 'Contenido original, optimizado SEO, engaging y con CTA claro',
      constraints: 'Máximo 2000 palabras, tono consistente, incluir Call-to-Action',
      tone: 'Atractivo y profesional',
      squadLeadRequired: true,
      suggestedAgents: ['writer', 'researcher'],
      icon: '✍️',
      tags: ['contenido', 'copywriting', 'blog', 'artículo'],
      examples: ['Artículo de blog sobre productividad', 'Guía para principiantes', 'Campaña de email marketing'],
      isSystem: true,
      isActive: true
    },
    {
      templateId: 'tpl-system-automation',
      name: 'Automatización de Procesos',
      description: 'Automatiza tareas repetitivas con scripts o workflows',
      category: 'automation',
      defaultTitle: 'Automatización: {proceso}',
      defaultDescription: 'Automatizar el proceso de {proceso} para reducir tiempo manual y minimizar errores.',
      defaultObjective: 'Implementar automatización funcional para {proceso}',
      defaultType: 'AUTO_ORCHESTRATED',
      defaultPriority: 'medium',
      context: 'Automatización de tareas operativas o administrativas',
      audience: 'Equipo operativo o stakeholders',
      deliverableFormat: 'Script o workflow documentado + instrucciones de uso',
      successCriteria: 'Automatización funcionando, reduciendo tiempo manual en mínimo 70%',
      constraints: 'Debe ser fácil de mantener, incluir manejo de errores',
      tone: 'Práctico y técnico',
      squadLeadRequired: true,
      suggestedAgents: ['developer', 'analyst'],
      icon: '⚙️',
      tags: ['automatización', 'script', 'workflow', 'eficiencia'],
      examples: ['Automatización de reportes diarios', 'Script de procesamiento de datos', 'Workflow de aprobación automática'],
      isSystem: true,
      isActive: true
    }
  ]

  for (const template of systemTemplates) {
    try {
      const existing = await MissionTemplate.findOne({ templateId: template.templateId })
      if (!existing) {
        await MissionTemplate.create(template)
        console.log(`✅ System template created: ${template.name}`)
      }
    } catch (error) {
      console.error(`Error creating system template ${template.name}:`, error)
    }
  }

  console.log('✅ System templates initialized')
}

export const MissionTemplate = mongoose.model<IMissionTemplate>('MissionTemplate', missionTemplateSchema)
