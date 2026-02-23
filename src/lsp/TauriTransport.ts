import type { Transport } from '@codemirror/lsp-client';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { lspSendMessage, onLspMessage } from '@/lib/tauri';

/**
 * Transport implementation bridging @codemirror/lsp-client with
 * Tauri IPC. Messages are pure JSON strings (no Content-Length framing;
 * the Rust backend handles framing).
 *
 * The listener is set up eagerly; any messages that arrive before a
 * handler subscribes are queued and replayed on the first subscribe call.
 */
export class TauriTransport implements Transport {
  private handlers = new Set<(value: string) => void>();
  private unlisten: UnlistenFn | null = null;
  private pending: string[] = [];
  private listenerReady: Promise<void>;

  constructor(private serverId: string) {
    this.listenerReady = this.setupListener();
  }

  private async setupListener() {
    this.unlisten = await onLspMessage(this.serverId, (json) => {
      if (this.handlers.size === 0) {
        this.pending.push(json);
      } else {
        for (const handler of this.handlers) {
          handler(json);
        }
      }
    });
  }

  send(message: string): void {
    // Ensure the listener is set up before sending, so the response
    // isn't missed. In practice the LSP handshake starts with a client
    // request, and by the time the server responds the listener is up.
    lspSendMessage(this.serverId, message).catch((err) => {
      console.error(`[LSP] Failed to send message to ${this.serverId}:`, err);
    });
  }

  subscribe(handler: (value: string) => void): void {
    this.handlers.add(handler);

    // Replay any messages that arrived before subscribe was called
    if (this.pending.length > 0) {
      const queued = this.pending.splice(0);
      for (const json of queued) {
        handler(json);
      }
    }
  }

  unsubscribe(handler: (value: string) => void): void {
    this.handlers.delete(handler);
  }

  async destroy(): Promise<void> {
    this.handlers.clear();
    this.pending.length = 0;
    await this.listenerReady;
    if (this.unlisten) {
      this.unlisten();
      this.unlisten = null;
    }
  }
}
