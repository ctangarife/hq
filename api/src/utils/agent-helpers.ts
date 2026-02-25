import Agent from '../models/Agent.js'

/**
 * Helper function to find an agent by _id (ObjectId) or containerId (string)
 * This is needed because some parts of the code pass containerId where agentId is expected
 *
 * @param id - Either an agent _id (24 hex chars) or containerId (64 hex chars)
 * @returns The agent document or null if not found
 */
export async function findAgentByIdOrContainerId(id: string) {
  if (!id) {
    return null
  }

  // Check if ID is a valid ObjectId (24 hex characters)
  const isValidObjectId = /^[0-9a-fA-F]{24}$/.test(id)

  // Try to find by _id first if it's a valid ObjectId
  let agent
  if (isValidObjectId) {
    agent = await Agent.findById(id)
  }

  // If not found by _id, try to find by containerId
  if (!agent) {
    agent = await Agent.findOne({ containerId: id })
  }

  return agent
}

/**
 * Helper function to get containerId from an agentId or containerId
 *
 * @param id - Either an agent _id or containerId
 * @returns The containerId if found, otherwise returns the original id
 */
export async function getContainerId(id: string): Promise<string> {
  if (!id) {
    return id
  }

  const agent = await findAgentByIdOrContainerId(id)
  return agent?.containerId || id
}
