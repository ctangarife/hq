<script setup lang="ts">
import { ref, computed } from 'vue'

interface FileToUpload {
  file: File
  preview: string | null
  progress: number
  status: 'pending' | 'uploading' | 'success' | 'error'
  error?: string
}

interface UploadedFile {
  attachmentId: string
  resourceId: string
  originalName: string
  mimeType: string
  size: number
  type: string
  order: number
}

const props = defineProps<{
  missionId?: string
  taskId?: string
  type?: 'mission_input' | 'task_input' | 'task_output' | 'task_artifact' | 'mission_output'
  existingFiles?: UploadedFile[]
  accept?: string
  maxSize?: number // in MB
  multiple?: boolean
}>()

const emit = defineEmits<{
  uploaded: [files: UploadedFile[]]
  removed: [attachmentId: string]
}>()

const files = ref<FileToUpload[]>([])
const isDragging = ref(false)
const fileInput = ref<HTMLInputElement | null>(null)

// Configuración
const maxSizeMB = computed(() => props.maxSize || 50)
const maxSizeBytes = computed(() => maxSizeMB.value * 1024 * 1024)
const acceptTypes = computed(() =>
  props.accept || '.pdf,.md,.txt,.csv,.json,.xlsx,.xls,.js,.ts,.py,.java,.c,.cpp,.html,.css,.xml,.png,.jpg,.jpeg,.gif,.webp'
)

// Archivos ya subidos (prop read + computed)
const uploadedFiles = computed(() => props.existingFiles || [])

// Formatear tamaño
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

// Obtener ícono por tipo MIME
function getFileIcon(mimeType: string): string {
  if (mimeType.includes('pdf')) return '📄'
  if (mimeType.includes('image')) return '🖼️'
  if (mimeType.includes('excel') || mimeType.includes('spreadsheet')) return '📊'
  if (mimeType.includes('json') || mimeType.includes('xml')) return '📋'
  if (mimeType.includes('javascript') || mimeType.includes('typescript') || mimeType.includes('python')) return '💻'
  if (mimeType.includes('text') || mimeType.includes('markdown')) return '📝'
  return '📎'
}

// Manejar selección de archivos
function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement
  if (target.files) {
    addFiles(Array.from(target.files))
  }
}

// Manejar drag & drop
function handleDragOver(event: DragEvent) {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false

  if (event.dataTransfer?.files) {
    addFiles(Array.from(event.dataTransfer.files))
  }
}

// Agregar archivos a la cola
function addFiles(newFiles: File[]) {
  for (const file of newFiles) {
    // Validar tamaño
    if (file.size > maxSizeBytes.value) {
      files.value.push({
        file,
        preview: null,
        progress: 0,
        status: 'error',
        error: `File too large (max ${maxSizeMB.value}MB)`
      })
      continue
    }

    // Crear preview para imágenes
    let preview: string | null = null
    if (file.type.startsWith('image/')) {
      preview = URL.createObjectURL(file)
    }

    files.value.push({
      file,
      preview,
      progress: 0,
      status: 'pending'
    })
  }
}

// Eliminar archivo de la cola
function removeFile(index: number) {
  const file = files.value[index]
  if (file.preview) {
    URL.revokeObjectURL(file.preview)
  }
  files.value.splice(index, 1)
}

// Subir archivos
async function uploadFiles() {
  const pendingFiles = files.value.filter(f => f.status === 'pending')

  for (const fileData of pendingFiles) {
    fileData.status = 'uploading'

    try {
      const formData = new FormData()
      formData.append('file', fileData.file)
      if (props.missionId) formData.append('missionId', props.missionId)
      if (props.taskId) formData.append('taskId', props.taskId)
      if (props.type) formData.append('type', props.type)

      const response = await fetch('/api/attachments/upload', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token') || 'hq-agent-token'}`
        },
        body: formData
      })

      if (!response.ok) {
        throw new Error(`Upload failed: ${response.statusText}`)
      }

      // Simular progreso (podría mejorarse con upload progress real)
      fileData.progress = 100
      fileData.status = 'success'

    } catch (error: any) {
      fileData.status = 'error'
      fileData.error = error.message || 'Upload failed'
    }
  }

  // Notificar al padre y limpiar archivos exitosos
  const successful = files.value.filter(f => f.status === 'success')
  if (successful.length > 0) {
    // Emitir evento - el padre debería recargar la lista
    emit('uploaded', [])
    // Remover archivos exitosos de la cola
    files.value = files.value.filter(f => f.status !== 'success')
  }
}

// Eliminar archivo existente
async function removeExistingFile(attachmentId: string) {
  try {
    const response = await fetch(`/api/attachments/${attachmentId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token') || 'hq-agent-token'}`
      }
    })

    if (!response.ok) {
      throw new Error(`Delete failed: ${response.statusText}`)
    }

    emit('removed', attachmentId)
  } catch (error: any) {
    console.error('Error deleting file:', error)
  }
}

// Limpiar errores
function clearErrors() {
  files.value = files.value.filter(f => f.status !== 'error')
}
</script>

<template>
  <div class="file-uploader">
    <!-- Drop Zone -->
    <div
      class="drop-zone"
      :class="{ 'is-dragging': isDragging, 'has-files': files.length > 0 || uploadedFiles.length > 0 }"
      @dragover="handleDragOver"
      @dragleave="handleDragLeave"
      @drop="handleDrop"
      @click="fileInput?.click()"
    >
      <input
        ref="fileInput"
        type="file"
        :accept="acceptTypes"
        :multiple="multiple !== false"
        class="hidden-input"
        @change="handleFileSelect"
      />

      <div v-if="files.length === 0 && uploadedFiles.length === 0" class="drop-zone-content">
        <div class="drop-zone-icon">📁</div>
        <p class="drop-zone-text">
          Drag & drop files here or click to browse
        </p>
        <p class="drop-zone-hint">
          Max size: {{ maxSizeMB }}MB per file
        </p>
        <p class="drop-zone-types">
          {{ acceptTypes }}
        </p>
      </div>
    </div>

    <!-- Existing Files -->
    <div v-if="uploadedFiles.length > 0" class="file-list">
      <h4>Uploaded Files</h4>
      <div
        v-for="file in uploadedFiles"
        :key="file.attachmentId"
        class="file-item existing"
      >
        <span class="file-icon">{{ getFileIcon(file.mimeType) }}</span>
        <div class="file-info">
          <span class="file-name">{{ file.originalName }}</span>
          <span class="file-meta">{{ formatSize(file.size) }}</span>
        </div>
        <button
          @click="removeExistingFile(file.attachmentId)"
          class="file-remove"
          title="Remove file"
        >
          ✕
        </button>
      </div>
    </div>

    <!-- Pending Files -->
    <div v-if="files.length > 0" class="file-list">
      <h4>Pending Uploads</h4>
      <div
        v-for="(fileData, index) in files"
        :key="index"
        class="file-item"
        :class="fileData.status"
      >
        <span class="file-icon">{{ getFileIcon(fileData.file.type) }}</span>
        <div class="file-info">
          <span class="file-name">{{ fileData.file.name }}</span>
          <span class="file-meta">{{ formatSize(fileData.file.size) }}</span>
        </div>

        <!-- Progress Bar -->
        <div v-if="fileData.status === 'uploading'" class="file-progress">
          <div class="progress-bar" :style="{ width: `${fileData.progress}%` }"></div>
        </div>

        <!-- Status Icon -->
        <span v-if="fileData.status === 'success'" class="file-status success">✓</span>
        <span v-if="fileData.status === 'error'" class="file-status error" :title="fileData.error">⚠️</span>

        <button
          @click="removeFile(index)"
          class="file-remove"
          :disabled="fileData.status === 'uploading'"
        >
          ✕
        </button>
      </div>

      <!-- Action Buttons -->
      <div class="file-actions">
        <button
          v-if="files.some(f => f.status === 'error')"
          @click="clearErrors"
          class="btn btn-secondary"
        >
          Clear Errors
        </button>
        <button
          v-if="files.some(f => f.status === 'pending')"
          @click="uploadFiles"
          class="btn btn-primary"
          :disabled="files.some(f => f.status === 'uploading')"
        >
          Upload {{ files.filter(f => f.status === 'pending').length }} File(s)
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.file-uploader {
  width: 100%;
}

.drop-zone {
  border: 2px dashed #4b5563;
  border-radius: 8px;
  padding: 2rem;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s;
  background: #1f2937;
}

.drop-zone:hover {
  border-color: #6366f1;
  background: #111827;
}

.drop-zone.is-dragging {
  border-color: #6366f1;
  background: #1e1b4b;
}

.drop-zone-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.5rem;
}

.drop-zone-icon {
  font-size: 3rem;
  opacity: 0.5;
}

.drop-zone-text {
  font-size: 1rem;
  color: #e5e7eb;
}

.drop-zone-hint {
  font-size: 0.875rem;
  color: #9ca3af;
}

.drop-zone-types {
  font-size: 0.75rem;
  color: #6b7280;
  max-width: 400px;
}

.hidden-input {
  display: none;
}

.file-list {
  margin-top: 1rem;
}

.file-list h4 {
  font-size: 0.875rem;
  font-weight: 600;
  color: #9ca3af;
  margin-bottom: 0.5rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: #1f2937;
  border: 1px solid #374151;
  border-radius: 6px;
  margin-bottom: 0.5rem;
  position: relative;
  overflow: hidden;
}

.file-item.existing {
  background: #1a1f2e;
  border-color: #2d3748;
}

.file-item.uploading {
  border-color: #6366f1;
}

.file-item.success {
  border-color: #10b981;
}

.file-item.error {
  border-color: #ef4444;
}

.file-icon {
  font-size: 1.5rem;
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  display: block;
  font-size: 0.875rem;
  color: #e5e7eb;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.file-meta {
  font-size: 0.75rem;
  color: #9ca3af;
}

.file-progress {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: #374151;
}

.progress-bar {
  height: 100%;
  background: #6366f1;
  transition: width 0.3s;
}

.file-status {
  font-size: 1rem;
}

.file-status.success {
  color: #10b981;
}

.file-status.error {
  color: #ef4444;
}

.file-remove {
  background: none;
  border: none;
  color: #9ca3af;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  font-size: 1rem;
  transition: color 0.2s;
}

.file-remove:hover:not(:disabled) {
  color: #ef4444;
}

.file-remove:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.file-actions {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.5rem;
  justify-content: flex-end;
}

.btn {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s;
  border: none;
}

.btn-primary {
  background: #6366f1;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: #4f46e5;
}

.btn-primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-secondary {
  background: #374151;
  color: #e5e7eb;
}

.btn-secondary:hover {
  background: #4b5563;
}
</style>
