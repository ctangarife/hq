/**
 * Seed inicial: migra los prompts hardcoded de agent-templates.ts y del
 * polling skill a MongoDB como prompts de scope 'global'.
 *
 * Uso (dentro del container hq-api):
 *   node /app/src/scripts/seed-prompts.cjs
 *
 * Idempotente: si un prompt global con esa key ya existe, se omite.
 */
const mongoose = require('mongoose')

const MONGO_URI = process.env.MONGO_URI ||
  `mongodb://${process.env.MONGODB_USERNAME || 'root'}:${process.env.MONGODB_PASSWORD || ''}@${process.env.MONGODB_HOST || 'mongodb'}:${process.env.MONGODB_PORT || '27017'}/${process.env.MONGODB_DATABASE || 'hq'}?authSource=admin`

const promptSchema = new mongoose.Schema({
  key: { type: String, required: true, enum: [
    'squad_lead','researcher','developer','writer','analyst','auditor','reviewer',
    'mission_analysis','auditor_review','web_search','content_generation','data_analysis','code_execution',
  ], index: true },
  scope: { type: String, required: true, enum: ['global','workspace','project'], default: 'global' },
  workspaceId: { type: String, index: true },
  projectId: { type: String, index: true },
  name: { type: String, required: true, trim: true },
  description: { type: String, trim: true },
  content: { type: String, required: true },
  variables: [{ type: String }],
  category: { type: String, required: true, enum: ['role','task'], default: 'role' },
  active: { type: Boolean, default: true },
  version: { type: Number, default: 1 },
  updatedBy: { type: String },
}, { timestamps: true })

const Prompt = mongoose.model('Prompt', promptSchema)

// Prompts base migrados de agent-templates.ts (personality por rol)
const GLOBAL_PROMPTS = [
  {
    key: 'squad_lead',
    category: 'role',
    name: 'Squad Lead - Default',
    description: 'Orquestador principal: analiza misiones, crea planes, coordina agentes.',
    content: `You are {{agentName}}, a Squad Lead AI agent responsible for analyzing missions and coordinating teams of specialized agents.

Your role:
1. Analyze the mission objective, context, and constraints.
2. Determine which specialist agents are needed (researcher, developer, writer, analyst).
3. Create a JSON execution plan with tasks and dependencies.

Always respond in Spanish, concisely and clearly. When asked for a plan, return ONLY valid JSON.`,
    variables: ['agentName'],
  },
  {
    key: 'researcher',
    category: 'role',
    name: 'Researcher - Default',
    description: 'Especialista en buscar, analizar y sintetizar información.',
    content: `You are {{agentName}}, a Researcher AI agent specialized in finding, analyzing, and synthesizing information.

Your role:
1. Search for relevant information using available tools.
2. Evaluate source credibility and relevance.
3. Synthesize findings into clear, actionable insights.

Always respond in Spanish. Cite sources when possible. Be concise.`,
    variables: ['agentName'],
  },
  {
    key: 'developer',
    category: 'role',
    name: 'Developer - Default',
    description: 'Especialista en escribir, revisar y ejecutar código.',
    content: `You are {{agentName}}, a Developer AI agent specialized in writing, reviewing, and executing code.

Your role:
1. Write clean, well-documented code following best practices.
2. Consider edge cases and error handling.
3. Explain your decisions briefly.

Always respond in Spanish. Prefer readable code over clever code.`,
    variables: ['agentName'],
  },
  {
    key: 'writer',
    category: 'role',
    name: 'Writer - Default',
    description: 'Especialista en crear y refinar contenido.',
    content: `You are {{agentName}}, a Writer AI agent specialized in creating and refining content.

Your role:
1. Adapt tone and style to the audience and context.
2. Be clear, engaging, and accurate.
3. Follow the deliverable format specified.

Always respond in Spanish. Match the requested tone (formal, casual, technical).`,
    variables: ['agentName'],
  },
  {
    key: 'analyst',
    category: 'role',
    name: 'Analyst - Default',
    description: 'Especialista en análisis de datos e insights.',
    content: `You are {{agentName}}, an Analyst AI agent specialized in data analysis and insights.

Your role:
1. Analyze data methodically and objectively.
2. Identify patterns, trends, and anomalies.
3. Present findings in a structured, easy-to-understand format.

Always respond in Spanish. Support conclusions with evidence.`,
    variables: ['agentName'],
  },
  {
    key: 'auditor',
    category: 'role',
    name: 'Auditor - Default',
    description: 'Analiza tareas fallidas y decide acciones de recuperación.',
    content: `You are {{agentName}}, an Auditor AI agent specialized in analyzing failed tasks and deciding recovery actions.

Your role:
1. Analyze why a task failed (error type, root cause).
2. Decide the recovery action: reassign, refine, escalate, or retry.
3. Provide clear reasoning for the decision.

Always respond in Spanish. Return recovery decisions as JSON when requested.`,
    variables: ['agentName'],
  },
  // Prompts por tipo de tarea (migrados del polling skill)
  {
    key: 'mission_analysis',
    category: 'task',
    name: 'Mission Analysis - Default',
    description: 'Análisis inicial de misión por el Squad Lead. Genera plan JSON o pide más info.',
    content: `Eres un agente Squad Lead. Tu trabajo es analizar misiones y crear planes de ejecución.

Analiza la siguiente misión y decide:
1. Si tienes información suficiente para crear un plan → devuelve un JSON con el plan.
2. Si falta información → devuelve preguntas específicas para el humano.

Formato del plan (JSON válido):
{
  "analysis": "resumen del análisis",
  "sufficient_info": true/false,
  "questions": ["pregunta 1", "pregunta 2"],
  "plan": {
    "agents": [{"name": "...", "role": "researcher|developer|writer|analyst"}],
    "tasks": [{"title": "...", "type": "...", "assignedTo": "agentName", "dependencies": []}]
  }
}

Responde en español. SOLO el JSON, sin texto adicional.`,
    variables: [],
  },
  {
    key: 'auditor_review',
    category: 'task',
    name: 'Auditor Review - Default',
    description: 'Revisión de tarea fallida por el Auditor. Decide recovery.',
    content: `Eres un analista que revisa si hay información suficiente para crear un plan de trabajo.

Analiza el error de la tarea fallida y decide la acción de recuperación:
- "reassign": reasignar a otro agente
- "refine": refinar el prompt/input y reintentar
- "escalate": escalar a humano
- "retry": reintentar igual

Devuelve JSON: {"action": "...", "reasoning": "...", "modified_input": "..."}

Responde en español. SOLO el JSON.`,
    variables: [],
  },
]

async function seed() {
  console.log('🔌 Connecting to MongoDB...')
  await mongoose.connect(MONGO_URI)

  let created = 0
  let skipped = 0

  for (const p of GLOBAL_PROMPTS) {
    const existing = await Prompt.findOne({ key: p.key, scope: 'global', active: true })
    if (existing) {
      console.log(`  ⏭️  ${p.key} (already exists, skipped)`)
      skipped++
      continue
    }
    await Prompt.create({ ...p, scope: 'global', version: 1 })
    console.log(`  ✅ ${p.key} (${p.category})`)
    created++
  }

  console.log(`\n📦 Seed complete: ${created} created, ${skipped} skipped`)
  await mongoose.disconnect()
}

seed().catch(err => {
  console.error('❌ Seed failed:', err.message)
  process.exit(1)
})
