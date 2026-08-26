<script setup lang="ts">
import { ref, onMounted, computed } from "vue";
import {
  workspacesService,
  promptsService,
  llmConfigService,
  authService,
} from "@/services/api";

// ============================================================================
// Tab state
// ============================================================================
const activeTab = ref<"workspaces" | "members" | "prompts" | "llm">("workspaces");

// ============================================================================
// Workspaces tab
// ============================================================================
interface Workspace {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  ownerId: string;
  members: { userId: string; role: string; email?: string }[];
  avatarStyle?: string;
  active: boolean;
}
interface Project {
  _id: string;
  name: string;
  slug: string;
  description?: string;
  status: string;
}

const workspaces = ref<Workspace[]>([]);
const workspacesLoading = ref(true);
const expandedWs = ref<string | null>(null);
const wsProjects = ref<Record<string, Project[]>>({});
const showWsModal = ref(false);
const showProjectModal = ref(false);
const projectTargetWs = ref<string>("");
const wsForm = ref({ name: "", slug: "", description: "", ownerId: "admin" });
const projectForm = ref({ name: "", slug: "", description: "" });
const submitting = ref(false);

async function fetchWorkspaces() {
  try {
    workspacesLoading.value = true;
    const res = await workspacesService.getAll();
    workspaces.value = res.data;
  } catch (err: any) {
    console.error(err);
    alert("Error cargando workspaces: " + (err.message || ""));
  } finally {
    workspacesLoading.value = false;
  }
}

async function toggleExpand(wsId: string) {
  if (expandedWs.value === wsId) {
    expandedWs.value = null;
    return;
  }
  expandedWs.value = wsId;
  if (!wsProjects.value[wsId]) {
    try {
      const res = await workspacesService.getProjects(wsId);
      wsProjects.value[wsId] = res.data;
    } catch (err: any) {
      console.error(err);
      wsProjects.value[wsId] = [];
    }
  }
}

function openWsModal() {
  wsForm.value = { name: "", slug: "", description: "", ownerId: "admin" };
  showWsModal.value = true;
}

function openProjectModal(wsId: string) {
  projectTargetWs.value = wsId;
  projectForm.value = { name: "", slug: "", description: "" };
  showProjectModal.value = true;
}

async function submitWorkspace() {
  try {
    submitting.value = true;
    await workspacesService.create({ ...wsForm.value });
    showWsModal.value = false;
    await fetchWorkspaces();
  } catch (err: any) {
    const msg = err.response?.data?.error || err.message || "Unknown error";
    alert("Error creando workspace: " + msg);
  } finally {
    submitting.value = false;
  }
}

async function submitProject() {
  try {
    submitting.value = true;
    await workspacesService.createProject(projectTargetWs.value, {
      ...projectForm.value,
    });
    showProjectModal.value = false;
    // Refrescar proyectos del workspace
    const res = await workspacesService.getProjects(projectTargetWs.value);
    wsProjects.value[projectTargetWs.value] = res.data;
  } catch (err: any) {
    const msg = err.response?.data?.error || err.message || "Unknown error";
    alert("Error creando proyecto: " + msg);
  } finally {
    submitting.value = false;
  }
}

async function deleteWorkspace(wsId: string, name: string) {
  if (!confirm(`¿Eliminar workspace "${name}"? Esto no borra sus misiones.`))
    return;
  try {
    await workspacesService.delete(wsId);
    await fetchWorkspaces();
  } catch (err: any) {
    alert("Error eliminando: " + (err.message || ""));
  }
}

// ============================================================================
// ============================================================================
// Members tab — Invitaciones y gestión de usuarios del workspace
// ============================================================================
interface Invitation {
  _id: string;
  email: string;
  workspaceName: string;
  role: string;
  invitedByName: string;
  sentAt: string;
  expiresAt: string;
  acceptedAt?: string;
  revokedAt?: string;
}

const invitations = ref<Invitation[]>([]);
const invitationsLoading = ref(true);
const inviteEmail = ref("");
const inviteRole = ref("workspace_member");
const inviteWsId = ref("");
const inviting = ref(false);
const inviteResult = ref<string | null>(null);
const newWorkspaceName = ref("");
const selectedWsForInvite = computed(() =>
  workspaces.value.find(w => w._id === inviteWsId.value)
);

async function fetchInvitations() {
  if (!inviteWsId.value) return;
  try {
    invitationsLoading.value = true;
    const res = await authService.listInvitations(inviteWsId.value);
    invitations.value = res.data;
  } catch {
    invitations.value = [];
  } finally {
    invitationsLoading.value = false;
  }
}

async function sendInvitation() {
  if (!inviteEmail.value) return;
  inviting.value = true;
  inviteResult.value = null;
  try {
    // Si no hay workspace seleccionado pero hay nombre de workspace nuevo → crear + invitar
    if (!inviteWsId.value && newWorkspaceName.value.trim()) {
      const slug = newWorkspaceName.value.trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
      const ws = await workspacesService.create({
        name: newWorkspaceName.value.trim(),
        slug,
        ownerId: "admin",
        description: `Workspace para ${newWorkspaceName.value.trim()}`,
      });
      inviteWsId.value = ws.data._id;
      await fetchWorkspaces(); // refrescar lista
      newWorkspaceName.value = "";
    }

    if (!inviteWsId.value) {
      inviteResult.value = "❌ Seleccione un workspace o escriba el nombre para crear uno nuevo";
      return;
    }

    await authService.createInvitation(inviteEmail.value, inviteWsId.value, inviteRole.value);
    inviteResult.value = `✅ Invitación enviada a ${inviteEmail.value}`;
    inviteEmail.value = "";
    await fetchInvitations();
  } catch (err: any) {
    inviteResult.value = `❌ ${err.response?.data?.error || err.message}`;
  } finally {
    inviting.value = false;
  }
}

async function revokeInvitation(inv: Invitation) {
  if (!confirm(`¿Revocar invitación de ${inv.email}?`)) return;
  try {
    await authService.revokeInvitation(inv._id);
    await fetchInvitations();
  } catch {
    // silent
  }
}

function roleLabel(role: string): string {
  const labels: Record<string, string> = {
    workspace_owner: "Propietario",
    workspace_manager: "Admin",
    workspace_member: "Miembro",
    workspace_viewer: "Lector",
  };
  return labels[role] || role;
}

// Descripciones de roles para el selector de invitación
const roleDescriptions: Record<string, { label: string; desc: string; perms: string }> = {
  workspace_owner: {
    label: "Propietario",
    desc: "Control total: crea misiones, invita gente, gestiona prompts, puede eliminar el workspace.",
    perms: "TODO",
  },
  workspace_manager: {
    label: "Admin",
    desc: "Casi todo control: crea misiones, invita gente, ajusta prompts. No puede eliminar el workspace.",
    perms: "Menos eliminar",
  },
  workspace_member: {
    label: "Miembro",
    desc: "Crea misiones, ve resultados y descarga entregables. No puede invitar ni cambiar configuración.",
    perms: "Crear + ver",
  },
  workspace_viewer: {
    label: "Lector",
    desc: "Solo ve resultados y descarga entregables. No puede crear ni modificar nada.",
    perms: "Solo lectura",
  },
};

function invitationStatus(inv: Invitation): string {
  if (inv.acceptedAt) return "aceptada";
  if (inv.revokedAt) return "revocada";
  if (new Date(inv.expiresAt) < new Date()) return "expirada";
  return "pendiente";
}

// Prompts tab
// ============================================================================
interface Prompt {
  _id: string;
  key: string;
  scope: "global" | "workspace" | "project";
  name: string;
  description?: string;
  content: string;
  variables: string[];
  category: "role" | "task";
  version: number;
  active: boolean;
}

const prompts = ref<Prompt[]>([]);
const promptsLoading = ref(true);
const promptScopeFilter = ref("");
const promptCategoryFilter = ref("");
const editingPrompt = ref<Prompt | null>(null);
const showPromptModal = ref(false);
const promptForm = ref({
  key: "",
  scope: "global" as "global" | "workspace" | "project",
  name: "",
  description: "",
  content: "",
  variables: [] as string[],
  category: "role" as "role" | "task",
});
const previewVars = ref<Record<string, string>>({});
const previewResult = ref("");
const previewLoading = ref(false);

const filteredPrompts = computed(() => {
  return prompts.value.filter((p) => {
    if (promptScopeFilter.value && p.scope !== promptScopeFilter.value)
      return false;
    if (promptCategoryFilter.value && p.category !== promptCategoryFilter.value)
      return false;
    return true;
  });
});

async function fetchPrompts() {
  try {
    promptsLoading.value = true;
    const res = await promptsService.getAll();
    prompts.value = res.data;
  } catch (err: any) {
    console.error(err);
    alert("Error cargando prompts: " + (err.message || ""));
  } finally {
    promptsLoading.value = false;
  }
}

function openPromptEditor(prompt: Prompt) {
  editingPrompt.value = prompt;
  promptForm.value = {
    key: prompt.key,
    scope: prompt.scope,
    name: prompt.name,
    description: prompt.description || "",
    content: prompt.content,
    variables: [...prompt.variables],
    category: prompt.category,
  };
  // Inicializar vars de preview con valores vacíos
  previewVars.value = {};
  prompt.variables.forEach((v) => (previewVars.value[v] = ""));
  previewResult.value = "";
  showPromptModal.value = true;
}

function openNewPromptModal() {
  editingPrompt.value = null;
  promptForm.value = {
    key: "",
    scope: "global",
    name: "",
    description: "",
    content: "",
    variables: [],
    category: "role",
  };
  previewVars.value = {};
  previewResult.value = "";
  showPromptModal.value = true;
}

// Helper para mostrar {{varName}} como literal en el template (evita que
// Vue lo interprete como interpolación).
function varPlaceholder(varName: string): string {
  return `{{${varName}}}`;
}

async function generatePreview() {
  if (!promptForm.value.key) return;
  try {
    previewLoading.value = true;
    const res = await promptsService.resolve(promptForm.value.key, {
      ...previewVars.value,
    });
    previewResult.value = res.data.content;
  } catch (err: any) {
    previewResult.value = "Error: " + (err.message || "no se pudo resolver");
  } finally {
    previewLoading.value = false;
  }
}

async function savePrompt() {
  try {
    submitting.value = true;
    await promptsService.upsert({ ...promptForm.value });
    showPromptModal.value = false;
    await fetchPrompts();
  } catch (err: any) {
    const msg = err.response?.data?.error || err.message || "Unknown error";
    alert("Error guardando prompt: " + msg);
  } finally {
    submitting.value = false;
  }
}

async function deletePrompt(prompt: Prompt) {
  if (!confirm(`¿Desactivar prompt "${prompt.key}" (${prompt.scope})?`))
    return;
  try {
    await promptsService.delete(prompt._id);
    await fetchPrompts();
  } catch (err: any) {
    alert("Error: " + (err.message || ""));
  }
}

// ============================================================================
// LLM Keys tab
// ============================================================================
interface LlmConfig {
  _id: string;
  alias: string;
  scope: string;
  keyPreview: string;
  models: string[];
  maxBudget: number;
  budgetDuration: string;
  rpmLimit: number;
  active: boolean;
}

const llmConfigs = ref<LlmConfig[]>([]);
const llmLoading = ref(true);

async function fetchLlmConfigs() {
  try {
    llmLoading.value = true;
    const res = await llmConfigService.getAll();
    llmConfigs.value = res.data;
  } catch (err: any) {
    console.error(err);
    alert("Error cargando LLM keys: " + (err.message || ""));
  } finally {
    llmLoading.value = false;
  }
}

// ============================================================================
// Carga inicial
// ============================================================================
onMounted(() => {
  fetchWorkspaces();
  fetchPrompts();
  fetchLlmConfigs();
});
</script>

<template>
  <div class="p-6">
    <header class="flex justify-between items-center mb-6">
      <div>
        <h1 class="text-3xl font-bold text-white">Admin</h1>
        <p class="text-gray-400 text-sm mt-1">
          Gestión multi-tenant: workspaces, prompts editables y LLM keys
        </p>
      </div>
    </header>

    <!-- Tabs -->
    <div class="flex gap-2 mb-6 border-b border-gray-700">
      <button
        v-for="tab in [
          { id: 'workspaces', label: 'Workspaces', icon: '🏢' },
          { id: 'members', label: 'Miembros', icon: '👥' },
          { id: 'prompts', label: 'Prompts', icon: '📝' },
          { id: 'llm', label: 'LLM Keys', icon: '🔑' },
        ]"
        :key="tab.id"
        @click="activeTab = tab.id as any; if (tab.id === 'members' && inviteWsId) fetchInvitations()"
        class="px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px"
        :class="
          activeTab === tab.id
            ? 'border-blue-500 text-white'
            : 'border-transparent text-gray-400 hover:text-white'
        "
      >
        <span class="mr-1">{{ tab.icon }}</span>
        {{ tab.label }}
      </button>
    </div>

    <!-- ====================================================================
         TAB: WORKSPACES
         ==================================================================== -->
    <div v-show="activeTab === 'workspaces'">
      <div class="flex justify-end mb-4">
        <button
          @click="openWsModal()"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          + Crear Workspace
        </button>
      </div>

      <div v-if="workspacesLoading" class="text-center py-12 text-gray-400">
        Cargando workspaces...
      </div>

      <div
        v-else-if="workspaces.length === 0"
        class="text-center py-12 text-gray-400"
      >
        No hay workspaces. Crea uno para empezar a organizar misiones por
        cliente/proyecto.
      </div>

      <div v-else class="space-y-3">
        <div
          v-for="ws in workspaces"
          :key="ws._id"
          class="bg-gray-800 rounded-lg border border-gray-700 overflow-hidden"
        >
          <!-- Header de workspace (click para expandir) -->
          <div
            class="p-4 flex justify-between items-center cursor-pointer hover:bg-gray-750"
            @click="toggleExpand(ws._id)"
          >
            <div class="flex items-center gap-3">
              <span class="text-gray-500">{{ expandedWs === ws._id ? "▼" : "▶" }}</span>
              <div>
                <h3 class="text-lg font-semibold text-white">{{ ws.name }}</h3>
                <p class="text-gray-500 text-sm font-mono">{{ ws.slug }}</p>
              </div>
            </div>
            <div class="flex items-center gap-4 text-sm text-gray-400">
              <span>{{ ws.members.length }} miembros</span>
              <span
                class="px-2 py-1 rounded text-xs"
                :class="ws.active ? 'bg-green-900 text-green-300' : 'bg-gray-700'"
              >
                {{ ws.active ? "Activo" : "Inactivo" }}
              </span>
            </div>
          </div>

          <!-- Proyectos expandidos -->
          <div v-if="expandedWs === ws._id" class="border-t border-gray-700 bg-gray-900/50">
            <div class="p-4">
              <div class="flex justify-between items-center mb-3">
                <h4 class="text-sm font-medium text-gray-300 uppercase">
                  Proyectos
                </h4>
                <button
                  @click="openProjectModal(ws._id)"
                  class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
                >
                  + Proyecto
                </button>
              </div>

              <div v-if="wsProjects[ws._id]?.length === 0" class="text-gray-500 text-sm py-2">
                Sin proyectos todavía.
              </div>

              <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                <div
                  v-for="proj in wsProjects[ws._id] || []"
                  :key="proj._id"
                  class="bg-gray-800 rounded p-3 border border-gray-700"
                >
                  <div class="font-medium text-white text-sm">{{ proj.name }}</div>
                  <div class="text-gray-500 text-xs font-mono">{{ proj.slug }}</div>
                  <span class="inline-block mt-1 px-2 py-0.5 rounded text-xs bg-gray-700 text-gray-300">
                    {{ proj.status }}
                  </span>
                </div>
              </div>
            </div>

            <div class="px-4 pb-3">
              <button
                @click="deleteWorkspace(ws._id, ws.name)"
                class="text-red-400 hover:text-red-300 text-xs"
              >
                Eliminar workspace
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ====================================================================
         TAB: MEMBERS (Invitaciones)
         ==================================================================== -->
    <div v-show="activeTab === 'members'">
      <div class="bg-slate-800 rounded-xl p-5 border border-slate-700/60 mb-6">
        <h3 class="text-sm font-semibold text-slate-200 mb-4">📨 Invitar a un workspace</h3>
        <div class="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label class="block text-slate-400 text-xs mb-1">
              Workspace existente
              <span class="text-slate-600">o cree uno nuevo abajo</span>
            </label>
            <select v-model="inviteWsId" @change="fetchInvitations(); newWorkspaceName = ''" class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm">
              <option value="">— Crear workspace nuevo —</option>
              <option v-for="ws in workspaces" :key="ws._id" :value="ws._id">{{ ws.name }}</option>
            </select>
            <input
              v-if="!inviteWsId"
              v-model="newWorkspaceName"
              type="text"
              placeholder="Nombre del nuevo workspace (ej: La Estantería)"
              class="w-full mt-2 px-3 py-2 bg-slate-900 border border-purple-600/50 rounded-lg text-white text-sm"
            />
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Email</label>
            <input v-model="inviteEmail" type="email" placeholder="persona@email.com" class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm" />
          </div>
          <div>
            <label class="block text-slate-400 text-xs mb-1">Rol</label>
            <select v-model="inviteRole" class="w-full px-3 py-2 bg-slate-900 border border-slate-600 rounded-lg text-white text-sm">
              <option value="workspace_owner">Propietario</option>
              <option value="workspace_manager">Admin</option>
              <option value="workspace_member">Miembro</option>
              <option value="workspace_viewer">Lector</option>
            </select>
            <p class="text-slate-500 text-xs mt-1.5 leading-snug transition-all">
              <span class="text-purple-300 font-medium">{{ roleDescriptions[inviteRole]?.label }}:</span>
              {{ roleDescriptions[inviteRole]?.desc }}
            </p>
          </div>
          <div class="flex items-end">
            <button @click="sendInvitation()" :disabled="inviting || !inviteEmail || (!inviteWsId && !newWorkspaceName.trim())" class="w-full px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg text-sm font-medium transition disabled:opacity-50">
              {{ inviting ? 'Enviando…' : '📨 Invitar' }}
            </button>
          </div>
        </div>
        <div v-if="inviteResult" class="mt-3 p-3 rounded-lg text-sm" :class="inviteResult.startsWith('✅') ? 'bg-green-900/30 text-green-300' : 'bg-red-900/30 text-red-300'">
          {{ inviteResult }}
        </div>
      </div>

      <div v-if="!inviteWsId" class="text-center py-12 text-slate-500">Seleccione un workspace</div>
      <div v-else-if="invitationsLoading" class="text-center py-8 text-slate-400">Cargando…</div>
      <div v-else-if="invitations.length === 0" class="text-center py-8 text-slate-500">Sin invitaciones todavía</div>
      <div v-else class="space-y-2">
        <div v-for="inv in invitations" :key="inv._id" class="bg-slate-800/60 rounded-lg p-4 border border-slate-700/40 flex items-center justify-between">
          <div>
            <p class="text-white text-sm font-medium">{{ inv.email }}</p>
            <p class="text-slate-500 text-xs">{{ roleLabel(inv.role) }} · por {{ inv.invitedByName }}</p>
          </div>
          <div class="flex items-center gap-3">
            <span class="px-2.5 py-1 rounded-full text-xs font-medium" :class="{
              'bg-green-900/50 text-green-300': invitationStatus(inv) === 'aceptada',
              'bg-yellow-900/50 text-yellow-300': invitationStatus(inv) === 'pendiente',
              'bg-red-900/50 text-red-300': invitationStatus(inv) === 'revocada',
              'bg-slate-700 text-slate-400': invitationStatus(inv) === 'expirada',
            }">{{ invitationStatus(inv) }}</span>
            <button v-if="invitationStatus(inv) === 'pendiente'" @click="revokeInvitation(inv)" class="text-red-400 hover:text-red-300 text-xs">Revocar</button>
          </div>
        </div>
      </div>

      <div v-if="selectedWsForInvite?.members?.length" class="mt-6">
        <h3 class="text-sm font-semibold text-slate-200 mb-3">👥 Miembros actuales</h3>
        <div class="space-y-2">
          <div v-for="m in selectedWsForInvite.members" :key="m.userId" class="bg-slate-900/50 rounded-lg p-3 border border-slate-700/30 flex items-center justify-between">
            <div>
              <p class="text-white text-sm">{{ m.email }}</p>
              <p class="text-slate-500 text-xs">{{ roleLabel(m.role) }}</p>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- ====================================================================
         TAB: PROMPTS
         ==================================================================== -->
    <div v-show="activeTab === 'prompts'">
      <!-- Filtros + crear -->
      <div class="flex flex-wrap items-center gap-3 mb-4">
        <select
          v-model="promptScopeFilter"
          class="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
        >
          <option value="">Todos los scopes</option>
          <option value="global">global</option>
          <option value="workspace">workspace</option>
          <option value="project">project</option>
        </select>
        <select
          v-model="promptCategoryFilter"
          class="px-3 py-2 bg-gray-800 border border-gray-700 rounded text-white text-sm"
        >
          <option value="">Todas las categorías</option>
          <option value="role">role</option>
          <option value="task">task</option>
        </select>
        <div class="flex-1"></div>
        <button
          @click="openNewPromptModal()"
          class="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
        >
          + Crear Prompt
        </button>
      </div>

      <div v-if="promptsLoading" class="text-center py-12 text-gray-400">
        Cargando prompts...
      </div>

      <div
        v-else-if="filteredPrompts.length === 0"
        class="text-center py-12 text-gray-400"
      >
        No hay prompts con esos filtros.
      </div>

      <div v-else class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-left text-gray-400 border-b border-gray-700">
              <th class="py-2 px-3">Key</th>
              <th class="py-2 px-3">Nombre</th>
              <th class="py-2 px-3">Scope</th>
              <th class="py-2 px-3">Categoría</th>
              <th class="py-2 px-3">Versión</th>
              <th class="py-2 px-3">Acciones</th>
            </tr>
          </thead>
          <tbody>
            <tr
              v-for="prompt in filteredPrompts"
              :key="prompt._id"
              class="border-b border-gray-800 hover:bg-gray-800/50"
            >
              <td class="py-2 px-3 font-mono text-blue-300">{{ prompt.key }}</td>
              <td class="py-2 px-3 text-white">{{ prompt.name }}</td>
              <td class="py-2 px-3">
                <span
                  class="px-2 py-0.5 rounded text-xs"
                  :class="{
                    'bg-purple-900 text-purple-300': prompt.scope === 'global',
                    'bg-blue-900 text-blue-300': prompt.scope === 'workspace',
                    'bg-green-900 text-green-300': prompt.scope === 'project',
                  }"
                >
                  {{ prompt.scope }}
                </span>
              </td>
              <td class="py-2 px-3 text-gray-400">{{ prompt.category }}</td>
              <td class="py-2 px-3 text-gray-400">v{{ prompt.version }}</td>
              <td class="py-2 px-3">
                <div class="flex gap-2">
                  <button
                    @click="openPromptEditor(prompt)"
                    class="text-blue-400 hover:text-blue-300 text-xs"
                  >
                    Editar
                  </button>
                  <button
                    @click="deletePrompt(prompt)"
                    class="text-red-400 hover:text-red-300 text-xs"
                  >
                    Eliminar
                  </button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- ====================================================================
         TAB: LLM KEYS
         ==================================================================== -->
    <div v-show="activeTab === 'llm'">
      <div v-if="llmLoading" class="text-center py-12 text-gray-400">
        Cargando LLM keys...
      </div>

      <div
        v-else-if="llmConfigs.length === 0"
        class="text-center py-12 text-gray-400"
      >
        No hay virtual keys configuradas. Seedea una vía POST /api/llm-config.
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div
          v-for="cfg in llmConfigs"
          :key="cfg._id"
          class="bg-gray-800 rounded-lg p-4 border border-gray-700"
          :class="{ 'ring-2 ring-green-500': cfg.active }"
        >
          <div class="flex justify-between items-start mb-2">
            <div>
              <h3 class="text-lg font-semibold text-white">{{ cfg.alias }}</h3>
              <p class="text-gray-500 text-xs font-mono">{{ cfg.keyPreview }}</p>
            </div>
            <span
              class="px-2 py-1 rounded text-xs"
              :class="cfg.active ? 'bg-green-900 text-green-300' : 'bg-gray-700'"
            >
              {{ cfg.active ? "Activa" : "Inactiva" }}
            </span>
          </div>
          <div class="text-sm text-gray-400 space-y-1">
            <div>Scope: <span class="text-gray-300">{{ cfg.scope }}</span></div>
            <div>
              Modelos:
              <span class="text-gray-300">{{ cfg.models.join(", ") }}</span>
            </div>
            <div>
              Budget: <span class="text-gray-300">${{ cfg.maxBudget }}/{{ cfg.budgetDuration }}</span>
              · RPM: <span class="text-gray-300">{{ cfg.rpmLimit }}</span>
            </div>
          </div>
          <p class="text-xs text-gray-600 mt-2">
            Gestión de keys (crear/rotar) vía API o el dashboard de LiteLLM.
          </p>
        </div>
      </div>
    </div>

    <!-- ====================================================================
         MODAL: Crear Workspace
         ==================================================================== -->
    <div
      v-if="showWsModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 class="text-xl font-bold text-white mb-4">Crear Workspace</h2>
        <form @submit.prevent="submitWorkspace()" class="space-y-3">
          <div>
            <label class="block text-gray-400 text-sm mb-1">Nombre *</label>
            <input
              v-model="wsForm.name"
              type="text"
              required
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              placeholder="Agencia Éxito"
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Slug *</label>
            <input
              v-model="wsForm.slug"
              type="text"
              required
              pattern="[a-z0-9-]+"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white font-mono"
              placeholder="agencia-exito"
            />
            <p class="text-xs text-gray-500 mt-1">minúsculas, sin espacios</p>
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Descripción</label>
            <textarea
              v-model="wsForm.description"
              rows="2"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            ></textarea>
          </div>
          <div class="flex gap-2 justify-end pt-2">
            <button
              type="button"
              @click="showWsModal = false"
              class="px-4 py-2 text-gray-400"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="px-4 py-2 bg-blue-600 text-white rounded"
            >
              {{ submitting ? "Creando..." : "Crear" }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ====================================================================
         MODAL: Crear Proyecto
         ==================================================================== -->
    <div
      v-if="showProjectModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 class="text-xl font-bold text-white mb-4">Crear Proyecto</h2>
        <form @submit.prevent="submitProject()" class="space-y-3">
          <div>
            <label class="block text-gray-400 text-sm mb-1">Nombre *</label>
            <input
              v-model="projectForm.name"
              type="text"
              required
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              placeholder="Campaña Café Q3"
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Slug *</label>
            <input
              v-model="projectForm.slug"
              type="text"
              required
              pattern="[a-z0-9-]+"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white font-mono"
              placeholder="campana-cafe-q3"
            />
          </div>
          <div>
            <label class="block text-gray-400 text-sm mb-1">Descripción</label>
            <textarea
              v-model="projectForm.description"
              rows="2"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
            ></textarea>
          </div>
          <div class="flex gap-2 justify-end pt-2">
            <button
              type="button"
              @click="showProjectModal = false"
              class="px-4 py-2 text-gray-400"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="px-4 py-2 bg-blue-600 text-white rounded"
            >
              {{ submitting ? "Creando..." : "Crear" }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- ====================================================================
         MODAL: Editor de Prompts (con preview de variables)
         ==================================================================== -->
    <div
      v-if="showPromptModal"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
    >
      <div
        class="bg-gray-800 rounded-lg p-6 w-full max-w-4xl border border-gray-700 max-h-[90vh] overflow-y-auto"
      >
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-white">
            {{ editingPrompt ? "Editar Prompt" : "Crear Prompt" }}
          </h2>
          <button @click="showPromptModal = false" class="text-gray-400 hover:text-white">
            ✕
          </button>
        </div>

        <form @submit.prevent="savePrompt()" class="space-y-4">
          <!-- Metadatos -->
          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-gray-400 text-sm mb-1">Key *</label>
              <input
                v-model="promptForm.key"
                type="text"
                required
                :disabled="!!editingPrompt"
                class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white font-mono disabled:opacity-60"
                placeholder="squad_lead, mission_analysis, ..."
              />
            </div>
            <div>
              <label class="block text-gray-400 text-sm mb-1">Nombre *</label>
              <input
                v-model="promptForm.name"
                type="text"
                required
                class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
                placeholder="Squad Lead - Default"
              />
            </div>
            <div>
              <label class="block text-gray-400 text-sm mb-1">Scope *</label>
              <select
                v-model="promptForm.scope"
                class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              >
                <option value="global">global</option>
                <option value="workspace">workspace</option>
                <option value="project">project</option>
              </select>
            </div>
            <div>
              <label class="block text-gray-400 text-sm mb-1">Categoría</label>
              <select
                v-model="promptForm.category"
                class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              >
                <option value="role">role</option>
                <option value="task">task</option>
              </select>
            </div>
          </div>

          <div>
            <label class="block text-gray-400 text-sm mb-1">Descripción</label>
            <input
              v-model="promptForm.description"
              type="text"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              placeholder="Qué hace este prompt, cuándo se usa"
            />
          </div>

          <!-- Variables -->
          <div>
            <label class="block text-gray-400 text-sm mb-1">
              Variables (placeholders <span v-pre class="font-mono">{{var}}</span>)
            </label>
            <input
              :value="promptForm.variables.join(', ')"
              @input="promptForm.variables = ($event.target as HTMLInputElement).value.split(',').map(v => v.trim()).filter(Boolean)"
              type="text"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white font-mono"
              placeholder="agentName, missionTitle, ..."
            />
            <p class="text-xs text-gray-500 mt-1">
              Separadas por coma. Se reemplazan en runtime vía promptService.
            </p>
          </div>

          <!-- Content -->
          <div>
            <label class="block text-gray-400 text-sm mb-1">Content *</label>
            <textarea
              v-model="promptForm.content"
              rows="10"
              required
              class="w-full px-3 py-2 bg-gray-900 border border-gray-600 rounded text-white font-mono text-sm"
              placeholder="You are {{agentName}}, ..."
            ></textarea>
          </div>

          <!-- Preview de variables (en vivo) -->
          <div
            v-if="promptForm.variables.length > 0"
            class="bg-gray-900 rounded p-4 border border-gray-700"
          >
            <div class="flex justify-between items-center mb-2">
              <h4 class="text-sm font-medium text-gray-300">
                Preview de variables
              </h4>
              <button
                type="button"
                @click="generatePreview()"
                :disabled="previewLoading"
                class="px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded text-xs"
              >
                {{ previewLoading ? "Resolviendo..." : "Generar preview" }}
              </button>
            </div>
            <div class="grid grid-cols-2 gap-2 mb-3">
              <div v-for="v in promptForm.variables" :key="v">
                <label class="block text-gray-500 text-xs mb-1 font-mono">{{ varPlaceholder(v) }}</label>
                <input
                  v-model="previewVars[v]"
                  type="text"
                  class="w-full px-2 py-1 bg-gray-800 border border-gray-700 rounded text-white text-sm"
                  :placeholder="'valor para ' + v"
                />
              </div>
            </div>
            <div v-if="previewResult" class="bg-gray-950 rounded p-3 border border-gray-800">
              <pre class="text-green-300 text-xs whitespace-pre-wrap font-mono">{{ previewResult }}</pre>
            </div>
          </div>

          <div class="flex gap-2 justify-end pt-2">
            <button
              type="button"
              @click="showPromptModal = false"
              class="px-4 py-2 text-gray-400"
            >
              Cancelar
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="px-4 py-2 bg-green-600 text-white rounded"
            >
              {{ submitting ? "Guardando..." : "Guardar" }}
            </button>
          </div>
        </form>
      </div>
    </div>
  </div>
</template>
