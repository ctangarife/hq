<script setup lang="ts">
import { ref, onMounted } from "vue";
import { providersService } from "@/services/api";

interface Provider {
  _id: string;
  providerId: string;
  name: string;
  type: string;
  enabled: boolean;
  apiEndpoint?: string;
  defaultModel?: string;
  modelsCount: number;
  modelsLastUpdated?: string;
}

interface Model {
  id: string;
  name: string;
  description?: string;
  contextLength?: number;
}

const providers = ref<Provider[]>([]);
const loading = ref(true);
const showApiKeyModal = ref(false);
const showModelsModal = ref(false);
const selectedProvider = ref<Provider | null>(null);
const providerModels = ref<Model[]>([]);
const loadingModels = ref(false);
const submitting = ref(false);

const apiKeyForm = ref({
  apiKey: ""
});

async function fetchProviders() {
  try {
    loading.value = true;
    const response = await providersService.getAll();
    providers.value = response.data;
  } catch (err) {
    console.error(err);
  } finally {
    loading.value = false;
  }
}

function openApiKeyModal(provider: Provider) {
  selectedProvider.value = provider;
  apiKeyForm.value.apiKey = "";
  showApiKeyModal.value = true;
}

async function toggleProvider(provider: Provider, enable: boolean) {
  if (enable) {
    // Open API key modal for enabling
    openApiKeyModal(provider);
  } else {
    // Directly disable
    try {
      await providersService.toggle(provider.providerId, false);
      await fetchProviders();
    } catch (err) {
      alert("Error toggling provider");
    }
  }
}

async function submitApiKey() {
  if (!selectedProvider.value) return;

  try {
    submitting.value = true;
    const response = await providersService.toggle(
      selectedProvider.value.providerId,
      true,
      apiKeyForm.value.apiKey
    );

    showApiKeyModal.value = false;

    if (response.data.modelsFetched) {
      alert(`Provider enabled! ${response.data.modelsCount} models loaded.`);
    } else {
      alert("Provider enabled but failed to fetch models. Try refreshing manually.");
    }

    await fetchProviders();
  } catch (err: any) {
    const errorMsg = err.response?.data?.error || err.message || "Unknown error";
    alert(`Error enabling provider: ${errorMsg}`);
  } finally {
    submitting.value = false;
  }
}

async function viewModels(provider: Provider) {
  selectedProvider.value = provider;
  showModelsModal.value = true;
  await fetchModels(provider.providerId, false);
}

async function fetchModels(providerId: string, refresh: boolean) {
  try {
    loadingModels.value = true;
    const response = await providersService.getModels(providerId, refresh);
    providerModels.value = response.data.models;
  } catch (err: any) {
    const errorMsg = err.response?.data?.error || err.message || "Failed to fetch models";
    alert(errorMsg);
    providerModels.value = [];
  } finally {
    loadingModels.value = false;
  }
}

async function refreshModels() {
  if (!selectedProvider.value) return;
  await fetchModels(selectedProvider.value.providerId, true);
}

function formatDate(dateStr?: string): string {
  if (!dateStr) return "Never";
  return new Date(dateStr).toLocaleString();
}

onMounted(() => {
  fetchProviders();
});
</script>

<template>
  <div class="p-6">
    <header class="flex justify-between items-center mb-8">
      <h1 class="text-3xl font-bold text-white">LLM Providers</h1>
      <button
        @click="fetchProviders()"
        class="px-4 py-2 bg-slate-700 text-white rounded hover:bg-slate-600"
      >
        Refresh
      </button>
    </header>

    <div v-if="loading" class="text-center py-12 text-gray-400">Loading providers...</div>

    <div v-else class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      <div
        v-for="provider in providers"
        :key="provider._id"
        class="bg-gray-800 rounded-lg p-4 border border-gray-700"
        :class="{ 'ring-2 ring-green-500': provider.enabled }"
      >
        <div class="flex justify-between items-start mb-3">
          <div>
            <h3 class="text-xl font-semibold text-white">{{ provider.name }}</h3>
            <p class="text-gray-400 text-sm">{{ provider.providerId }}</p>
          </div>
          <span
            class="px-2 py-1 rounded text-xs"
            :class="
              provider.enabled
                ? 'bg-green-600 text-white'
                : 'bg-gray-700 text-gray-400'
            "
          >
            {{ provider.enabled ? "Active" : "Inactive" }}
          </span>
        </div>

        <div class="text-sm text-gray-500 mb-2">
          Type: <span class="text-gray-300">{{ provider.type }}</span>
        </div>

        <div v-if="provider.apiEndpoint" class="text-sm text-gray-500 mb-2">
          Endpoint: <span class="text-gray-300 text-xs break-all">{{ provider.apiEndpoint }}</span>
        </div>

        <div class="text-sm text-gray-500 mb-4">
          Models: <span class="text-gray-300">{{ provider.modelsCount }}</span>
          <span v-if="provider.modelsLastUpdated" class="text-xs text-gray-600">
            ({{ formatDate(provider.modelsLastUpdated) }})
          </span>
        </div>

        <div class="flex flex-col gap-2">
          <button
            @click="viewModels(provider)"
            class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
          >
            View Models
          </button>
          <button
            @click="toggleProvider(provider, !provider.enabled)"
            class="px-3 py-2 rounded text-sm"
            :class="
              provider.enabled
                ? 'bg-red-600 hover:bg-red-700 text-white'
                : 'bg-green-600 hover:bg-green-700 text-white'
            "
          >
            {{ provider.enabled ? "Disable" : "Enable" }}
          </button>
        </div>
      </div>
    </div>

    <!-- API Key Modal -->
    <div
      v-if="showApiKeyModal && selectedProvider"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-md border border-gray-700">
        <h2 class="text-xl font-bold text-white mb-4">
          Enable {{ selectedProvider.name }}
        </h2>
        <p class="text-gray-400 text-sm mb-4">
          Enter your API key to enable this provider and fetch available models.
        </p>
        <form @submit.prevent="submitApiKey()" class="space-y-4">
          <div>
            <label class="block text-gray-400 text-sm mb-1">API Key *</label>
            <input
              v-model="apiKeyForm.apiKey"
              type="password"
              class="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded text-white"
              placeholder="Enter your API key"
              required
            />
          </div>
          <div class="flex gap-2 justify-end">
            <button
              type="button"
              @click="showApiKeyModal = false"
              class="px-4 py-2 text-gray-400"
            >
              Cancel
            </button>
            <button
              type="submit"
              :disabled="submitting"
              class="px-4 py-2 bg-green-600 text-white rounded"
            >
              {{ submitting ? "Enabling..." : "Enable" }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <!-- Models Modal -->
    <div
      v-if="showModelsModal && selectedProvider"
      class="fixed inset-0 bg-black/50 flex items-center justify-center z-50"
    >
      <div class="bg-gray-800 rounded-lg p-6 w-full max-w-2xl border border-gray-700 max-h-[80vh] overflow-hidden flex flex-col">
        <div class="flex justify-between items-center mb-4">
          <h2 class="text-xl font-bold text-white">
            {{ selectedProvider.name }} Models
          </h2>
          <button
            @click="showModelsModal = false"
            class="text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div class="flex gap-2 mb-4">
          <button
            @click="refreshModels()"
            :disabled="loadingModels"
            class="px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm"
          >
            {{ loadingModels ? "Refreshing..." : "Refresh from API" }}
          </button>
        </div>

        <div class="overflow-y-auto flex-1">
          <div v-if="loadingModels && providerModels.length === 0" class="text-center py-8 text-gray-400">
            Loading models...
          </div>
          <div v-else-if="providerModels.length === 0" class="text-center py-8 text-gray-400">
            No models available. Make sure the provider is enabled with a valid API key.
          </div>
          <div v-else class="space-y-2">
            <div
              v-for="model in providerModels"
              :key="model.id"
              class="bg-gray-700 rounded p-3"
            >
              <div class="flex justify-between items-start">
                <div>
                  <h4 class="text-white font-medium">{{ model.name }}</h4>
                  <p class="text-gray-400 text-sm font-mono">{{ model.id }}</p>
                </div>
                <span v-if="model.contextLength" class="text-xs text-gray-500">
                  {{ model.contextLength.toLocaleString() }} tokens
                </span>
              </div>
              <p v-if="model.description" class="text-gray-500 text-sm mt-2">
                {{ model.description }}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
