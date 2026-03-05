import { useState, useEffect } from 'react';
import { getRunningServers, type LspServerStatus } from '@/lsp/manager';
import { serverConfigs, type LspServerConfig } from '@/lsp/serverConfig';
import { getMcpServerPort, checkMcpRegistrations, type McpToolRegistration } from '@/lib/tauri';

export interface LspConfigStatus {
  config: LspServerConfig;
  running: LspServerStatus | null;
}

export interface McpStatus {
  port: number | null;
  registrations: McpToolRegistration[];
}

const MCP_TOOLS = [
  'list_terminals',
  'read_terminal_output',
  'is_terminal_busy',
  'write_to_terminal',
];
const MCP_SERVER_NAME = 'amend-terminal-mcp';
const MCP_PROTOCOL_VERSION = '2024-11-05';

export function useServerStatus() {
  const [lspStatuses, setLspStatuses] = useState<LspConfigStatus[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpStatus>({ port: null, registrations: [] });

  useEffect(() => {
    function refresh() {
      const running = getRunningServers();
      const statuses = serverConfigs.map((config) => ({
        config,
        running: running.find((r) => r.configName === config.name) ?? null,
      }));
      setLspStatuses(statuses);
    }

    async function refreshMcp() {
      const port = await getMcpServerPort().catch(() => null);
      let registrations: McpToolRegistration[] = [];
      if (port) {
        try {
          registrations = await checkMcpRegistrations();
        } catch {
          // Server might not be ready yet
        }
      }
      setMcpStatus({ port, registrations });
    }

    refresh();
    refreshMcp();

    const interval = setInterval(() => {
      refresh();
      refreshMcp();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return {
    lspStatuses,
    mcpStatus,
    mcpTools: MCP_TOOLS,
    mcpServerName: MCP_SERVER_NAME,
    mcpProtocolVersion: MCP_PROTOCOL_VERSION,
  };
}
