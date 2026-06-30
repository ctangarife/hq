/**
 * Goose subprocess runtime.
 *
 * Goose es el motor de inferencia: recibe un prompt por stdin y devuelve
 * la respuesta del modelo por stdout. Este módulo lo invoca como subprocess,
 * captura el output y lo limpia (filtra el banner ASCII art de Goose).
 *
 * Mantiene la misma forma de salida que el endpoint OpenAI-compatible
 * ({ choices: [{ message: { content } }] }) para que el resto del skill
 * no cambie.
 */
'use strict';

const { spawn } = require('child_process');
const { config } = require('./config.cjs');

/**
 * Limpiar el output de Goose: quitar el banner ASCII art y metadata de
 * sesión, dejando solo la respuesta del modelo.
 *
 * Mismo filtrado que docker.service.cleanGooseOutput() en la API — mantenerlos
 * en sync si el banner de Goose cambia.
 *
 * Goose imprime al arrancar:
 *       __( O)>  ● new session · openai glm-4.7
 *      \____)    20260617_1 · /workspace
 *        L L     goose is ready
 */
function cleanGooseOutput(raw) {
  const lines = raw.split('\n');
  const cleaned = [];
  let pastBanner = false;

  for (const line of lines) {
    if (!pastBanner) {
      if (line.includes('goose is ready') || line.includes('new session')) {
        continue;
      }
      if (line.includes('__( O)>') || line.includes('\\____)') || line.includes('L L')) {
        continue;
      }
      pastBanner = true;
    }
    cleaned.push(line);
  }

  return cleaned.join('\n').trim();
}

/**
 * Formatear messages OpenAI (system + user) como un prompt plano para Goose.
 *
 * Goose recibe un solo prompt por stdin (no soporta messages array separado).
 * Concatenamos el system message como contexto inicial y el user como la
 * instrucción principal.
 */
function formatMessagesForGoose(messages) {
  let systemParts = [];
  let userParts = [];

  for (const msg of messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
    } else {
      userParts.push(msg.content);
    }
  }

  let prompt = '';
  if (systemParts.length > 0) {
    prompt += systemParts.join('\n\n') + '\n\n---\n\n';
  }
  prompt += userParts.join('\n\n');
  return prompt;
}

/**
 * Llamar al LLM vía Goose subprocess.
 *
 * Recibe el prompt por stdin y devuelve el output limpio por stdout.
 * Devuelve { choices: [{ message: { content } }] } (formato OpenAI-like).
 */
function callGoose(messages) {
  const prompt = formatMessagesForGoose(messages);

  console.log(`🪿 Goose subprocess (${messages.length} messages, ${prompt.length} chars prompt)`);

  return new Promise((resolve, reject) => {
    const goose = spawn('goose', [
      'run',
      '--no-session',
      '--output-format', 'text',
      '-i', '-',
    ], {
      env: {
        ...process.env,
        GOOSE_MODEL: config.gooseModel,
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { goose.kill('SIGKILL'); } catch {}
        reject(new Error(`Goose subprocess timed out after ${config.gooseTimeoutMs}ms`));
      }
    }, config.gooseTimeoutMs);

    goose.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    goose.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (process.env.GOOSE_DEBUG) {
        process.stderr.write(chunk);
      }
    });

    goose.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`Failed to spawn goose: ${err.message}`));
      }
    });

    goose.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const content = cleanGooseOutput(stdout);

      if (code !== 0 && !content) {
        reject(new Error(`Goose exited with code ${code}: ${stderr.slice(0, 500)}`));
        return;
      }

      resolve({
        choices: [{ message: { content } }],
      });
    });

    goose.stdin.write(prompt);
    goose.stdin.end();
  });
}

module.exports = { callGoose, cleanGooseOutput, formatMessagesForGoose };
