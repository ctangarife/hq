import { Router, Response, NextFunction } from 'express'
import { MissionTemplate } from '../models/MissionTemplate.js'
import Mission from '../models/Mission.js'
import { activityLog } from '../services/activity-logger.service.js'

const router = Router()

// GET /api/mission-templates - List all active templates
router.get('/', async (req, res, next) => {
  try {
    const { category, tag } = req.query

    const filter: any = { isActive: true }

    if (category) {
      filter.category = category
    }

    if (tag) {
      filter.tags = tag
    }

    const templates = await MissionTemplate.find(filter).sort({ category: 1, name: 1 })

    res.json(templates)
  } catch (error) {
    next(error)
  }
})

// GET /api/mission-templates/:id - Get template by ID
router.get('/:id', async (req, res, next) => {
  try {
    const template = await MissionTemplate.findOne({ templateId: req.params.id })

    if (!template) {
      return res.status(404).json({ error: 'Template not found' })
    }

    res.json(template)
  } catch (error) {
    next(error)
  }
})

// POST /api/mission-templates - Create custom template (user-defined)
router.post('/', async (req, res, next) => {
  try {
    const {
      name,
      description,
      category,
      defaultTitle,
      defaultDescription,
      defaultObjective,
      defaultType = 'AUTO_ORCHESTRATED',
      defaultPriority = 'medium',
      context,
      audience,
      deliverableFormat,
      successCriteria,
      constraints,
      tone,
      squadLeadRequired = true,
      suggestedAgents = [],
      taskStructure = [],
      icon = '📋',
      tags = [],
      examples = []
    } = req.body

    const template = await MissionTemplate.createTemplate({
      name,
      description,
      category,
      defaultTitle,
      defaultDescription,
      defaultObjective,
      defaultType,
      defaultPriority,
      context,
      audience,
      deliverableFormat,
      successCriteria,
      constraints,
      tone,
      squadLeadRequired,
      suggestedAgents,
      taskStructure,
      icon,
      tags,
      examples,
      isSystem: false,
      isActive: true
    })

    // Log activity
    await activityLog.log({
      type: 'template.created',
      title: template.name,
      templateId: template.templateId,
      timestamp: new Date()
    })

    res.status(201).json(template)
  } catch (error) {
    next(error)
  }
})

// PUT /api/mission-templates/:id - Update template (only user templates)
router.put('/:id', async (req, res, next) => {
  try {
    const template = await MissionTemplate.findOne({ templateId: req.params.id })

    if (!template) {
      return res.status(404).json({ error: 'Template not found' })
    }

    if (template.isSystem) {
      return res.status(403).json({ error: 'Cannot modify system templates' })
    }

    Object.assign(template, req.body)
    await template.save()

    res.json(template)
  } catch (error) {
    next(error)
  }
})

// DELETE /api/mission-templates/:id - Delete template (only user templates)
router.delete('/:id', async (req, res, next) => {
  try {
    const template = await MissionTemplate.findOne({ templateId: req.params.id })

    if (!template) {
      return res.status(404).json({ error: 'Template not found' })
    }

    if (template.isSystem) {
      return res.status(403).json({ error: 'Cannot delete system templates' })
    }

    await MissionTemplate.deleteOne({ templateId: req.params.id })

    // Log activity
    await activityLog.log({
      type: 'template.deleted',
      title: template.name,
      templateId: template.templateId,
      timestamp: new Date()
    })

    res.status(204).send()
  } catch (error) {
    next(error)
  }
})

// POST /api/mission-templates/:id/initialize - Initialize system templates
router.post('/initialize-system', async (req, res, next) => {
  try {
    await MissionTemplate.initializeSystemTemplates()

    res.json({
      message: 'System templates initialized successfully'
    })
  } catch (error) {
    next(error)
  }
})

// POST /api/missions/from-template/:templateId - Create mission from template
router.post('/from-template/:templateId', async (req, res, next) => {
  try {
    const template = await MissionTemplate.findOne({
      templateId: req.params.templateId,
      isActive: true
    })

    if (!template) {
      return res.status(404).json({ error: 'Template not found or inactive' })
    }

    // Get parameters for placeholders
    const { params } = req.body

    // Replace placeholders in default values
    const replacePlaceholders = (text: string, placeholders: Record<string, string>): string => {
      if (!text) return text
      let result = text
      for (const [key, value] of Object.entries(placeholders)) {
        const regex = new RegExp(`\\{${key}\\}`, 'g')
        result = result.replace(regex, value)
      }
      return result
    }

    const missionData = {
      title: replacePlaceholders(template.defaultTitle, params || {}),
      description: replacePlaceholders(template.defaultDescription, params || {}),
      objective: template.defaultObjective ? replacePlaceholders(template.defaultObjective, params || {}) : undefined,
      priority: template.defaultPriority,
      status: 'draft',
      squadIds: [],
      taskIds: [],
      missionType: template.defaultType,
      // Phase 10.1: Context fields
      context: template.context,
      audience: template.audience,
      deliverableFormat: template.deliverableFormat,
      successCriteria: template.successCriteria,
      constraints: template.constraints,
      tone: template.tone
    }

    const mission = new Mission(missionData)
    await mission.save()

    // Log activity
    await activityLog.missionCreated(mission.title, mission._id.toString())
    await activityLog.log({
      type: 'mission.from_template',
      missionId: mission._id.toString(),
      templateId: template.templateId,
      templateName: template.name,
      timestamp: new Date()
    })

    res.status(201).json({
      message: 'Mission created from template',
      mission,
      template: {
        templateId: template.templateId,
        name: template.name,
        category: template.category
      }
    })
  } catch (error) {
    console.error('Error creating mission from template:', error)
    next(error)
  }
})

export default router
