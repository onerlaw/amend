import {
  LSPClient,
  serverDiagnostics,
  hoverTooltips,
  serverCompletion,
  signatureHelp,
} from '@codemirror/lsp-client';
import { TauriTransport } from './TauriTransport';
import {
  getServerConfigForExtension,
  extensionToLspLanguageId,
  type LspServerConfig,
} from './serverConfig';
import { lspStartServer, lspStopServer, onLspExit } from '@/lib/tauri';
import type { UnlistenFn } from '@tauri-apps/api/event';

interface ManagedServer {
  serverId: string;
  config: LspServerConfig;
  client: LSPClient;
  transport: TauriTransport;
  unlistenExit: UnlistenFn | null;
  /** Number of active files using this server */
  refCount: number;
  /** Whether a restart has already been attempted after a crash */
  hasRestarted: boolean;
}

/**
 * Key for the server map: one server per (serverName, projectRoot).
 */
function serverKey(configName: string, rootPath: string): string {
  return `${configName}::${rootPath}`;
}

const servers = new Map<string, ManagedServer>();

export interface LspServerStatus {
  configName: string;
  serverId: string;
  refCount: number;
  rootPath: string;
}

export function getRunningServers(): LspServerStatus[] {
  const result: LspServerStatus[] = [];
  for (const [key, managed] of servers) {
    const rootPath = key.split('::')[1] ?? '';
    result.push({
      configName: managed.config.name,
      serverId: managed.serverId,
      refCount: managed.refCount,
      rootPath,
    });
  }
  return result;
}

/**
 * Get or start an LSP client for the given file extension and project root.
 * Returns { client, languageId } or null if no server config matches.
 */
export async function getOrStartLspClient(
  fileExtension: string,
  rootPath: string
): Promise<{ client: LSPClient; languageId: string } | null> {
  const ext = fileExtension.replace(/^\./, '');
  const config = getServerConfigForExtension(ext);
  if (!config) return null;

  const languageId = extensionToLspLanguageId(ext);
  if (!languageId) return null;

  const key = serverKey(config.name, rootPath);
  const existing = servers.get(key);
  if (existing) {
    existing.refCount++;
    return { client: existing.client, languageId };
  }

  const managed = await startServer(config, rootPath, key);
  if (!managed) return null;

  return { client: managed.client, languageId };
}

/**
 * Release a reference to an LSP server. When refCount hits 0 the server
 * is kept alive (it may be needed again when another file opens).
 */
export function releaseLspClient(fileExtension: string, rootPath: string): void {
  const ext = fileExtension.replace(/^\./, '');
  const config = getServerConfigForExtension(ext);
  if (!config) return;

  const key = serverKey(config.name, rootPath);
  const managed = servers.get(key);
  if (managed) {
    managed.refCount = Math.max(0, managed.refCount - 1);
  }
}

/**
 * Stop all LSP servers (e.g. on app shutdown or project change).
 */
export async function stopAllServers(): Promise<void> {
  for (const [key, managed] of servers) {
    managed.client.disconnect();
    await managed.transport.destroy();
    managed.unlistenExit?.();
    await lspStopServer(managed.serverId).catch(() => {});
    servers.delete(key);
  }
}

async function startServer(
  config: LspServerConfig,
  rootPath: string,
  key: string
): Promise<ManagedServer | null> {
  const serverId = `${config.name.toLowerCase()}-${Date.now()}`;

  try {
    await lspStartServer({
      serverId,
      args: config.args,
      rootPath,
      useBundledNode: config.useBundledNode,
      serverScript: config.serverScript,
      command: config.command,
    });
  } catch (err) {
    console.error(`[LSP] Failed to start ${config.name} server:`, err);
    return null;
  }

  const transport = new TauriTransport(serverId);
  const client = new LSPClient({
    rootUri: `file://${rootPath}`,
    timeout: 10000,
    extensions: [serverDiagnostics(), hoverTooltips(), serverCompletion(), signatureHelp()],
  });

  client.connect(transport);

  const managed: ManagedServer = {
    serverId,
    config,
    client,
    transport,
    unlistenExit: null,
    refCount: 1,
    hasRestarted: false,
  };

  servers.set(key, managed);

  // Handle server exit — attempt one restart
  managed.unlistenExit = await onLspExit(serverId, async () => {
    console.warn(`[LSP] Server ${config.name} (${serverId}) exited`);
    const current = servers.get(key);
    if (!current || current.serverId !== serverId) return;

    client.disconnect();
    await transport.destroy();
    current.unlistenExit?.();
    servers.delete(key);

    if (!managed.hasRestarted && managed.refCount > 0) {
      console.log(`[LSP] Attempting restart of ${config.name}`);
      const restarted = await startServer(config, rootPath, key);
      if (restarted) {
        restarted.hasRestarted = true;
        restarted.refCount = managed.refCount;
      }
    }
  });

  return managed;
}
