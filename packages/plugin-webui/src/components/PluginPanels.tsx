import {
  type Component,
  createEffect,
  createResource,
  createSignal,
  For,
  Match,
  onCleanup,
  Show,
  Switch,
} from "solid-js";
import { api, type ConfigFieldDef, type PluginManifestSummary, type WebUIPanel } from "../lib/api.js";

const DEFAULT_POLL_MS = 10_000;

// --- Status Panel: polls lifecycle endpoints and shows the result ---

const StatusPanel: Component<{
  plugin: PluginManifestSummary;
  panel: WebUIPanel;
}> = (props) => {
  const [statuses, setStatuses] = createSignal<Record<string, { ok: boolean; data?: unknown; error?: string }>>({});

  const endpoints = () => props.panel.endpoints ?? [];
  const intervalMs = () => props.panel.pollIntervalMs ?? DEFAULT_POLL_MS;

  createEffect(() => {
    let cancelled = false;

    async function poll() {
      const results: Record<string, { ok: boolean; data?: unknown; error?: string }> = {};
      for (const ep of endpoints()) {
        try {
          const data = await api.pollPluginEndpoint(props.plugin.name, ep);
          results[ep] = { ok: true, data };
        } catch (err: unknown) {
          results[ep] = {
            ok: false,
            error: err instanceof Error ? err.message : "Unknown error",
          };
        }
      }
      if (!cancelled) setStatuses(results);
    }

    poll();
    const timer = setInterval(poll, intervalMs());
    onCleanup(() => {
      cancelled = true;
      clearInterval(timer);
    });
  });

  return (
    <div class="space-y-2">
      <Show when={endpoints().length > 0} fallback={<p class="text-wopr-muted text-sm">No endpoints declared</p>}>
        <For each={endpoints()}>
          {(ep) => {
            const status = () => statuses()[ep];
            return (
              <div class="flex items-center justify-between bg-wopr-bg rounded px-3 py-2 text-sm">
                <code class="text-wopr-muted">{ep}</code>
                <Show when={status()} fallback={<span class="text-wopr-muted">polling...</span>}>
                  <span class={status()?.ok ? "text-green-400" : "text-red-400"}>
                    {status()?.ok ? "OK" : (status()?.error ?? "Error")}
                  </span>
                </Show>
              </div>
            );
          }}
        </For>
      </Show>
    </div>
  );
};

// --- Config Panel: renders config fields from the manifest schema ---

const ConfigPanel: Component<{
  plugin: PluginManifestSummary;
  panel: WebUIPanel;
}> = (props) => {
  const [config, setConfig] = createSignal<Record<string, unknown>>({});
  const [saving, setSaving] = createSignal(false);
  const [message, setMessage] = createSignal<string | null>(null);
  const [loadError, setLoadError] = createSignal<string | null>(null);

  // Load plugin config on mount
  const [loaded] = createResource(async () => {
    try {
      const data = (await api.getPluginConfig(props.plugin.name)) as Record<string, unknown>;
      setConfig(data);
      return true;
    } catch (err: unknown) {
      setLoadError(err instanceof Error ? err.message : "Failed to load config");
      return false;
    }
  });

  const fields = (): ConfigFieldDef[] => {
    const schema = props.plugin.configSchema;
    if (!schema) return [];
    const declared = props.panel.configFields;
    if (!declared || declared.length === 0) return schema.fields;
    return schema.fields.filter((f) => declared.includes(f.name));
  };

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      for (const field of fields()) {
        const value = config()[field.name];
        if (value !== undefined) {
          await api.setPluginConfigValue(props.plugin.name, field.name, value);
        }
      }
      setMessage("Saved");
      setTimeout(() => setMessage(null), 2000);
    } catch (err: unknown) {
      setMessage(`Error: ${err instanceof Error ? err.message : "Unknown error"}`);
    } finally {
      setSaving(false);
    }
  }

  function updateField(name: string, value: unknown) {
    setConfig((prev) => ({ ...prev, [name]: value }));
  }

  return (
    <div class="space-y-3">
      <Show when={loadError()}>
        <p class="text-red-400 text-sm">Failed to load config: {loadError()}</p>
      </Show>
      <Show
        when={loaded()}
        fallback={
          <Show when={!loadError()}>
            <p class="text-wopr-muted text-sm">Loading config...</p>
          </Show>
        }
      >
        <For each={fields()}>
          {(field) => (
            <label class="block">
              <span class="block text-sm text-wopr-muted mb-1">{field.label}</span>
              <Show when={field.description}>
                <p class="text-xs text-wopr-muted/70 mb-1">{field.description}</p>
              </Show>
              <Switch
                fallback={
                  <input
                    type={field.secret ? "password" : "text"}
                    value={String(config()[field.name] ?? field.default ?? "")}
                    onInput={(e) => updateField(field.name, e.currentTarget.value)}
                    placeholder={field.placeholder}
                    class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 text-sm focus:outline-none focus:border-wopr-accent"
                  />
                }
              >
                <Match when={field.type === "checkbox" || field.type === "boolean"}>
                  <input
                    type="checkbox"
                    checked={Boolean(config()[field.name] ?? field.default)}
                    onChange={(e) => updateField(field.name, e.currentTarget.checked)}
                    class="rounded border-wopr-border"
                  />
                </Match>
                <Match when={field.type === "number"}>
                  <input
                    type="number"
                    value={Number(config()[field.name] ?? field.default ?? 0)}
                    onInput={(e) => updateField(field.name, Number(e.currentTarget.value))}
                    placeholder={field.placeholder}
                    class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 text-sm focus:outline-none focus:border-wopr-accent"
                  />
                </Match>
                <Match when={field.type === "select" && field.options}>
                  <select
                    value={String(config()[field.name] ?? field.default ?? "")}
                    onChange={(e) => updateField(field.name, e.currentTarget.value)}
                    class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 text-sm focus:outline-none focus:border-wopr-accent"
                  >
                    <For each={field.options}>{(opt) => <option value={opt.value}>{opt.label}</option>}</For>
                  </select>
                </Match>
                <Match when={field.type === "textarea"}>
                  <textarea
                    value={String(config()[field.name] ?? field.default ?? "")}
                    onInput={(e) => updateField(field.name, e.currentTarget.value)}
                    placeholder={field.placeholder}
                    rows={3}
                    class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 text-sm resize-none focus:outline-none focus:border-wopr-accent"
                  />
                </Match>
              </Switch>
            </label>
          )}
        </For>

        <div class="flex items-center gap-3 pt-2">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving()}
            class="px-4 py-1.5 bg-wopr-accent text-wopr-bg rounded text-sm font-semibold hover:bg-wopr-accent/90 disabled:opacity-50"
          >
            {saving() ? "Saving..." : "Save"}
          </button>
          <Show when={message()}>
            <span class={`text-sm ${message()?.startsWith("Error") ? "text-red-400" : "text-green-400"}`}>
              {message()}
            </span>
          </Show>
        </div>
      </Show>
    </div>
  );
};

// --- Logs Panel: placeholder streaming log viewer ---

const LogsPanel: Component<{
  plugin: PluginManifestSummary;
  panel: WebUIPanel;
}> = (props) => {
  return (
    <div class="bg-wopr-bg rounded p-3 text-sm text-wopr-muted font-mono h-40 overflow-auto">
      <p>Log streaming for {props.plugin.name} (connect via WebSocket)</p>
    </div>
  );
};

// --- Metrics Panel: polls endpoints and displays key/value data ---

const MetricsPanel: Component<{
  plugin: PluginManifestSummary;
  panel: WebUIPanel;
}> = (props) => {
  const [metrics, setMetrics] = createSignal<Record<string, unknown>>({});

  const endpoints = () => props.panel.endpoints ?? [];
  const intervalMs = () => props.panel.pollIntervalMs ?? DEFAULT_POLL_MS;

  const [stale, setStale] = createSignal(false);

  createEffect(() => {
    let cancelled = false;

    async function poll() {
      for (const ep of endpoints()) {
        try {
          const data = (await api.pollPluginEndpoint(props.plugin.name, ep)) as Record<string, unknown>;
          if (!cancelled) {
            setMetrics((prev) => ({ ...prev, ...data }));
            setStale(false);
          }
        } catch (err: unknown) {
          console.error(`[MetricsPanel] Failed to poll ${ep} for ${props.plugin.name}:`, err);
          if (!cancelled) setStale(true);
        }
      }
    }

    poll();
    const timer = setInterval(poll, intervalMs());
    onCleanup(() => {
      cancelled = true;
      clearInterval(timer);
    });
  });

  return (
    <div class="space-y-1">
      <Show when={stale()}>
        <p class="text-yellow-400 text-xs">Metrics may be stale (poll error)</p>
      </Show>
      <Show
        when={Object.keys(metrics()).length > 0}
        fallback={<p class="text-wopr-muted text-sm">Waiting for metrics...</p>}
      >
        <For each={Object.entries(metrics())}>
          {([key, value]) => (
            <div class="flex justify-between bg-wopr-bg rounded px-3 py-1.5 text-sm">
              <span class="text-wopr-muted">{key}</span>
              <span class="text-wopr-text font-mono">{String(value)}</span>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
};

// --- Single panel card wrapper ---

const PanelCard: Component<{
  plugin: PluginManifestSummary;
  panel: WebUIPanel;
}> = (props) => {
  return (
    <section class="bg-wopr-panel border border-wopr-border rounded-lg p-4">
      <h3 class="text-sm font-semibold text-wopr-accent uppercase mb-3 flex items-center gap-2">
        <Show when={props.panel.icon}>
          <span>{props.panel.icon}</span>
        </Show>
        {props.panel.title}
      </h3>

      <Switch fallback={<p class="text-wopr-muted text-sm">Unknown panel type</p>}>
        <Match when={props.panel.type === "status"}>
          <StatusPanel plugin={props.plugin} panel={props.panel} />
        </Match>
        <Match when={props.panel.type === "config"}>
          <ConfigPanel plugin={props.plugin} panel={props.panel} />
        </Match>
        <Match when={props.panel.type === "logs"}>
          <LogsPanel plugin={props.plugin} panel={props.panel} />
        </Match>
        <Match when={props.panel.type === "metrics"}>
          <MetricsPanel plugin={props.plugin} panel={props.panel} />
        </Match>
        <Match when={props.panel.type === "custom"}>
          <p class="text-wopr-muted text-sm">Custom component: {props.panel.component ?? "(none)"}</p>
        </Match>
      </Switch>
    </section>
  );
};

// --- Plugin section: all panels for a single plugin ---

const PluginSection: Component<{ plugin: PluginManifestSummary }> = (props) => {
  const panels = () => props.plugin.webui?.panels ?? [];

  return (
    <div class="space-y-4">
      <div class="flex items-center gap-2">
        <Show when={props.plugin.icon}>
          <span class="text-lg">{props.plugin.icon}</span>
        </Show>
        <h2 class="text-lg font-semibold text-wopr-text">{props.plugin.name}</h2>
        <span class="text-xs text-wopr-muted">v{props.plugin.version}</span>
      </div>
      <Show when={props.plugin.description}>
        <p class="text-sm text-wopr-muted -mt-2">{props.plugin.description}</p>
      </Show>
      <div class="grid gap-4 md:grid-cols-2">
        <For each={panels()}>{(panel) => <PanelCard plugin={props.plugin} panel={panel} />}</For>
      </div>
    </div>
  );
};

// --- Main PluginPanels view: discovers and renders all manifest panels ---

const PluginPanels: Component = () => {
  const [manifests] = createResource(async () => {
    const data = await api.getPluginManifests();
    return data.manifests;
  });

  const pluginsWithPanels = () => (manifests() ?? []).filter((m) => m.webui?.panels && m.webui.panels.length > 0);

  return (
    <div class="max-w-5xl mx-auto p-6">
      <h1 class="text-2xl font-bold text-wopr-accent mb-6">Plugin Panels</h1>

      <Show when={!manifests.loading} fallback={<p class="text-wopr-muted">Loading plugins...</p>}>
        <Show when={manifests.error}>
          <div class="text-center py-12">
            <p class="text-red-400 text-lg mb-2">Failed to load plugins</p>
            <p class="text-wopr-muted text-sm">
              {manifests.error instanceof Error ? manifests.error.message : "Unknown error"}
            </p>
          </div>
        </Show>
        <Show when={!manifests.error}>
          <Show
            when={pluginsWithPanels().length > 0}
            fallback={
              <div class="text-center py-12 text-wopr-muted">
                <p class="text-lg mb-2">No plugin panels available</p>
                <p class="text-sm">
                  Install plugins that declare a <code>webui</code> section in their manifest to see panels here.
                </p>
              </div>
            }
          >
            <div class="space-y-8">
              <For each={pluginsWithPanels()}>{(plugin) => <PluginSection plugin={plugin} />}</For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default PluginPanels;
