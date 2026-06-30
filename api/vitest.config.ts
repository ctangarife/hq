import { defineConfig } from 'vitest/config'

/**
 * Vitest config para HQ API
 *
 * Entorno node (no jsdom — no testeamos DOM aquí). Los tests corren con
 * ESM nativo (type:module), MongoDB real del stack en DB aislada `hq_test`,
 * y los servicios externos (docker, litellm) se mockean con vi.mock.
 *
 * Ejecutar dentro del container (el host no se contamina):
 *   podman compose exec api npm test
 */
export default defineConfig({
  test: {
    environment: 'node',
    // Incluir archivos de test en src/test/ o src/**/*.test.ts
    include: ['src/**/*.{test,spec}.ts'],
    // No recolectar coverage por defecto (rápido); activar con --coverage
    globals: true,
    // Timeout generoso: las queries a MongoDB real pueden tardar en CI
    testTimeout: 15000,
  },
  resolve: {
    alias: {
      // Mantener consistencia con tsconfig paths (por si algún import usa @/)
      '@': '/app/src',
    },
  },
})
