/**
 * Web scraping para tareas de tipo web_search.
 *
 * Extrae URLs de la descripción/input de una tarea y las recupera vía el
 * servicio browser de la API HQ (/resources/browser/extract). El contenido
 * extraído se inyecta en el prompt para que el LLM lo use como contexto.
 *
 * Es opt-in: solo se activa para task.type === 'web_search'.
 */
'use strict';

const fetch = require('node-fetch');
const { config } = require('./config.cjs');

/** Extraer URLs de un texto con regex. */
function extractUrls(text) {
  if (!text) return [];
  const urlRegex = /(https?:\/\/[^\s\])}">]+)/gi;
  return text.match(urlRegex) || [];
}

/**
 * Recuperar el contenido de una lista de URLs vía el servicio browser.
 * Devuelve [{ url, title, content }]. Tolerante a fallos por URL.
 */
async function fetchWebContent(urls) {
  const contents = [];
  for (const url of urls) {
    try {
      console.log(`🌐 Fetching content from: ${url}`);
      const response = await fetch(`${config.hqApiUrl}/resources/browser/extract`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.hqApiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ url, options: { wait: 2000 } }),
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          contents.push({ url: data.url, title: data.title, content: data.content });
          console.log(`✅ Fetched ${data.content?.length || 0} chars from ${url}`);
        }
      } else {
        console.log(`⚠️ Failed to fetch ${url}: ${response.statusText}`);
      }
    } catch (error) {
      console.log(`⚠️ Error fetching ${url}: ${error.message}`);
    }
  }
  return contents;
}

module.exports = { extractUrls, fetchWebContent };
