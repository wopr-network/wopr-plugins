import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import type { ServerConfig } from "./config.js";

export interface ConnectedServer {
  config: ServerConfig;
  client: Client;
  transport: Transport;
  toolNames: string[]; // namespaced tool names registered as A2A
}

export interface MCPExtension {
  connect(config: ServerConfig): Promise<void>;
  disconnect(name: string): Promise<void>;
  listServers(): Array<{ name: string; kind: string; toolCount: number }>;
}
