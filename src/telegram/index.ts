/**
 * Multi-tenant Telegram module.
 * Exports all public functions and types for Telegram bot management.
 */

// Registry
export {
  TelegramRegistry,
  getTelegramRegistry,
  type InboundTelegramMessage,
  type TelegramMessageListener,
} from "./telegram-registry.js";

// Inbound (listener management)
export {
  startListenerForUser,
  stopListenerForUser,
  startAllListeners,
  stopAllListeners,
} from "./multitenant-inbound.js";

// Outbound (message sending)
export {
  sendMultiTenantTelegram,
  sendMultiTenantTelegramWithRetry,
  type MultiTenantTelegramSendOptions,
  type MultiTenantTelegramSendResult,
} from "./multitenant-outbound.js";

// Gateway adapter
export {
  sendTelegramGateway,
  createUserBoundSendTelegram,
  type GatewayTelegramOptions,
  type GatewayTelegramResult,
} from "./gateway-adapter.js";

// Bot handler
export { handleInboundTelegramMessage } from "./bot-handler.js";

// Legacy exports (for backward compatibility)
export * from "./bot.js";
export * from "./token.js";
