const express = require("express");
const router = express.Router();
const mongoose = require("mongoose");
const { encrypt, decrypt } = require("../lib/encrypt");
const { sseManager } = require("../lib/notifications");

// Schema simplificado para HQ
const schema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    name: { type: String, required: true },
    tokenEncrypted: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    metadata: { type: mongoose.Schema.Types.Mixed, default: {} }
  },
  { timestamps: true, collection: "api_credentials" }
);

const Credential = mongoose.models.Credential || mongoose.model("Credential", schema);

/**
 * Providers soportados por HQ
 */
const HQ_PROVIDERS = [
  {
    value: "zai",
    label: "Z.ai (GLM-4)",
    group: "Z.ai",
    description: "API de Z.ai para modelos GLM-4",
    tokenLabel: "ZAI_API_KEY",
    tokenPlaceholder: "tu-clave-api-zai",
    models: ["glm-4", "glm-4-plus", "glm-4-0520", "glm-4-air", "glm-4-flash"]
  },
  {
    value: "anthropic",
    label: "Anthropic API",
    group: "Anthropic",
    description: "API key de Anthropic para Claude",
    tokenLabel: "ANTHROPIC_API_KEY",
    tokenPlaceholder: "sk-ant-...",
    models: ["claude-3-5-haiku", "claude-3-5-sonnet", "claude-3-opus"]
  },
  {
    value: "openai",
    label: "OpenAI API",
    group: "OpenAI",
    description: "API key de OpenAI para GPT models",
    tokenLabel: "OPENAI_API_KEY",
    tokenPlaceholder: "sk-...",
    models: ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo"]
  }
];

/**
 * GET /api/credentials/available-providers
 */
router.get("/available-providers", (req, res) => {
  res.json(HQ_PROVIDERS);
});

/**
 * GET /api/credentials
 * Lista todas las credenciales (sin token)
 */
router.get("/", async (req, res, next) => {
  try {
    const credentials = await Credential.find().select('-tokenEncrypted');
    res.json(credentials);
  } catch (error) {
    next(error);
  }
});

/**
 * GET /api/credentials/:provider
 * Obtiene credenciales de un provider (con token desencriptado)
 */
router.get("/:provider", async (req, res, next) => {
  try {
    const credential = await Credential.findOne({ provider: req.params.provider });
    if (!credential) {
      return res.status(404).json({ error: "Provider not found" });
    }

    const decrypted = {
      ...credential.toObject(),
      token: decrypt(credential.tokenEncrypted)
    };
    delete decrypted.tokenEncrypted;

    res.json(decrypted);
  } catch (error) {
    next(error);
  }
});

/**
 * POST /api/credentials
 * Crea o actualiza credenciales para un provider
 */
router.post("/", async (req, res, next) => {
  try {
    const { provider, token, name, enabled = true, metadata = {} } = req.body;

    if (!provider || !token) {
      return res.status(400).json({ error: "provider and token are required" });
    }

    // Verificar que el provider existe
    const providerExists = HQ_PROVIDERS.find(p => p.value === provider);
    if (!providerExists) {
      return res.status(400).json({ error: `Invalid provider: ${provider}` });
    }

    // Encriptar token
    const tokenEncrypted = encrypt(token);

    // Upsert: actualizar si existe, crear si no
    const credential = await Credential.findOneAndUpdate(
      { provider },
      {
        provider,
        name: name || providerExists.label,
        tokenEncrypted,
        enabled,
        metadata
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    // Notificar cambio via SSE
    sseManager.broadcast({
      type: 'credential',
      action: 'saved',
      provider,
      timestamp: new Date().toISOString()
    });

    // Retornar sin token encriptado
    const response = credential.toObject();
    delete response.tokenEncrypted;
    response.token = token;

    res.status(201).json(response);
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /api/credentials/:provider
 * Elimina credenciales de un provider
 */
router.delete("/:provider", async (req, res, next) => {
  try {
    const credential = await Credential.findOneAndDelete({ provider: req.params.provider });

    if (!credential) {
      return res.status(404).json({ error: "Provider not found" });
    }

    // Notificar eliminación
    sseManager.broadcast({
      type: 'credential',
      action: 'deleted',
      provider: req.params.provider,
      timestamp: new Date().toISOString()
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

module.exports = router;
