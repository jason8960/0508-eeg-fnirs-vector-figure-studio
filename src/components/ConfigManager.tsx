import { useState } from 'react';

/**
 * Generic save / load / import / export panel used by charts that
 * persist a typed `SavedConfig` to localStorage. Defined at module
 * scope so React's `react-hooks/static-components` rule does not
 * trip — components must not be (re-)created during a parent render.
 */
export interface ConfigManagerProps<T> {
  filename: string;
  savedConfigs: Record<string, T>;
  buildCurrentConfig: () => T;
  applyConfig: (cfg: T) => void;
  saveConfigToSlot: (name: string) => void;
  deleteConfigSlot: (name: string) => void;
  /**
   * Optional "restore defaults" handler. When provided, the panel
   * renders a destructive-styled button that calls back into the
   * caller; the button asks for confirmation first since the action
   * cannot be undone (auto-saved slots survive, but the live state
   * is replaced wholesale).
   */
  onReset?: () => void;
}

export function ConfigManager<T>({
  filename,
  savedConfigs,
  buildCurrentConfig,
  applyConfig,
  saveConfigToSlot,
  deleteConfigSlot,
  onReset,
}: ConfigManagerProps<T>) {
  const [slotName, setSlotName] = useState('');
  const [importError, setImportError] = useState<string | null>(null);

  const handleImport = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const cfg = JSON.parse(String(reader.result)) as T;
        applyConfig(cfg);
        setImportError(null);
      } catch {
        setImportError('导入失败：无效的配置文件');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <input
          type="text"
          value={slotName}
          onChange={(e) => setSlotName(e.target.value)}
          placeholder="配置名称"
          className="flex-1 rounded border border-ink-600 bg-ink-800 px-2 py-1 text-xs text-ink-50"
        />
        <button
          onClick={() => {
            if (slotName.trim()) {
              saveConfigToSlot(slotName.trim());
              setSlotName('');
            }
          }}
          className="rounded bg-accent px-2 py-1 text-xs text-white hover:bg-accent/80"
        >
          保存
        </button>
      </div>

      {Object.keys(savedConfigs).length > 0 && (
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">
            已保存配置
          </p>
          {Object.entries(savedConfigs).map(([name, cfg]) => (
            <div
              key={name}
              className="flex items-center justify-between rounded border border-ink-700 bg-ink-800/50 px-2 py-1"
            >
              <span className="text-xs text-ink-200">{name}</span>
              <div className="flex gap-1">
                <button
                  onClick={() => applyConfig(cfg as T)}
                  className="rounded px-1.5 py-0.5 text-[10px] bg-ink-700 text-ink-200 hover:bg-ink-600"
                >
                  加载
                </button>
                <button
                  onClick={() => deleteConfigSlot(name)}
                  className="rounded px-1.5 py-0.5 text-[10px] text-red-400 hover:bg-red-900/30"
                >
                  删除
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <button
          onClick={() => {
            const blob = new Blob(
              [JSON.stringify(buildCurrentConfig(), null, 2)],
              { type: 'application/json' },
            );
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            a.click();
            URL.revokeObjectURL(url);
          }}
          className="flex-1 rounded border border-ink-600 px-2 py-1 text-xs text-ink-200 hover:bg-ink-800"
        >
          导出 JSON
        </button>
        <label className="flex-1 cursor-pointer rounded border border-ink-600 px-2 py-1 text-center text-xs text-ink-200 hover:bg-ink-800">
          导入
          <input
            type="file"
            accept=".json"
            className="hidden"
            onChange={(e) =>
              e.target.files?.[0] && handleImport(e.target.files[0])
            }
          />
        </label>
      </div>
      {importError && (
        <p className="text-[11px] text-red-400">{importError}</p>
      )}
      {onReset && (
        <button
          type="button"
          onClick={() => {
            if (
              window.confirm(
                '将当前所有调整恢复为默认状态（已保存配置不会被删除）？',
              )
            ) {
              onReset();
            }
          }}
          className="w-full rounded border border-rose-500/60 bg-rose-500/15 px-2 py-1 text-[11px] text-rose-200 hover:bg-rose-500/25"
        >
          恢复默认
        </button>
      )}
    </div>
  );
}
