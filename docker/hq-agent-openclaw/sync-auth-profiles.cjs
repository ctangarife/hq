#!/usr/bin/env node
/**
 * Sincroniza API keys desde MongoDB a auth-profiles.json de OpenClaw
 * Versión simplificada para HQ (sin encriptación)
 */

const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');

const AGENT_DIR = process.env.AGENT_DIR || '/home/node/.openclaw/agents/main/agent';
const CONFIG_DIR = process.env.OPENCLAW_CONFIG_DIR || '/home/node/.openclaw';
const MONGO_URI = process.env.MONGO_URI;

// Schema de providers (sin encriptación)
const providerSchema = new mongoose.Schema({
  providerId: String,
  name: String,
  type: String,
  enabled: Boolean,
  apiKey: String,
  apiEndpoint: String,
  defaultModel: String,
}, { timestamps: true, collection: 'providers' });

async function syncAuthProfiles() {
  try {
    if (!MONGO_URI) {
      console.log('⚠️  MONGO_URI no definido, omitiendo sincronización');
      return;
    }

    console.log('🔗 Conectando a MongoDB...');
    await mongoose.connect(MONGO_URI, {
      serverSelectionTimeoutMS: 5000
    });
    console.log('✅ Conectado a MongoDB');

    const Provider = mongoose.models.Provider || mongoose.model('Provider', providerSchema);
    const providers = await Provider.find({ enabled: true }).lean();

    console.log(`📋 ${providers.length} providers habilitados encontrados`);

    // Crear estructura auth-profiles.json para OpenClaw
    const authProfiles = {};

    for (const provider of providers) {
      if (provider.apiKey) {
        const profileId = provider.providerId;

        // Mapeo de provider a auth profile type de OpenClaw
        let type = 'openai'; // Default
        if (provider.providerId === 'anthropic') type = 'anthropic';
        else if (provider.providerId === 'minimax') type = 'openai'; // MiniMax usa API OpenAI-compatible
        else if (provider.providerId === 'zai') type = 'openai'; // Z.ai usa API OpenAI-compatible

        authProfiles[profileId] = {
          type,
          providerId: provider.providerId,
          name: provider.name,
          tokens: {
            default: [{ type: 'api-key', value: provider.apiKey }]
          }
        };

        console.log(`✅ ${provider.name}: ${profileId} (${type})`);
      }
    }

    // Asegurar que el directorio existe
    fs.mkdirSync(AGENT_DIR, { recursive: true });

    // Escribir auth-profiles.json
    const authProfilesPath = path.join(AGENT_DIR, 'auth-profiles.json');
    fs.writeFileSync(authProfilesPath, JSON.stringify(authProfiles, null, 2));
    console.log(`✅ auth-profiles.json escrito en ${authProfilesPath}`);

    await mongoose.disconnect();

  } catch (err) {
    console.error('❌ Error sincronizando auth-profiles:', err.message);
    await mongoose.disconnect().catch(() => {});
    process.exit(1);
  }
}

syncAuthProfiles();
