/**
 * WhatsApp module exports for multi-tenant support.
 */

export { useSupabaseAuthState, type SupabaseAuthState } from "./supabase-auth-state.js";
export {
  ConnectionRegistry,
  getConnectionRegistry,
  setConnectionRegistry,
} from "./connection-registry.js";
export {
  sendMultiTenantWhatsApp,
  hasActiveConnection,
  getActiveConnectionCount,
  type MultiTenantSendOptions,
  type MultiTenantSendResult,
} from "./multitenant-outbound.js";
export {
  sendWhatsAppGateway,
  createUserBoundSendWhatsApp,
  type GatewayWhatsAppOptions,
  type GatewayWhatsAppResult,
} from "./gateway-adapter.js";
export {
  startListenerForUser,
  startAllListeners,
  stopListenerForUser,
} from "./multitenant-inbound.js";
export { handleInboundMessage } from "./bot-handler.js";
export type { InboundWhatsAppMessage, MessageListener } from "./connection-registry.js";
