/**
 * Discord Registry for multi-tenant Discord bots.
 * Manages dedicated @buape/carbon Client instances per user with on-demand loading.
 */

import { Client } from "@buape/carbon";
import { GatewayIntents, GatewayPlugin } from "@buape/carbon/gateway";
import { getChildLogger } from "../logging.js";
import {
  getDiscordCredentialProvider,
  type DiscordCredentials,
} from "../credentials/discord-credentials.js";
import { fetchDiscordApplicationId } from "./probe.js";

/**
 * Bot entry in the registry.
 */
interface BotEntry {
  userId: string;
  client: Client;
  credentials: DiscordCredentials;
  applicationId: string;
  createdAt: number;
  lastActivityAt: number;
  status: "starting" | "running" | "stopped";
}

/**
 * Discord Registry for managing per-user bot instances.
 *
 * Features:
 * - On-demand loading: Clients created only when needed
 * - Manages @buape/carbon Client + GatewayPlugin per user
 */
export class DiscordRegistry {
  private bots = new Map<string, BotEntry>();
  private serverId: string;

  constructor(options?: { serverId?: string }) {
    this.serverId =
      options?.serverId ?? `server-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }

  /**
   * Get or create a Discord client for a user.
   * This is the main entry point for sending messages and starting the gateway.
   *
   * @param userId - User ID
   */
  async getClient(userId: string): Promise<Client> {
    // Check if we already have an active client
    const existing = this.bots.get(userId);
    if (existing && existing.status !== "stopped") {
      this.touchBot(userId);
      return existing.client;
    }

    // Create new client
    return this.createClient(userId);
  }

  /**
   * Start gateway for a user's bot.
   * This begins listening for incoming messages.
   */
  async startGateway(userId: string): Promise<void> {
    const entry = this.bots.get(userId);
    if (!entry) {
      // Create client if it doesn't exist
      await this.createClient(userId);
      return;
    }

    if (entry.status === "running") {
      console.log(`[DiscordRegistry] Gateway already running for user ${userId}`);
      return;
    }

    // Gateway is started when client is created with GatewayPlugin
    entry.status = "running";
    console.log(`[DiscordRegistry] Started gateway for user ${userId}`);
  }

  /**
   * Stop and cleanup a client for a user.
   */
  async stopClient(userId: string): Promise<void> {
    const entry = this.bots.get(userId);
    if (!entry) {
      return;
    }

    const logger = getChildLogger({ module: "discord-registry", userId });
    logger.info("Stopping Discord client");

    try {
      // Disconnect gateway
      const gateway = entry.client.getPlugin<GatewayPlugin>("gateway");
      if (gateway) {
        gateway.disconnect();
      }
    } catch (error) {
      logger.error({ error: String(error) }, "Error disconnecting gateway");
    }

    // Update status
    entry.status = "stopped";

    // Remove from registry
    this.bots.delete(userId);

    logger.info("Discord client stopped and removed from registry");
  }

  /**
   * Check if a user has an active client on this server.
   */
  hasClient(userId: string): boolean {
    const entry = this.bots.get(userId);
    return entry?.status === "running";
  }

  /**
   * Get client count for monitoring.
   */
  getClientCount(): number {
    return this.bots.size;
  }

  /**
   * Graceful shutdown of all clients.
   */
  async shutdown(): Promise<void> {
    console.log(`[DiscordRegistry] Shutting down ${this.bots.size} clients...`);

    const shutdownPromises = Array.from(this.bots.keys()).map((userId) => this.stopClient(userId));
    await Promise.all(shutdownPromises);

    console.log("[DiscordRegistry] Shutdown complete");
  }

  /**
   * Create a new Discord client for a user.
   */
  private async createClient(userId: string): Promise<Client> {
    const logger = getChildLogger({ module: "discord-registry", userId });
    logger.info("Creating Discord client for user");

    // Fetch credentials
    const credentialProvider = getDiscordCredentialProvider();
    const credentials = await credentialProvider.fetchCredentials(userId);

    if (!credentials) {
      throw new Error(`No Discord credentials found for user: ${userId}`);
    }

    // Fetch application ID from Discord API
    const applicationId = await fetchDiscordApplicationId(credentials.botToken, 4000);
    if (!applicationId) {
      throw new Error(`Failed to fetch application ID for user: ${userId}`);
    }

    // Create @buape/carbon client with GatewayPlugin
    const client = new Client(
      {
        baseUrl: "http://localhost",
        deploySecret: "unused",
        clientId: applicationId,
        publicKey: credentials.publicKey || "unused",
        token: credentials.botToken,
        autoDeploy: false,
      },
      {
        commands: [],
        listeners: [],
        components: [],
      },
      [
        new GatewayPlugin({
          reconnect: {
            maxAttempts: Number.POSITIVE_INFINITY,
          },
          intents:
            GatewayIntents.Guilds |
            GatewayIntents.GuildMessages |
            GatewayIntents.MessageContent |
            GatewayIntents.DirectMessages |
            GatewayIntents.GuildMessageReactions |
            GatewayIntents.DirectMessageReactions,
          autoInteractions: true,
        }),
      ],
    );

    // Create entry
    const entry: BotEntry = {
      userId,
      client,
      credentials,
      applicationId,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      status: "running",
    };

    this.bots.set(userId, entry);

    logger.info("Discord client created and started");

    return client;
  }

  /**
   * Touch a client to reset its idle timer.
   */
  private touchBot(userId: string): void {
    const entry = this.bots.get(userId);
    if (!entry) {
      return;
    }

    entry.lastActivityAt = Date.now();
  }
}

/**
 * Singleton instance for convenience.
 */
let discordRegistry: DiscordRegistry | null = null;

/**
 * Get or create the global DiscordRegistry instance.
 */
export function getDiscordRegistry(options?: { serverId?: string }): DiscordRegistry {
  if (!discordRegistry) {
    discordRegistry = new DiscordRegistry(options);
  }
  return discordRegistry;
}
