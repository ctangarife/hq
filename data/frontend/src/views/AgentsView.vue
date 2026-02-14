<script setup lang="ts">
import { ref, onMounted } from "vue";
import { agentsService } from "@/services/api";

interface Agent {
  _id: string;
  name: string;
  role: string;
  personality?: string;
  llmModel?: string;
  provider?: string;
  apiKey?: string;
  containerId?: string;
  status: string;
}

const agents = ref<Agent[]>([]);
const loading = ref(true);
const showCreateModal = ref(false);
const showEditModal = ref(false);
const editingAgent = ref<Agent | null>(null);
const submitting = ref(false);

const formData = ref({
  name: "",
  role: "Developer",
  personality: "",
  llmModel: "glm-4.7",
  provider: "zai",
  apiKey: "",
});
//CACHE_BUSTER_123456789
console.log("CACHE BUSTED");

async function fetchAgents() {
  try {
    loading.value = true;
    const response = await agentsService.getAll();
    agents.value = response.data;
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
}

function resetForm() {
  formData.value = {
    name: "",
    role: "Developer",
    personality: "",
    llmModel: "glm-4.7",
    provider: "zai",
    apiKey: "",
  };
}

// TEST FUNCTION - should trigger rebuild
function testRebuild() {
  console.log("Testing rebuild trigger");
  return true;
}

function openCreateModal() {
  resetForm();
  testRebuild();
  showCreateModal.value = true;
}

function openEditModal(agent: Agent) {
  editingAgent.value = agent;
  formData.value = {
    name: agent.name,
    role: agent.role,
    personality: agent.personality || "",
    llmModel: agent.llmModel || "glm-4.7",
    provider: agent.provider || "zai",
    apiKey: agent.apiKey || "",
  };
  showEditModal.value = true;
}

async function createAgent() {
  try {
    submitting.value = true;
    await agentsService.create({
      name: formData.value.name,
      role: formData.value.role,
      personality: formData.value.personality,
      llmModel: formData.value.llmModel,
      provider: formData.value.provider,
      apiKey: formData.value.apiKey || undefined,
    });
    showCreateModal.value = false;
    resetForm();
    await fetchAgents();
  } catch (err) {
    alert("Error creating agent");
  } finally {
    submitting.value = false;
  }
}

async function updateAgent() {
  if (!editingAgent.value) return;
  try {
    submitting.value = true;
    const agentId = editingAgent.value._id;
    if (editingAgent.value.containerId) {
      await agentsService.destroyContainer(agentId);
    }
    await agentsService.update(agentId, {
      name: formData.value.name,
      role: formData.value.role,
      personality: formData.value.personality,
      llmModel: formData.value.llmModel,
      provider: formData.value.provider,
      apiKey: formData.value.apiKey || undefined,
    });
    showEditModal.value = false;
    editingAgent.value = null;
    resetForm();
    await fetchAgents();
  } catch (err) {
    alert("Error updating agent");
  } finally {
    submitting.value = false;
  }
}

async function deleteAgent(id: string) {
  if (!confirm("Delete this agent?")) return;
  try {
    await agentsService.delete(id);
    await fetchAgents();
  } catch (err) {
    alert("Error deleting agent");
  }
}

async function deployAgent(id: string) {
  try {
    await agentsService.deploy(id);
    await fetchAgents();
  } catch (err) {
    alert("Error deploying agent");
  }
}

async function destroyContainer(id: string) {
  if (!confirm("Destroy containers?")) return;
  try {
    await agentsService.destroyContainer(id);
    await fetchAgents();
  } catch (err) {
    alert("Error destroying container");
  }
}

onMounted(() => {
  fetchAgents();
});
</script>

<template>
  <div class="p-6">
    <header class="flex justify-between items-center mb-8">
      <h1 class="text-3xl font-bold text-white">Agents</h1>
      <button
        @click="openCreateModal()"
        class="px-4 py-2 bg-green-600 text-white rounded"
      >
        + New Agent
      </button>
    </header>

    <div v-if="loading" class="text-center py-12 text-gray-400">Loading...</div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="agent in agents"
        :key="agent._id"
        class="bg-gray-800 rounded-lg p-4 border border-gray-700"
      >
        <div class="flex justify-between mb-2">
          <div>
            <h3 class="text-xl font-semibold text-white">{{ agent.name }}</h3>
            <p class="text-gray-400 text-sm">{{ agent.role }}</p>
          </div>
          <span class="px-2 py-1 rounded text-xs bg-gray-700 text-gray-300">{{
            agent.status
          }}</span>
        </div>

        <p v-if="agent.personality" class="text-gray-500 text-sm mb-4">
          {{ agent.personality }}
        </p>

        <div class="text-sm text-gray-500 mb-4">
          Model: {{ agent.llmModel || "N/A" }} ({{ agent.provider || "N/A" }})
        </div>

        <div v-if="agent.containerId" class="text-xs bg-gray-900 rounded p-2 mb-4">
          Container: {{ agent.containerId.slice(0, 12) }}
        </div>

        <div class="flex flex-col gap-2">
          <button
            @click="openEditModal(agent)"
            class="px-3 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded text-sm"
          >
            Editar Agente
          </button>
          <button
            v-if="!agent.containerId"
            @click="deployAgent(agent._id)"
            class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
          >
            Deploy
          </button>
          <div v-else class="flex gap-2">
            <button
              @click="destroyContainer(agent._id)"
              class="flex-1 px-3 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded text-sm"
            >
              Destroy
            </button>
          </div>
          <button
            @click="deleteAgent(agent._id)"
            class="px-3 py-2 text-red-400 hover:bg-red-900/20 rounded text-sm"
          >
            Delete
          </button>
        </div>
      </div>
    </div>

    <!-- Create Modal -->
    <div
      v-if="showCreateModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 class="text-xl font-bold text-white mb-4">New Agent</h2>
        <form @submit.prevent="createAgent()" class="space-y-4">
          <div>
            <label class="block text-gray-400 text-sm mb-1">Name *</label
            ><input
              v-model="formData.name"
              type="text"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              required
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Role *</label
            ><select
              v-model="formData.role"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option>Developer</option>
              <option>Researcher</option>
              <option>Squad Lead</option>
              <option>Writer</option>
              <option>Designer</option>
            </select>
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Personality</label
            ><textarea
              v-model="formData.personality"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              rows="3"
            ></textarea>
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">API Key (optional)</label
            ><input
              v-model="formData.apiKey"
              type="password"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            />
          </div>
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              @click="showCreateModal = false"
              class="px-4 py-2 text-gray-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="px-4 py-2 bg-green-600 text-white rounded"
            >
              {{ submitting ? "Creating..." : "Create" }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Edit Modal -->
    <div
      v-if="showEditModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 class="text-xl font-bold text-white mb-4">Edit Agent</h2>
        <p class="text-yellow-400 text-sm mb-4">
          Container will be destroyed and redeployed on save
        </p>
        <form @submit.prevent="updateAgent()" class="space-y-4">
          <div>
            <label class="block text-gray-400 text-sm mb-1">Name *</label
            ><input
              v-model="formData.name"
              type="text"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              required
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Role *</label
            ><select
              v-model="formData.role"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            >
              <option>Developer</option>
              <option>Researcher</option>
              <option>Squad Lead</option>
              <option>Writer</option>
              <option>Designer</option>
            </select>
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Personality</label
            ><textarea
              v-model="formData.personality"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              rows="3"
            ></textarea>
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">API Key (optional)</label
            ><input
              v-model="formData.apiKey"
              type="password"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            />
          </div>
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              @click="
                showEditModal = false;
                editingAgent = null;
              "
              class="px-4 py-2 text-gray-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="px-4 py-2 bg-purple-600 text-white rounded"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
# Force cache bust 1771085058
