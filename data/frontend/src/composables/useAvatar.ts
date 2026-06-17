import { createAvatar } from '@dicebear/core'
import * as pixelArt from '@dicebear/pixel-art'
import { ref, watch, type Ref } from 'vue'

export const styleCache: Record<string, any> = { 'pixel-art': pixelArt }

const styleLoaders: Record<string, () => Promise<any>> = {
  'pixel-art': () => Promise.resolve(pixelArt),
  'adventurer': () => import('@dicebear/adventurer'),
  'bottts': () => import('@dicebear/bottts'),
  'big-smile': () => import('@dicebear/big-smile'),
  'lorelei': () => import('@dicebear/lorelei'),
  'avataaars': () => import('@dicebear/avataaars'),
}

const probabilityKeys = ['glasses', 'hat', 'beard', 'accessories']

export async function loadStyle(styleKey: string) {
  const key = styleKey in styleLoaders ? styleKey : 'pixel-art'
  if (!styleCache[key]) {
    styleCache[key] = await styleLoaders[key]()
  }
  return styleCache[key]
}

function buildOptions(seed: string, size: number, equipped: Record<string, string>) {
  const options: Record<string, any> = { seed: seed || 'papa', size }
  for (const [key, value] of Object.entries(equipped)) {
    options[key] = [value]
    if (probabilityKeys.includes(key)) {
      options[`${key}Probability`] = 100
    }
  }
  return options
}

export function avatarDataUriSync(
  style: any,
  seed: string,
  size: number = 64,
  equipped: Record<string, string> = {},
): string {
  return createAvatar(style, buildOptions(seed, size, equipped)).toDataUri()
}

export async function avatarDataUri(
  seed: string,
  size: number = 64,
  styleKey: string = 'pixel-art',
  equipped: Record<string, string> = {},
): Promise<string> {
  const style = await loadStyle(styleKey)
  return avatarDataUriSync(style, seed, size, equipped)
}

export function useAvatar(
  seed: Ref<string>,
  size: number = 64,
  styleKey: Ref<string> | string = 'pixel-art',
  equipped: Ref<Record<string, string>> | Record<string, string> = {},
) {
  const src = ref('')
  const loading = ref(true)

  async function generate() {
    loading.value = true
    const style = typeof styleKey === 'string' ? styleKey : styleKey.value
    const eq = typeof equipped === 'object' && !('value' in equipped)
      ? equipped
      : (equipped as Ref<Record<string, string>>).value
    src.value = await avatarDataUri(seed.value, size, style, eq)
    loading.value = false
  }

  watch([seed, styleKey, equipped], generate, { deep: true, immediate: true })

  return { src, loading }
}
