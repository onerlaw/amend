import { useTheme } from '@/hooks/useTheme';
import { useServerStatus } from '@/hooks/useServerStatus';
import { ModalOverlay } from '@/components/ModalOverlay';
import { CloseIcon, SunIcon, MoonIcon, MonitorIcon } from '@/components/Icons';
import { formatShortcut } from '@/lib/fileUtils';
import { registerMcpServer } from '@/lib/tauri';

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const { themeMode, setThemeMode } = useTheme();
  const { lspStatuses, mcpStatus, mcpTools, mcpServerName, mcpProtocolVersion } = useServerStatus();

  const themes = [
    { mode: 'light' as const, label: 'Light', icon: <SunIcon className="h-3.5 w-3.5" /> },
    { mode: 'dark' as const, label: 'Dark', icon: <MoonIcon className="h-3.5 w-3.5" /> },
    { mode: 'system' as const, label: 'System', icon: <MonitorIcon className="h-3.5 w-3.5" /> },
  ];

  return (
    <ModalOverlay onClose={onClose}>
      <div className="w-[560px] rounded-xl bg-surface-2 p-4 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-primary">Settings</h2>
          <button onClick={onClose} className="rounded-md p-1 text-secondary hover:bg-surface-3">
            <CloseIcon className="h-4 w-4" />
          </button>
        </div>

        <div className="max-h-[80vh] space-y-3 overflow-y-auto">
          {/* Appearance */}
          <div>
            <h3 className="mb-2 text-xs font-medium text-secondary">Appearance</h3>
            <div className="flex gap-2">
              {themes.map(({ mode, label, icon }) => (
                <button
                  key={mode}
                  onClick={() => setThemeMode(mode)}
                  className={`flex flex-1 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-xs ${
                    themeMode === mode
                      ? 'bg-accent text-white'
                      : 'bg-surface-3 text-secondary hover:text-primary'
                  }`}
                >
                  {icon}
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-surface-3" />

          {/* Language Servers */}
          <div>
            <h3 className="mb-2 text-xs font-medium text-secondary">Language Servers</h3>
            <div className="space-y-2">
              {lspStatuses.map(({ config, running }) => (
                <div
                  key={config.name}
                  className="flex items-center justify-between rounded-md bg-surface-3 px-3 py-2"
                >
                  <div>
                    <div className="text-xs font-medium text-primary">{config.name}</div>
                    <div className="text-[10px] text-tertiary">
                      {config.fileExtensions.map((e) => `.${e}`).join(', ')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${running ? 'bg-green-500' : 'bg-gray-400'}`}
                    />
                    <span className="text-[10px] text-secondary">
                      {running
                        ? `Running (${running.refCount} ${running.refCount === 1 ? 'file' : 'files'})`
                        : 'Stopped'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="border-t border-surface-3" />

          {/* MCP Server */}
          <div>
            <h3 className="mb-2 text-xs font-medium text-secondary">MCP Server</h3>
            <div className="space-y-2 rounded-md bg-surface-3 px-3 py-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${mcpStatus.port ? 'bg-green-500' : 'bg-gray-400'}`}
                  />
                  <span className="text-xs font-medium text-primary">{mcpServerName}</span>
                </div>
                {mcpStatus.port && (
                  <span className="text-[10px] text-tertiary">port {mcpStatus.port}</span>
                )}
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-tertiary">Transport</span>
                <span className="text-secondary">SSE</span>
              </div>
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-tertiary">Protocol</span>
                <span className="text-secondary">{mcpProtocolVersion}</span>
              </div>
              {mcpStatus.registrations.length > 0 && (
                <div>
                  <div className="mb-1 flex items-center justify-between">
                    <span className="text-[10px] text-tertiary">Registrations</span>
                    {mcpStatus.port && mcpStatus.registrations.some((r) => !r.registered) && (
                      <button
                        onClick={() => registerMcpServer()}
                        className="rounded bg-accent px-1.5 py-0.5 text-[10px] text-white hover:bg-accent/80"
                      >
                        Install All
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    {mcpStatus.registrations.map((reg) => (
                      <div key={reg.name} className="flex items-center justify-between text-[10px]">
                        <span className="text-tertiary">{reg.name}</span>
                        <div className="flex items-center gap-1.5">
                          <span
                            className={`inline-block h-1.5 w-1.5 rounded-full ${reg.registered ? 'bg-green-500' : 'bg-gray-400'}`}
                          />
                          <span className={reg.registered ? 'text-green-500' : 'text-secondary'}>
                            {reg.registered ? 'Registered' : 'Not registered'}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div>
                <div className="mb-1 text-[10px] text-tertiary">Tools</div>
                <div className="flex flex-wrap gap-1">
                  {mcpTools.map((tool) => (
                    <span
                      key={tool}
                      className="rounded bg-surface-1 px-1.5 py-0.5 text-[10px] text-secondary"
                    >
                      {tool}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-surface-3" />

          {/* Keyboard Shortcuts */}
          <div>
            <h3 className="mb-2 text-xs font-medium text-secondary">Keyboard Shortcuts</h3>
            <div className="space-y-2 text-xs">
              {[
                ['New Terminal', formatShortcut('Mod+T')],
                ['Open Folder', formatShortcut('Mod+O')],
                ['Cycle Panes', formatShortcut('Mod+`')],
                ['Split Right', formatShortcut('Mod+D')],
                ['Split Down', formatShortcut('Mod+Shift+D')],
                ['Close Tab', formatShortcut('Mod+W')],
                ['Search', `${formatShortcut('Mod+P')} / ${formatShortcut('Mod+Shift+F')}`],
                ['Find in File', formatShortcut('Mod+F')],
                ['Go to Line', formatShortcut('Mod+G')],
                ['Fold Code', formatShortcut('Mod+Shift+[')],
                ['Unfold Code', formatShortcut('Mod+Shift+]')],
                ['Paste Files', formatShortcut('Mod+V')],
                ['Toggle Notes', formatShortcut('Mod+Shift+N')],
                ['Increase Font Size', formatShortcut('Mod+=')],
                ['Decrease Font Size', formatShortcut('Mod+-')],
                ['Reset Font Size', formatShortcut('Mod+0')],
              ].map(([label, keys]) => (
                <div key={label} className="flex items-center justify-between py-1">
                  <span className="text-primary">{label}</span>
                  <kbd className="rounded-md bg-surface-1 px-2 py-0.5 font-mono text-secondary">
                    {keys}
                  </kbd>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </ModalOverlay>
  );
}
