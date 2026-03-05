/**
 * Provider Storage
 * Manages provider configurations and API keys.
 * Keys are stored in plain text alongside provider configs in a single electron-store.
 */

import type { ProviderType } from './provider-registry';
import {
  getActiveOpenClawProviders,
  saveProviderKeyToOpenClaw,
  setOpenClawDefaultModel,
  syncProviderConfigToOpenClaw,
} from './openclaw-auth';
import { getProviderConfig } from './provider-registry';

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let providerStore: any = null;

async function getProviderStore() {
  if (!providerStore) {
    const Store = (await import('electron-store')).default;
    providerStore = new Store({
      name: 'clawx-providers',
      defaults: {
        providers: {} as Record<string, ProviderConfig>,
        apiKeys: {} as Record<string, string>,
        defaultProvider: null as string | null,
      },
    });
  }
  return providerStore;
}

/**
 * Provider configuration
 */
export interface ProviderConfig {
  id: string;
  name: string;
  type: ProviderType;
  baseUrl?: string;
  model?: string;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  /** Whether this is a built-in default provider */
  isBuiltIn?: boolean;
}

// ==================== API Key Storage ====================

/**
 * Store an API key
 */
export async function storeApiKey(providerId: string, apiKey: string): Promise<boolean> {
  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    keys[providerId] = apiKey;
    s.set('apiKeys', keys);
    return true;
  } catch (error) {
    console.error('Failed to store API key:', error);
    return false;
  }
}

/**
 * Retrieve an API key
 */
export async function getApiKey(providerId: string): Promise<string | null> {
  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    return keys[providerId] || null;
  } catch (error) {
    console.error('Failed to retrieve API key:', error);
    return null;
  }
}

/**
 * Delete an API key
 */
export async function deleteApiKey(providerId: string): Promise<boolean> {
  try {
    const s = await getProviderStore();
    const keys = (s.get('apiKeys') || {}) as Record<string, string>;
    delete keys[providerId];
    s.set('apiKeys', keys);
    return true;
  } catch (error) {
    console.error('Failed to delete API key:', error);
    return false;
  }
}

/**
 * Check if an API key exists for a provider
 */
export async function hasApiKey(providerId: string): Promise<boolean> {
  const s = await getProviderStore();
  const keys = (s.get('apiKeys') || {}) as Record<string, string>;
  return providerId in keys;
}

/**
 * List all provider IDs that have stored keys
 */
export async function listStoredKeyIds(): Promise<string[]> {
  const s = await getProviderStore();
  const keys = (s.get('apiKeys') || {}) as Record<string, string>;
  return Object.keys(keys);
}

// ==================== Provider Configuration ====================

/**
 * Save a provider configuration
 */
export async function saveProvider(config: ProviderConfig): Promise<void> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  providers[config.id] = config;
  s.set('providers', providers);
}

/**
 * Get a provider configuration
 */
export async function getProvider(providerId: string): Promise<ProviderConfig | null> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  return providers[providerId] || null;
}

/**
 * Get all provider configurations
 */
export async function getAllProviders(): Promise<ProviderConfig[]> {
  const s = await getProviderStore();
  const providers = s.get('providers') as Record<string, ProviderConfig>;
  return Object.values(providers);
}

/**
 * Delete a provider configuration and its API key
 */
export async function deleteProvider(providerId: string): Promise<boolean> {
  try {
    // Delete the API key
    await deleteApiKey(providerId);

    // Delete the provider config
    const s = await getProviderStore();
    const providers = s.get('providers') as Record<string, ProviderConfig>;
    delete providers[providerId];
    s.set('providers', providers);

    // Clear default if this was the default
    if (s.get('defaultProvider') === providerId) {
      s.delete('defaultProvider');
    }

    return true;
  } catch (error) {
    console.error('Failed to delete provider:', error);
    return false;
  }
}

/**
 * Set the default provider
 */
export async function setDefaultProvider(providerId: string): Promise<void> {
  const s = await getProviderStore();
  s.set('defaultProvider', providerId);
}

/**
 * Get the default provider
 */
export async function getDefaultProvider(): Promise<string | undefined> {
  const s = await getProviderStore();
  return s.get('defaultProvider') as string | undefined;
}

/**
 * Get provider with masked key info (for UI display)
 */
export async function getProviderWithKeyInfo(
  providerId: string
): Promise<(ProviderConfig & { hasKey: boolean; keyMasked: string | null }) | null> {
  const provider = await getProvider(providerId);
  if (!provider) return null;

  const apiKey = await getApiKey(providerId);
  let keyMasked: string | null = null;

  if (apiKey) {
    if (apiKey.length > 12) {
      keyMasked = `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
    } else {
      keyMasked = '*'.repeat(apiKey.length);
    }
  }

  return {
    ...provider,
    hasKey: !!apiKey,
    keyMasked,
  };
}

/**
 * Get all providers with key info (for UI display)
 * Also synchronizes ClawX local provider list with OpenClaw's actual config.
 */
export async function getAllProvidersWithKeyInfo(): Promise<
  Array<ProviderConfig & { hasKey: boolean; keyMasked: string | null }>
> {
  const providers = await getAllProviders();
  const results: Array<ProviderConfig & { hasKey: boolean; keyMasked: string | null }> = [];
  const activeOpenClawProviders = getActiveOpenClawProviders();

  // Native/built-in providers should never be dropped just because
  // openclaw.json is temporarily absent or still syncing at startup.
  const OPENCLAW_NATIVE_PROVIDER_TYPES = [
    'anthropic', 'openai', 'google', 'openrouter',
    'moonshot', 'siliconflow', 'minimax-portal', 'qwen-portal', 'ollama',
  ];

  for (const provider of providers) {
    // Sync check: If a user-managed provider no longer exists in OpenClaw
    // config, remove it from ClawX UI to stay consistent.
    // Built-ins are explicitly exempt from pruning.
    const isBuiltin = provider.isBuiltIn || OPENCLAW_NATIVE_PROVIDER_TYPES.includes(provider.type);

    // For custom/ollama providers, the OpenClaw config key is derived as
    // "<type>-<suffix>" where suffix = first 8 chars of providerId with hyphens stripped.
    // e.g. provider.id "custom-a1b2c3d4-..." -> strip hyphens -> "customa1b2c3d4..." -> slice(0,8) -> "customa1"
    // -> openClawKey = "custom-customa1"
    // This must match getOpenClawProviderKey() in ipc-handlers.ts exactly.
    const openClawKey = (provider.type === 'custom' || provider.type === 'ollama')
      ? `${provider.type}-${provider.id.replace(/-/g, '').slice(0, 8)}`
      : provider.type;

    if (!isBuiltin && !activeOpenClawProviders.has(provider.type) && !activeOpenClawProviders.has(provider.id) && !activeOpenClawProviders.has(openClawKey)) {
      console.log(`[Sync] Provider ${provider.id} (${provider.type}) missing from OpenClaw, dropping from ClawX UI`);
      await deleteProvider(provider.id);
      continue;
    }

    const apiKey = await getApiKey(provider.id);
    let keyMasked: string | null = null;

    if (apiKey) {
      if (apiKey.length > 12) {
        keyMasked = `${apiKey.substring(0, 4)}${'*'.repeat(apiKey.length - 8)}${apiKey.substring(apiKey.length - 4)}`;
      } else {
        keyMasked = '*'.repeat(apiKey.length);
      }
    }

    results.push({
      ...provider,
      hasKey: !!apiKey,
      keyMasked,
    });
  }

  return results;
}

// ==================== Default Provider Initialization ====================

/** Default built-in provider configuration for first launch */
const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  id: 'openrouter',
  type: 'openrouter',
  name: 'OpenRouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  model: 'stepfun/step-3.5-flash:free',
  enabled: true,
  isBuiltIn: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
};

/** Default API key for built-in provider */
const DEFAULT_PROVIDER_API_KEY = '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';
const LEGACY_DEFAULT_PROVIDER_API_KEY = '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';

async function syncDefaultProviderToOpenClaw(apiKey: string): Promise<void> {
  try {
    const meta = getProviderConfig(DEFAULT_PROVIDER_CONFIG.type);
    if (meta) {
      syncProviderConfigToOpenClaw(DEFAULT_PROVIDER_CONFIG.type, DEFAULT_PROVIDER_CONFIG.model, {
        baseUrl: DEFAULT_PROVIDER_CONFIG.baseUrl || meta.baseUrl,
        api: meta.api,
        apiKeyEnv: meta.apiKeyEnv,
        headers: meta.headers,
      });
    }
    saveProviderKeyToOpenClaw(DEFAULT_PROVIDER_CONFIG.type, apiKey);
    if (DEFAULT_PROVIDER_CONFIG.model) {
      setOpenClawDefaultModel(
        DEFAULT_PROVIDER_CONFIG.type,
        `${DEFAULT_PROVIDER_CONFIG.type}/${DEFAULT_PROVIDER_CONFIG.model}`
      );
    }
  } catch (error) {
    console.warn('[Provider] Failed to sync default provider into OpenClaw config:', error);
  }
}

/**
 * Initialize bundled default provider.
 * Auto-injects only when no API keys are configured yet.
 */
export async function initializeDefaultProvider(): Promise<void> {
  const providers = await getAllProviders();
  const storedKeyIds = await listStoredKeyIds();
  const hasAnyStoredKey = storedKeyIds.length > 0;

  // Bootstrap built-in provider only when user has no configured keys at all.
  // This avoids overriding user-selected providers on later launches.
  if (!hasAnyStoredKey) {
    console.log('[Provider] No stored API keys detected, initializing default provider');

    const existingDefaultProvider = providers.find((provider) => provider.id === DEFAULT_PROVIDER_CONFIG.id);

    // Save the default provider config if missing.
    if (!existingDefaultProvider) {
      await saveProvider(DEFAULT_PROVIDER_CONFIG);
    } else if (!existingDefaultProvider.isBuiltIn) {
      // Preserve existing metadata, but mark it as built-in for UI semantics.
      await saveProvider({
        ...existingDefaultProvider,
        isBuiltIn: true,
        updatedAt: new Date().toISOString(),
      });
    }

    // Store the API key
    await storeApiKey(DEFAULT_PROVIDER_CONFIG.id, DEFAULT_PROVIDER_API_KEY);

    // Set as default
    await setDefaultProvider(DEFAULT_PROVIDER_CONFIG.id);

    // Keep OpenClaw runtime config in sync so chat can work immediately.
    await syncDefaultProviderToOpenClaw(DEFAULT_PROVIDER_API_KEY);

    console.log('[Provider] Default provider initialized:', DEFAULT_PROVIDER_CONFIG.id);
    return;
  }

  // Migrate legacy built-in key to the latest bundled key without touching
  // any user-defined keys.
  const builtInDefaultProvider = providers.find((provider) => provider.id === DEFAULT_PROVIDER_CONFIG.id);
  if (!builtInDefaultProvider || !builtInDefaultProvider.isBuiltIn) {
    return;
  }

  const existingDefaultKey = await getApiKey(DEFAULT_PROVIDER_CONFIG.id);
  if (existingDefaultKey !== LEGACY_DEFAULT_PROVIDER_API_KEY) {
    return;
  }

  console.log('[Provider] Migrating legacy built-in default provider key');
  await storeApiKey(DEFAULT_PROVIDER_CONFIG.id, DEFAULT_PROVIDER_API_KEY);
  await syncDefaultProviderToOpenClaw(DEFAULT_PROVIDER_API_KEY);
}

