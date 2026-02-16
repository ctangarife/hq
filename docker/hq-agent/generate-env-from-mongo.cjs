#!/usr/bin/env node
/**
 * HQ Agent - Genera variables de entorno desde MongoDB
 * Versión simplificada SIN encriptación
 *
 * Extrae API keys de la colección 'providers' y genera variables de entorno
 * Formato: {PROVIDER}_API_KEY=value
 */

const mongoose = require('mongoose');

const MONGO_URI = process.env.MONGO_URI;

if (!MONGO_URI) {
  console.error('MONGO_URI no está definido');
  process.exit(1);
}

// Schema de providers (sin encriptación)
const providerSchema = new mongoose.Schema({
  providerId: String,
  name: String,
  type: String,
  enabled: Boolean,
  apiKey: String,  // API key sin encriptar
  apiEndpoint: String,
  defaultModel: String,
}, { timestamps: true, collection: 'providers' });

async function generateEnvVars() {
  try {
    await mongoose.connect(MONGO_URI);

    const Provider = mongoose.models.Provider || mongoose.model('Provider', providerSchema);
    const providers = await Provider.find({ enabled: true }).lean();

    console.log(`# API Keys from MongoDB (${providers.length} enabled provider(s))`);
    console.log(`# Generated at ${new Date().toISOString()}`);

    for (const provider of providers) {
      if (provider.apiKey) {
        const envVarName = `${provider.providerId.toUpperCase()}_API_KEY`;
        console.log(`export ${envVarName}="${provider.apiKey}"`);
      }
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(1);
  }
}

generateEnvVars();
