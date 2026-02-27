/**
 * Browser Service
 *
 * Servicio para interactuar con el agent-browser (Puppeteer HTTP Wrapper)
 * Permite a los agentes extraer contenido de URLs para investigación
 */

import fetch from 'node-fetch';
import { URL } from 'url';

interface BrowserResponse {
  success: boolean;
  text?: string;
  html?: string;
  title?: string;
  url?: string;
  error?: string;
}

interface SearchOptions {
  wait?: number;           // ms to wait after page load
  timeout?: number;        // page load timeout
  selector?: string;       // CSS selector to extract specific content
  removeSelectors?: string[]; // CSS selectors to remove (ads, navs, etc.)
}

class BrowserService {
  private browserUrl: string;
  private browserPort: number;

  constructor() {
    // Browser agent URL - usar service name de docker-compose
    // Formato: http://hq-browser-shared:9222 (contenedor compartido)
    // Para desarrollo local: http://localhost:9222
    this.browserUrl = process.env.BROWSER_AGENT_URL || 'http://hq-browser-shared:9222';
    this.browserPort = 9222;
  }

  /**
   * Encontrar un browser agent corriendo
   */
  private async findBrowserAgent(): Promise<string> {
    // Si está configurada una URL específica, usarla
    if (process.env.BROWSER_AGENT_URL) {
      return process.env.BROWSER_AGENT_URL;
    }

    // En Docker, usar el nombre del contenedor (resolución DNS de Docker)
    // El browser agent está en la red hq-network como hq-browser-shared
    return 'http://hq-browser-shared:9222';
  }

  /**
   * Verificar que el browser agent esté disponible
   */
  async healthCheck(): Promise<boolean> {
    try {
      const browserUrl = await this.findBrowserAgent();
      const response = await fetch(`${browserUrl}/health`);
      const data = await response.json() as any;
      // El servicio debe estar healthy (browser puede ser false inicialmente)
      return data.status === 'healthy';
    } catch {
      return false;
    }
  }

  /**
   * Abrir una URL en el browser y extraer contenido
   */
  async openUrl(url: string): Promise<BrowserResponse> {
    try {
      const browserUrl = await this.findBrowserAgent();

      const response = await fetch(`${browserUrl}/open`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url })
      });

      if (!response.ok) {
        throw new Error(`Browser open failed: ${response.statusText}`);
      }

      const data = await response.json() as any;
      return { success: data.success, url };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Extraer contenido de una URL
   */
  async extractContent(url: string, options: SearchOptions = {}): Promise<BrowserResponse> {
    const {
      wait = 2000,
      timeout = 30000,
      selector,
      removeSelectors = ['nav', 'footer', 'header', '.ad', '.ads', '.advertisement', '.sidebar']
    } = options;

    try {
      const browserUrl = await this.findBrowserAgent();

      // Validar URL
      new URL(url); // Lanza error si es inválida

      // Abrir la página
      await this.openUrl(url);

      // Esperar a que cargue
      await this.sleep(wait);

      // Extraer texto usando /exec
      // Nota: Usar function expression en lugar de arrow function
      // El wrapper de Puppeteer no soporta arrow functions
      const removeSelectorsJson = JSON.stringify(removeSelectors);
      const selectorJson = JSON.stringify(selector);

      const execScript = `(function() {
        // Remover elementos no deseados
        const remove = ${removeSelectorsJson};
        remove.forEach(function(sel) {
          document.querySelectorAll(sel).forEach(function(el) {
            el.remove();
          });
        });

        // Extraer contenido
        var content = '';

        // Si hay selector específico, usarlo
        if (${selectorJson}) {
          var el = document.querySelector(${selectorJson});
          content = el ? (el.textContent || el.innerHTML) : '';
        } else {
          // Extraer body principal (evitar scripts, styles)
          var clone = document.body.cloneNode(true);
          clone.querySelectorAll('script, style, link[rel="stylesheet"]').forEach(function(el) {
            el.remove();
          });
          content = clone.innerHTML;
        }

        // Extraer título
        var title = document.title;

        return {
          title: title,
          content: content,
          url: window.location.href,
          length: content.length
        };
      })()`;

      const execResponse = await fetch(`${browserUrl}/exec`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command: execScript })
      });

      if (!execResponse.ok) {
        throw new Error(`Exec failed: ${execResponse.statusText}`);
      }

      const execData = await execResponse.json() as any;

      if (!execData.success) {
        throw new Error('Exec command failed');
      }

      const result = JSON.parse(execData.result);

      return {
        success: true,
        text: result.content,
        html: result.content,
        title: result.title,
        url: result.url || url
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Extraer contenido de múltiples URLs
   */
  async extractMultiple(urls: string[], options: SearchOptions = {}): Promise<BrowserResponse[]> {
    const results: BrowserResponse[] = [];

    for (const url of urls) {
      const result = await this.extractContent(url, options);
      results.push(result);
      // Pequeña pausa entre requests para no sobrecargar
      await this.sleep(500);
    }

    return results;
  }

  /**
   * Tomar screenshot de una URL
   */
  async screenshot(url: string, full = false): Promise<Buffer | null> {
    try {
      const browserUrl = await this.findBrowserAgent();

      // Abrir página
      await this.openUrl(url);
      await this.sleep(2000);

      // Tomar screenshot
      const response = await fetch(`${browserUrl}/screenshot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename: `screenshot-${Date.now()}.png`, full })
      });

      if (!response.ok) {
        throw new Error(`Screenshot failed: ${response.statusText}`);
      }

      const data = await response.json() as any;

      if (data.success && data.base64) {
        return Buffer.from(data.base64, 'base64');
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Utilidad: pausa
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton
export const browserService = new BrowserService();
