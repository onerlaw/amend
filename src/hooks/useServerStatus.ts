import { useState, useEffect } from 'react';
import { getRunningServers, type LspServerStatus } from '@/lsp/manager';
import { serverConfigs, type LspServerConfig } from '@/lsp/serverConfig';
import { getMcpServerPort, readFile } from '@/lib/tauri';
import { homeDir } from '@tauri-apps/api/path';

export interface LspConfigStatus {
  config: LspServerConfig;
  running: LspServerStatus | null;
}

export interface McpStatus {
  port: number | null;
  registered: boolean;
}

const MCP_TOOLS = ['list_terminals', 'read_terminal_output', 'is_terminal_busy', 'write_to_terminal'];
const MCP_SERVER_NAME = 'amend-terminal-mcp';
const MCP_PROTOCOL_VERSION = '2024-11-05';

export function useServerStatus() {
  const [lspStatuses, setLspStatuses] = useState<LspConfigStatus[]>([]);
  const [mcpStatus, setMcpStatus] = useState<McpStatus>({ port: null, registered: false });

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
      let registered = false;
      try {
        const home = await homeDir();
        const content = await readFile(`${home}.claude.json`);
        const parsed = JSON.parse(content);
        const servers = parsed?.mcpServers ?? {};
        registered = Object.values(servers as Record<string, { url?: string }>).some(
          (s) => typeof s?.url === 'string' && s.url.includes('localhost') && s.url.includes(String(port))
        );
      } catch {
        // File doesn't exist or can't be parsed
      }
      setMcpStatus({ port, registered });
    }

    refresh();
    refreshMcp();

    const interval = setInterval(() => {
      refresh();
      refreshMcp();
    }, 3000);

    return () => clearInterval(interval);
  }, []);

  return { lspStatuses, mcpStatus, mcpTools: MCP_TOOLS, mcpServerName: MCP_SERVER_NAME, mcpProtocolVersion: MCP_PROTOCOL_VERSION };
}
