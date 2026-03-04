/**
 * Channel Configuration Utilities
 * Manages channel configuration in OpenClaw config files
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, statSync, rmSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import axios, { type AxiosProxyConfig } from 'axios';
import { getOpenClawResolvedDir } from './paths';
import * as logger from './logger';

const OPENCLAW_DIR = join(homedir(), '.openclaw');
const CONFIG_FILE = join(OPENCLAW_DIR, 'openclaw.json');

// Channels that are managed as plugins (config goes under plugins.entries, not channels)
const PLUGIN_CHANNELS = ['whatsapp'];

export interface ChannelConfigData {
    enabled?: boolean;
    [key: string]: unknown;
}

export interface PluginsConfig {
    entries?: Record<string, ChannelConfigData>;
    [key: string]: unknown;
}

export interface OpenClawConfig {
    channels?: Record<string, ChannelConfigData>;
    plugins?: PluginsConfig;
    [key: string]: unknown;
}

/**
 * Ensure OpenClaw config directory exists
 */
function ensureConfigDir(): void {
    if (!existsSync(OPENCLAW_DIR)) {
        mkdirSync(OPENCLAW_DIR, { recursive: true });
    }
}

function stripUtf8Bom(content: string): string {
    return content.charCodeAt(0) === 0xFEFF ? content.slice(1) : content;
}

/**
 * Read OpenClaw configuration
 */
export function readOpenClawConfig(): OpenClawConfig {
    ensureConfigDir();

    if (!existsSync(CONFIG_FILE)) {
        return {};
    }

    try {
        const content = readFileSync(CONFIG_FILE, 'utf-8');
        return JSON.parse(stripUtf8Bom(content)) as OpenClawConfig;
    } catch (error) {
        logger.error('Failed to read OpenClaw config', error);
        console.error('Failed to read OpenClaw config:', error);
        return {};
    }
}

/**
 * Write OpenClaw configuration
 */
export function writeOpenClawConfig(config: OpenClawConfig): void {
    ensureConfigDir();

    try {
        writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
    } catch (error) {
        logger.error('Failed to write OpenClaw config', error);
        console.error('Failed to write OpenClaw config:', error);
        throw error;
    }
}

/**
 * Save channel configuration
 * @param channelType - The channel type (e.g., 'telegram', 'discord')
 * @param config - The channel configuration object
 */
export function saveChannelConfig(
    channelType: string,
    config: ChannelConfigData
): void {
    const currentConfig = readOpenClawConfig();

    // Plugin-based channels (e.g. WhatsApp) go under plugins.entries, not channels
    if (PLUGIN_CHANNELS.includes(channelType)) {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {};
        }
        if (!currentConfig.plugins.entries) {
            currentConfig.plugins.entries = {};
        }
        currentConfig.plugins.entries[channelType] = {
            ...currentConfig.plugins.entries[channelType],
            enabled: config.enabled ?? true,
        };
        writeOpenClawConfig(currentConfig);
        logger.info('Plugin channel config saved', {
            channelType,
            configFile: CONFIG_FILE,
            path: `plugins.entries.${channelType}`,
        });
        console.log(`Saved plugin channel config for ${channelType}`);
        return;
    }

    if (!currentConfig.channels) {
        currentConfig.channels = {};
    }

    // Transform config to match OpenClaw expected format
    let transformedConfig: ChannelConfigData = { ...config };

    // Special handling for Discord: convert guildId/channelId to complete structure
    if (channelType === 'discord') {
        const { guildId, channelId, ...restConfig } = config;
        const existingDiscordConfig = (currentConfig.channels[channelType] || {}) as Record<string, unknown>;
        transformedConfig = { ...restConfig };

        // Preserve existing defaults where possible, instead of forcing strict values.
        transformedConfig.groupPolicy = typeof existingDiscordConfig.groupPolicy === 'string'
            ? existingDiscordConfig.groupPolicy
            : 'allowlist';

        const existingDm = existingDiscordConfig.dm as Record<string, unknown> | undefined;
        const existingDmEnabled = typeof existingDm?.enabled === 'boolean' ? existingDm.enabled : undefined;
        transformedConfig.dm = { enabled: existingDmEnabled ?? true };

        const existingRetry = existingDiscordConfig.retry;
        transformedConfig.retry = (existingRetry && typeof existingRetry === 'object')
            ? existingRetry as Record<string, unknown>
            : {
                attempts: 3,
                minDelayMs: 500,
                maxDelayMs: 30000,
                jitter: 0.1,
            };

        if (existingDiscordConfig.dmPolicy && transformedConfig.dmPolicy === undefined) {
            transformedConfig.dmPolicy = existingDiscordConfig.dmPolicy;
        }
        if (existingDiscordConfig.allowFrom && transformedConfig.allowFrom === undefined) {
            transformedConfig.allowFrom = existingDiscordConfig.allowFrom;
        }

        // Build guilds structure
        if (guildId && typeof guildId === 'string' && guildId.trim()) {
            const normalizedGuildId = guildId.trim();
            const existingGuilds = existingDiscordConfig.guilds as Record<string, unknown> | undefined;
            const existingGuild = existingGuilds?.[normalizedGuildId] as Record<string, unknown> | undefined;
            const existingGuildRequireMention = typeof existingGuild?.requireMention === 'boolean'
                ? existingGuild.requireMention
                : false;
            const existingUsers = Array.isArray(existingGuild?.users) && existingGuild.users.length > 0
                ? existingGuild.users
                : ['*'];
            const existingGuildChannels = existingGuild?.channels as Record<string, unknown> | undefined;

            const guildConfig: Record<string, unknown> = {
                users: existingUsers,
                requireMention: existingGuildRequireMention,
            };

            // Add channels config
            if (channelId && typeof channelId === 'string' && channelId.trim()) {
                const normalizedChannelId = channelId.trim();
                const existingChannelConfig = existingGuildChannels?.[normalizedChannelId] as Record<string, unknown> | undefined;
                const channelRequireMention = typeof existingChannelConfig?.requireMention === 'boolean'
                    ? existingChannelConfig.requireMention
                    : false;

                guildConfig.channels = {
                    [normalizedChannelId]: { allow: true, requireMention: channelRequireMention }
                };
            } else {
                const wildcardConfig = existingGuildChannels?.['*'] as Record<string, unknown> | undefined;
                const wildcardRequireMention = typeof wildcardConfig?.requireMention === 'boolean'
                    ? wildcardConfig.requireMention
                    : existingGuildRequireMention;

                guildConfig.channels = {
                    '*': { allow: true, requireMention: wildcardRequireMention }
                };
            }

            transformedConfig.guilds = {
                [normalizedGuildId]: guildConfig
            };
        }
    }

    // Special handling for Telegram: convert allowedUsers string to allowlist array
    if (channelType === 'telegram') {
        const { allowedUsers, ...restConfig } = config;
        transformedConfig = { ...restConfig };

        if (allowedUsers && typeof allowedUsers === 'string') {
            const users = allowedUsers.split(',')
                .map(u => u.trim())
                .filter(u => u.length > 0);

            if (users.length > 0) {
                transformedConfig.allowFrom = users; // Use 'allowFrom' (correct key)
                // transformedConfig.groupPolicy = 'allowlist'; // Default is allowlist
            }
        }
    }

    // Special handling for Feishu: default to open DM policy with wildcard allowlist
    if (channelType === 'feishu') {
        const existingConfig = currentConfig.channels[channelType] || {};
        transformedConfig.dmPolicy = transformedConfig.dmPolicy ?? existingConfig.dmPolicy ?? 'open';
        
        let allowFrom = transformedConfig.allowFrom ?? existingConfig.allowFrom ?? ['*'];
        if (!Array.isArray(allowFrom)) {
            allowFrom = [allowFrom];
        }
        
        // If dmPolicy is open, OpenClaw schema requires '*' in allowFrom
        if (transformedConfig.dmPolicy === 'open' && !allowFrom.includes('*')) {
            allowFrom = [...allowFrom, '*'];
        }
        
        transformedConfig.allowFrom = allowFrom;
    }

    // Merge with existing config
    currentConfig.channels[channelType] = {
        ...currentConfig.channels[channelType],
        ...transformedConfig,
        enabled: transformedConfig.enabled ?? true,
    };

    writeOpenClawConfig(currentConfig);
    logger.info('Channel config saved', {
        channelType,
        configFile: CONFIG_FILE,
        rawKeys: Object.keys(config),
        transformedKeys: Object.keys(transformedConfig),
        enabled: currentConfig.channels[channelType]?.enabled,
    });
    console.log(`Saved channel config for ${channelType}`);
}

/**
 * Get channel configuration
 * @param channelType - The channel type
 */
export function getChannelConfig(channelType: string): ChannelConfigData | undefined {
    const config = readOpenClawConfig();
    return config.channels?.[channelType];
}

/**
 * Get channel configuration as form-friendly values.
 * Reverses the transformation done in saveChannelConfig so the
 * values can be fed back into the UI form fields.
 *
 * @param channelType - The channel type
 * @returns A flat Record<string, string> matching the form field keys, or undefined
 */
export function getChannelFormValues(channelType: string): Record<string, string> | undefined {
    const saved = getChannelConfig(channelType);
    if (!saved) return undefined;

    const values: Record<string, string> = {};

    if (channelType === 'discord') {
        // token is stored at top level
        if (saved.token && typeof saved.token === 'string') {
            values.token = saved.token;
        }

        // Extract guildId and channelId from the nested guilds structure
        const guilds = saved.guilds as Record<string, Record<string, unknown>> | undefined;
        if (guilds) {
            const guildIds = Object.keys(guilds);
            if (guildIds.length > 0) {
                values.guildId = guildIds[0];

                const guildConfig = guilds[guildIds[0]];
                const channels = guildConfig?.channels as Record<string, unknown> | undefined;
                if (channels) {
                    const channelIds = Object.keys(channels).filter((id) => id !== '*');
                    if (channelIds.length > 0) {
                        values.channelId = channelIds[0];
                    }
                }
            }
        }
    } else if (channelType === 'telegram') {
        // Special handling for Telegram: convert allowFrom array to allowedUsers string
        if (Array.isArray(saved.allowFrom)) {
            values.allowedUsers = saved.allowFrom.join(', ');
        }

        // Also extract other string values
        for (const [key, value] of Object.entries(saved)) {
            if (typeof value === 'string' && key !== 'enabled') {
                values[key] = value;
            }
        }
    } else {
        // For other channel types, extract all string values directly
        for (const [key, value] of Object.entries(saved)) {
            if (typeof value === 'string' && key !== 'enabled') {
                values[key] = value;
            }
        }
    }

    return Object.keys(values).length > 0 ? values : undefined;
}

/**
 * Delete channel configuration
 * @param channelType - The channel type
 */
export function deleteChannelConfig(channelType: string): void {
    const currentConfig = readOpenClawConfig();

    if (currentConfig.channels?.[channelType]) {
        delete currentConfig.channels[channelType];
        writeOpenClawConfig(currentConfig);
        console.log(`Deleted channel config for ${channelType}`);
    } else if (PLUGIN_CHANNELS.includes(channelType)) {
        // Handle plugin channels (like whatsapp)
        if (currentConfig.plugins?.entries?.[channelType]) {
            delete currentConfig.plugins.entries[channelType];

            // Cleanup empty objects
            if (Object.keys(currentConfig.plugins.entries).length === 0) {
                delete currentConfig.plugins.entries;
            }
            if (currentConfig.plugins && Object.keys(currentConfig.plugins).length === 0) {
                delete currentConfig.plugins;
            }

            writeOpenClawConfig(currentConfig);
            console.log(`Deleted plugin channel config for ${channelType}`);
        }
    }

    // Special handling for WhatsApp credentials
    if (channelType === 'whatsapp') {
        try {

            const whatsappDir = join(homedir(), '.openclaw', 'credentials', 'whatsapp');
            if (existsSync(whatsappDir)) {
                rmSync(whatsappDir, { recursive: true, force: true });
                console.log('Deleted WhatsApp credentials directory');
            }
        } catch (error) {
            console.error('Failed to delete WhatsApp credentials:', error);
        }
    }
}

/**
 * Clear all channel configurations
 * Used when channel feature is hidden/disabled
 */
export function clearAllChannels(): void {
    const currentConfig = readOpenClawConfig();
    let modified = false;

    // Clear all channels under config.channels
    if (currentConfig.channels && Object.keys(currentConfig.channels).length > 0) {
        currentConfig.channels = {};
        modified = true;
        logger.info('Cleared all channel configurations');
    }

    // Clear plugin-based channels (like whatsapp)
    if (currentConfig.plugins?.entries) {
        for (const channelType of PLUGIN_CHANNELS) {
            if (currentConfig.plugins.entries[channelType]) {
                delete currentConfig.plugins.entries[channelType];
                modified = true;
                logger.info(`Cleared plugin channel: ${channelType}`);
            }
        }
        // Cleanup empty objects
        if (Object.keys(currentConfig.plugins.entries).length === 0) {
            delete currentConfig.plugins.entries;
        }
        if (currentConfig.plugins && Object.keys(currentConfig.plugins).length === 0) {
            delete currentConfig.plugins;
        }
    }

    if (modified) {
        writeOpenClawConfig(currentConfig);
        console.log('All channel configurations cleared');
    }

    // Also clean up WhatsApp credentials directory
    try {
        const whatsappDir = join(homedir(), '.openclaw', 'credentials', 'whatsapp');
        if (existsSync(whatsappDir)) {
            rmSync(whatsappDir, { recursive: true, force: true });
            console.log('Deleted WhatsApp credentials directory');
        }
    } catch (error) {
        console.error('Failed to delete WhatsApp credentials:', error);
    }
}

/**
 * List all configured channels
 */
export function listConfiguredChannels(): string[] {
    const config = readOpenClawConfig();
    const channels: string[] = [];

    if (config.channels) {
        channels.push(...Object.keys(config.channels).filter(
            (channelType) => config.channels![channelType]?.enabled !== false
        ));
    }

    // Check for WhatsApp credentials directory
    try {
        const whatsappDir = join(homedir(), '.openclaw', 'credentials', 'whatsapp');
        if (existsSync(whatsappDir)) {
            const entries = readdirSync(whatsappDir);
            // Check if there's at least one directory (session)
            const hasSession = entries.some((entry: string) => {
                try {
                    return statSync(join(whatsappDir, entry)).isDirectory();
                } catch { return false; }
            });

            if (hasSession && !channels.includes('whatsapp')) {
                channels.push('whatsapp');
            }
        }
    } catch {
        // Ignore errors checking whatsapp dir
    }

    return channels;
}

/**
 * Enable or disable a channel
 */
export function setChannelEnabled(channelType: string, enabled: boolean): void {
    const currentConfig = readOpenClawConfig();

    // Plugin-based channels go under plugins.entries
    if (PLUGIN_CHANNELS.includes(channelType)) {
        if (!currentConfig.plugins) {
            currentConfig.plugins = {};
        }
        if (!currentConfig.plugins.entries) {
            currentConfig.plugins.entries = {};
        }
        if (!currentConfig.plugins.entries[channelType]) {
            currentConfig.plugins.entries[channelType] = {};
        }
        currentConfig.plugins.entries[channelType].enabled = enabled;
        writeOpenClawConfig(currentConfig);
        console.log(`Set plugin channel ${channelType} enabled: ${enabled}`);
        return;
    }

    if (!currentConfig.channels) {
        currentConfig.channels = {};
    }

    if (!currentConfig.channels[channelType]) {
        currentConfig.channels[channelType] = {};
    }

    currentConfig.channels[channelType].enabled = enabled;
    writeOpenClawConfig(currentConfig);
    console.log(`Set channel ${channelType} enabled: ${enabled}`);
}

export interface ValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
}

export interface CredentialValidationResult {
    valid: boolean;
    errors: string[];
    warnings: string[];
    /** Extra info returned from the API (e.g. bot username, guild name) */
    details?: Record<string, string>;
}

const VALIDATION_TIMEOUT_MS = 15000;

function firstNonEmptyString(values: Array<unknown>): string | undefined {
    for (const value of values) {
        if (typeof value === 'string' && value.trim().length > 0) {
            return value.trim();
        }
    }
    return undefined;
}

function parseAxiosProxy(proxyUrl: string): AxiosProxyConfig | undefined {
    try {
        const parsed = new URL(proxyUrl);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return undefined;
        }

        const config: AxiosProxyConfig = {
            protocol: parsed.protocol.replace(':', ''),
            host: parsed.hostname,
            port: parsed.port ? Number(parsed.port) : (parsed.protocol === 'https:' ? 443 : 80),
        };

        if (parsed.username) {
            config.auth = {
                username: decodeURIComponent(parsed.username),
                password: decodeURIComponent(parsed.password || ''),
            };
        }

        return config;
    } catch {
        return undefined;
    }
}

function resolveProxyForValidation(
    channelType: string,
    config: Record<string, string>
): { proxyUrl?: string; proxyConfig?: AxiosProxyConfig } {
    const existingConfig = getChannelConfig(channelType);
    const existingProxy = typeof existingConfig?.proxy === 'string' ? existingConfig.proxy : undefined;

    const proxyUrl = firstNonEmptyString([
        config.proxy,
        existingProxy,
        process.env.ALL_PROXY,
        process.env.all_proxy,
        process.env.HTTPS_PROXY,
        process.env.https_proxy,
        process.env.HTTP_PROXY,
        process.env.http_proxy,
    ]);

    if (!proxyUrl) {
        return {};
    }

    return {
        proxyUrl,
        proxyConfig: parseAxiosProxy(proxyUrl),
    };
}

async function axiosGetJson(
    url: string,
    headers: Record<string, string>,
    proxyConfig?: AxiosProxyConfig
): Promise<{ ok: boolean; status: number; data: unknown }> {
    const response = await axios.get(url, {
        headers,
        timeout: VALIDATION_TIMEOUT_MS,
        validateStatus: () => true,
        proxy: proxyConfig,
    });

    return {
        ok: response.status >= 200 && response.status < 300,
        status: response.status,
        data: response.data,
    };
}

/**
 * Validate channel credentials by calling the actual service APIs
 * This validates the raw config values BEFORE saving them.
 *
 * @param channelType - The channel type (e.g., 'discord', 'telegram')
 * @param config - The raw config values from the form
 */
export async function validateChannelCredentials(
    channelType: string,
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    switch (channelType) {
        case 'discord':
            return validateDiscordCredentials(config);
        case 'telegram':
            return validateTelegramCredentials(config);
        default:
            // For channels without specific validation, just check required fields are present
            return { valid: true, errors: [], warnings: ['No online validation available for this channel type.'] };
    }
}

/**
 * Validate Discord bot token and optional guild/channel IDs
 */
async function validateDiscordCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const result: CredentialValidationResult = { valid: true, errors: [], warnings: [], details: {} };
    const token = config.token?.trim();
    const { proxyUrl, proxyConfig } = resolveProxyForValidation('discord', config);

    if (proxyUrl && !proxyConfig) {
        result.warnings.push(`Discord proxy URL is set but unsupported/invalid for validation: ${proxyUrl}`);
    }

    if (!token) {
        return { valid: false, errors: ['Bot token is required'], warnings: [] };
    }

    // 1) Validate bot token by calling GET /users/@me
    try {
        const meResponse = await axiosGetJson(
            'https://discord.com/api/v10/users/@me',
            { Authorization: `Bot ${token}` },
            proxyConfig
        );

        if (!meResponse.ok) {
            if (meResponse.status === 401) {
                return { valid: false, errors: ['Invalid bot token. Please check and try again.'], warnings: [] };
            }
            const msg = (meResponse.data as { message?: string })?.message || `Discord API error: ${meResponse.status}`;
            return { valid: false, errors: [msg], warnings: [] };
        }

        const meData = meResponse.data as { username?: string; id?: string; bot?: boolean };
        if (!meData.bot) {
            return {
                valid: false,
                errors: ['The provided token belongs to a user account, not a bot. Please use a bot token.'],
                warnings: [],
            };
        }
        result.details!.botUsername = meData.username || 'Unknown';
        result.details!.botId = meData.id || '';
    } catch (error) {
        const proxyHint = proxyUrl ? ` (proxy: ${proxyUrl})` : '';
        return {
            valid: false,
            errors: [`Connection error when validating bot token${proxyHint}: ${error instanceof Error ? error.message : String(error)}`],
            warnings: [],
        };
    }

    // 2) Validate guild ID (optional)
    const guildId = config.guildId?.trim();
    if (guildId) {
        try {
            const guildResponse = await axiosGetJson(
                `https://discord.com/api/v10/guilds/${guildId}`,
                { Authorization: `Bot ${token}` },
                proxyConfig
            );

            if (!guildResponse.ok) {
                if (guildResponse.status === 403 || guildResponse.status === 404) {
                    result.errors.push(
                        `Cannot access guild (server) with ID "${guildId}". Make sure the bot has been invited to this server.`
                    );
                    result.valid = false;
                } else {
                    result.errors.push(`Failed to verify guild ID: Discord API returned ${guildResponse.status}`);
                    result.valid = false;
                }
            } else {
                const guildData = guildResponse.data as { name?: string };
                result.details!.guildName = guildData.name || 'Unknown';
            }
        } catch (error) {
            result.warnings.push(`Could not verify guild ID: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    // 3) Validate channel ID (optional)
    const channelId = config.channelId?.trim();
    if (channelId) {
        try {
            const channelResponse = await axiosGetJson(
                `https://discord.com/api/v10/channels/${channelId}`,
                { Authorization: `Bot ${token}` },
                proxyConfig
            );

            if (!channelResponse.ok) {
                if (channelResponse.status === 403 || channelResponse.status === 404) {
                    result.errors.push(
                        `Cannot access channel with ID "${channelId}". Make sure the bot has permission to view this channel.`
                    );
                    result.valid = false;
                } else {
                    result.errors.push(`Failed to verify channel ID: Discord API returned ${channelResponse.status}`);
                    result.valid = false;
                }
            } else {
                const channelData = channelResponse.data as { name?: string; guild_id?: string };
                result.details!.channelName = channelData.name || 'Unknown';

                // Cross-check: if both guild and channel are provided, make sure channel belongs to the guild
                if (guildId && channelData.guild_id && channelData.guild_id !== guildId) {
                    result.errors.push(
                        `Channel "${channelData.name}" does not belong to the specified guild. It belongs to a different server.`
                    );
                    result.valid = false;
                }
            }
        } catch (error) {
            result.warnings.push(`Could not verify channel ID: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    return result;
}

/**
 * Validate Telegram bot token
 */
async function validateTelegramCredentials(
    config: Record<string, string>
): Promise<CredentialValidationResult> {
    const botToken = config.botToken?.trim();
    const { proxyUrl, proxyConfig } = resolveProxyForValidation('telegram', config);

    const warnings: string[] = [];
    if (proxyUrl && !proxyConfig) {
        warnings.push(`Telegram proxy URL is set but unsupported/invalid for validation: ${proxyUrl}`);
    }

    const allowedUsers = config.allowedUsers?.trim();

    if (!botToken) {
        return { valid: false, errors: ['Bot token is required'], warnings: [] };
    }

    if (!allowedUsers) {
        return { valid: false, errors: ['At least one allowed user ID is required'], warnings: [] };
    }

    try {
        const response = await axiosGetJson(
            `https://api.telegram.org/bot${botToken}/getMe`,
            {},
            proxyConfig
        );
        const data = response.data as { ok?: boolean; description?: string; result?: { username?: string } };

        if (data.ok) {
            return {
                valid: true,
                errors: [],
                warnings,
                details: { botUsername: data.result?.username || 'Unknown' },
            };
        }

        return {
            valid: false,
            errors: [data.description || 'Invalid bot token'],
            warnings,
        };
    } catch (error) {
        const proxyHint = proxyUrl ? ` (proxy: ${proxyUrl})` : '';
        return {
            valid: false,
            errors: [`Connection error${proxyHint}: ${error instanceof Error ? error.message : String(error)}`],
            warnings,
        };
    }
}



/**
 * Validate channel configuration using OpenClaw doctor
 */
export async function validateChannelConfig(channelType: string): Promise<ValidationResult> {
    const { execSync } = await import('child_process');

    const result: ValidationResult = {
        valid: true,
        errors: [],
        warnings: [],
    };

    try {
        // Get OpenClaw path
        const openclawPath = getOpenClawResolvedDir();

        // Run openclaw doctor command to validate config
        const output = execSync(
            `node openclaw.mjs doctor --json 2>&1`,
            {
                cwd: openclawPath,
                encoding: 'utf-8',
                timeout: 30000,
            }
        );

        // Parse output for errors related to the channel
        const lines = output.split('\n');
        for (const line of lines) {
            const lowerLine = line.toLowerCase();
            if (lowerLine.includes(channelType) && lowerLine.includes('error')) {
                result.errors.push(line.trim());
                result.valid = false;
            } else if (lowerLine.includes(channelType) && lowerLine.includes('warning')) {
                result.warnings.push(line.trim());
            } else if (lowerLine.includes('unrecognized key') && lowerLine.includes(channelType)) {
                result.errors.push(line.trim());
                result.valid = false;
            }
        }

        // If no specific errors found, check if config exists and is valid
        const config = readOpenClawConfig();
        if (!config.channels?.[channelType]) {
            result.errors.push(`Channel ${channelType} is not configured`);
            result.valid = false;
        } else if (!config.channels[channelType].enabled) {
            result.warnings.push(`Channel ${channelType} is disabled`);
        }

        // Channel-specific validation
        if (channelType === 'discord') {
            const discordConfig = config.channels?.discord;
            if (!discordConfig?.token) {
                result.errors.push('Discord: Bot token is required');
                result.valid = false;
            }
        } else if (channelType === 'telegram') {
            const telegramConfig = config.channels?.telegram;
            if (!telegramConfig?.botToken) {
                result.errors.push('Telegram: Bot token is required');
                result.valid = false;
            }
            // Check allowed users (stored as allowFrom array)
            const allowedUsers = telegramConfig?.allowFrom as string[] | undefined;
            if (!allowedUsers || allowedUsers.length === 0) {
                result.errors.push('Telegram: Allowed User IDs are required');
                result.valid = false;
            }
        }

        if (result.errors.length === 0 && result.warnings.length === 0) {
            result.valid = true;
        }

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);

        // Check for config errors in the error message
        if (errorMessage.includes('Unrecognized key') || errorMessage.includes('invalid config')) {
            result.errors.push(errorMessage);
            result.valid = false;
        } else if (errorMessage.includes('ENOENT')) {
            result.errors.push('OpenClaw not found. Please ensure OpenClaw is installed.');
            result.valid = false;
        } else {
            // Doctor command might fail but config could still be valid
            // Just log it and do basic validation
            console.warn('Doctor command failed:', errorMessage);

            const config = readOpenClawConfig();
            if (config.channels?.[channelType]) {
                result.valid = true;
            } else {
                result.errors.push(`Channel ${channelType} is not configured`);
                result.valid = false;
            }
        }
    }

    return result;
}
