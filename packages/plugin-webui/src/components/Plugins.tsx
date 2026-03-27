import { type Component, createMemo, createSignal, For, onMount, Show } from "solid-js";
import {
  type AvailablePlugin,
  api,
  type ConfigSchemaField,
  type InstalledPlugin,
  type PluginCategory,
} from "../lib/api.js";

type Tab = "installed" | "available";

const CATEGORY_LABELS: Record<PluginCategory, string> = {
  channel: "Channel",
  provider: "Provider",
  voice: "Voice",
  memory: "Memory",
  utility: "Utility",
};

const Plugins: Component = () => {
  const [tab, setTab] = createSignal<Tab>("installed");
  const [installed, setInstalled] = createSignal<InstalledPlugin[]>([]);
  const [available, setAvailable] = createSignal<AvailablePlugin[]>([]);
  const [loading, setLoading] = createSignal(true);
  const [error, setError] = createSignal<string | null>(null);
  const [installing, setInstalling] = createSignal<string | null>(null);
  const [uninstalling, setUninstalling] = createSignal<string | null>(null);
  const [toggling, setToggling] = createSignal<string | null>(null);
  const [categoryFilter, setCategoryFilter] = createSignal<PluginCategory | "all">("all");

  // Config panel state
  const [configPluginId, setConfigPluginId] = createSignal<string | null>(null);
  const [configSchema, setConfigSchema] = createSignal<Record<string, ConfigSchemaField> | null>(null);
  const [configValues, setConfigValues] = createSignal<Record<string, unknown>>({});
  const [savingConfig, setSavingConfig] = createSignal(false);
  const [configMessage, setConfigMessage] = createSignal<string | null>(null);

  // Detail panel for available plugins
  const [detailPlugin, setDetailPlugin] = createSignal<AvailablePlugin | null>(null);

  async function loadInstalled() {
    try {
      const data = await api.getPlugins();
      setInstalled(data.plugins);
    } catch (err: any) {
      setError(err.message);
    }
  }

  async function loadAvailable() {
    try {
      const data = await api.getAvailablePlugins();
      setAvailable(data.plugins);
    } catch (err: any) {
      setError(err.message);
    }
  }

  onMount(async () => {
    setLoading(true);
    await Promise.all([loadInstalled(), loadAvailable()]);
    setLoading(false);
  });

  const filteredAvailable = createMemo(() => {
    const filter = categoryFilter();
    const plugins = available();
    if (filter === "all") return plugins;
    return plugins.filter((p) => p.category === filter);
  });

  const availableCategories = createMemo(() => {
    const cats = new Set<PluginCategory>();
    for (const p of available()) {
      if (p.category) cats.add(p.category);
    }
    return Array.from(cats).sort();
  });

  // Check if an available plugin is already installed
  function isInstalled(name: string): boolean {
    return installed().some((p) => p.name === name);
  }

  async function handleInstall(name: string) {
    setInstalling(name);
    setError(null);
    try {
      await api.installPlugin(name);
      await loadInstalled();
      await loadAvailable();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setInstalling(null);
    }
  }

  async function handleUninstall(plugin: InstalledPlugin) {
    if (!confirm(`Uninstall ${plugin.name}? This cannot be undone.`)) return;
    setUninstalling(plugin.id);
    setError(null);
    try {
      await api.uninstallPlugin(plugin.id);
      // Close config if viewing this plugin
      if (configPluginId() === plugin.id) {
        setConfigPluginId(null);
        setConfigSchema(null);
      }
      await loadInstalled();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setUninstalling(null);
    }
  }

  async function handleToggle(plugin: InstalledPlugin) {
    setToggling(plugin.id);
    setError(null);
    try {
      if (plugin.enabled) {
        await api.disablePlugin(plugin.id);
      } else {
        await api.enablePlugin(plugin.id);
      }
      await loadInstalled();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setToggling(null);
    }
  }

  async function openConfig(plugin: InstalledPlugin) {
    setConfigPluginId(plugin.id);
    setConfigSchema(plugin.configSchema || null);
    setConfigMessage(null);
    try {
      const values = await api.getPluginConfig(plugin.id);
      setConfigValues(values);
    } catch {
      setConfigValues({});
    }
  }

  function closeConfig() {
    setConfigPluginId(null);
    setConfigSchema(null);
    setConfigValues({});
    setConfigMessage(null);
  }

  async function saveConfig() {
    const id = configPluginId();
    if (!id) return;
    setSavingConfig(true);
    setConfigMessage(null);
    try {
      await api.updatePluginConfig(id, configValues());
      setConfigMessage("Configuration saved!");
      setTimeout(() => setConfigMessage(null), 3000);
    } catch (err: any) {
      setConfigMessage(`Error: ${err.message}`);
    } finally {
      setSavingConfig(false);
    }
  }

  function updateConfigValue(key: string, value: unknown) {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  }

  return (
    <div class="max-w-5xl mx-auto p-6">
      <div class="flex items-center justify-between mb-6">
        <h1 class="text-2xl font-bold text-wopr-accent">Plugins</h1>
        <div class="flex gap-2">
          <button
            onClick={() => {
              setTab("installed");
              closeConfig();
              setDetailPlugin(null);
            }}
            class={`px-4 py-2 rounded text-sm ${
              tab() === "installed" ? "bg-wopr-accent text-wopr-bg" : "text-wopr-muted hover:text-wopr-text"
            }`}
          >
            Installed ({installed().length})
          </button>
          <button
            onClick={() => {
              setTab("available");
              closeConfig();
              setDetailPlugin(null);
            }}
            class={`px-4 py-2 rounded text-sm ${
              tab() === "available" ? "bg-wopr-accent text-wopr-bg" : "text-wopr-muted hover:text-wopr-text"
            }`}
          >
            Available
          </button>
        </div>
      </div>

      {/* Error banner */}
      <Show when={error()}>
        <div class="mb-4 p-3 rounded bg-red-500/20 text-red-500">{error()}</div>
      </Show>

      <Show when={loading()}>
        <div class="text-wopr-muted">Loading plugins...</div>
      </Show>

      <Show when={!loading()}>
        {/* Config Panel Overlay */}
        <Show when={configPluginId()}>
          <div class="mb-6 bg-wopr-panel border border-wopr-border rounded-lg p-4">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-semibold text-wopr-accent">
                Configure: {installed().find((p) => p.id === configPluginId())?.name}
              </h2>
              <button onClick={closeConfig} class="text-wopr-muted hover:text-wopr-text text-sm">
                Close
              </button>
            </div>

            <Show when={configMessage()}>
              <div
                class={`mb-4 p-3 rounded ${
                  configMessage()?.startsWith("Error") ? "bg-red-500/20 text-red-500" : "bg-green-500/20 text-green-500"
                }`}
              >
                {configMessage()}
              </div>
            </Show>

            <Show
              when={configSchema() && Object.keys(configSchema()!).length > 0}
              fallback={<div class="text-wopr-muted text-sm">No configuration options available for this plugin.</div>}
            >
              <div class="space-y-4">
                <For each={Object.entries(configSchema()!)}>
                  {([key, field]) => (
                    <div>
                      <label class="block text-sm text-wopr-muted mb-1">
                        {field.label}
                        {field.required && <span class="text-red-500 ml-1">*</span>}
                      </label>
                      <Show when={field.description}>
                        <p class="text-xs text-wopr-muted/70 mb-1">{field.description}</p>
                      </Show>

                      {field.type === "boolean" ? (
                        <div class="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={!!(configValues()[key] ?? field.default ?? false)}
                            onChange={(e) => updateConfigValue(key, e.currentTarget.checked)}
                            class="rounded border-wopr-border"
                          />
                          <span class="text-sm text-wopr-text">{field.label}</span>
                        </div>
                      ) : field.type === "select" ? (
                        <select
                          value={(configValues()[key] ?? field.default ?? "") as string}
                          onChange={(e) => updateConfigValue(key, e.currentTarget.value)}
                          class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                        >
                          <For each={field.options || []}>
                            {(opt) => <option value={opt.value}>{opt.label}</option>}
                          </For>
                        </select>
                      ) : field.type === "number" ? (
                        <input
                          type="number"
                          value={Number(configValues()[key] ?? field.default ?? 0)}
                          onInput={(e) => updateConfigValue(key, Number.parseFloat(e.currentTarget.value) || 0)}
                          class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                        />
                      ) : (
                        <input
                          type="text"
                          value={String(configValues()[key] ?? field.default ?? "")}
                          onInput={(e) => updateConfigValue(key, e.currentTarget.value)}
                          class="w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 focus:outline-none focus:border-wopr-accent"
                        />
                      )}
                    </div>
                  )}
                </For>

                <div class="flex justify-end pt-2">
                  <button
                    onClick={saveConfig}
                    disabled={savingConfig()}
                    class="px-4 py-2 bg-wopr-accent text-wopr-bg rounded font-semibold hover:bg-wopr-accent/90 disabled:opacity-50"
                  >
                    {savingConfig() ? "Saving..." : "Save Config"}
                  </button>
                </div>
              </div>
            </Show>
          </div>
        </Show>

        {/* Detail Panel for Available Plugins */}
        <Show when={detailPlugin()}>
          <div class="mb-6 bg-wopr-panel border border-wopr-border rounded-lg p-4">
            <div class="flex items-center justify-between mb-4">
              <h2 class="text-lg font-semibold text-wopr-accent">{detailPlugin()?.name}</h2>
              <button onClick={() => setDetailPlugin(null)} class="text-wopr-muted hover:text-wopr-text text-sm">
                Close
              </button>
            </div>

            <p class="text-wopr-text text-sm mb-3">{detailPlugin()?.description}</p>

            <div class="grid grid-cols-2 gap-4 text-sm mb-4">
              <div>
                <span class="text-wopr-muted">Version:</span>{" "}
                <span class="text-wopr-text">{detailPlugin()?.version}</span>
              </div>
              <Show when={detailPlugin()?.category}>
                <div>
                  <span class="text-wopr-muted">Category:</span>{" "}
                  <span class="text-wopr-text">
                    {CATEGORY_LABELS[detailPlugin()?.category ?? ""] ?? detailPlugin()?.category}
                  </span>
                </div>
              </Show>
            </div>

            <Show when={detailPlugin()?.requirements && detailPlugin()?.requirements?.length > 0}>
              <div class="mb-3">
                <h3 class="text-sm font-semibold text-wopr-muted mb-1">Requirements</h3>
                <ul class="list-disc list-inside text-sm text-wopr-text">
                  <For each={detailPlugin()?.requirements ?? []}>{(req) => <li>{req}</li>}</For>
                </ul>
              </div>
            </Show>

            <Show when={detailPlugin()?.setupSteps && detailPlugin()?.setupSteps?.length > 0}>
              <div class="mb-3">
                <h3 class="text-sm font-semibold text-wopr-muted mb-1">Setup Steps</h3>
                <ol class="list-decimal list-inside text-sm text-wopr-text">
                  <For each={detailPlugin()?.setupSteps ?? []}>{(step) => <li>{step}</li>}</For>
                </ol>
              </div>
            </Show>

            <Show when={detailPlugin()?.configSchema}>
              <div class="mb-3">
                <h3 class="text-sm font-semibold text-wopr-muted mb-1">Configuration Fields</h3>
                <div class="space-y-1">
                  <For each={Object.entries(detailPlugin()?.configSchema ?? {})}>
                    {([key, field]) => (
                      <div class="text-sm text-wopr-text">
                        <span class="text-wopr-accent font-mono">{key}</span>
                        <span class="text-wopr-muted"> ({field.type})</span>
                        {field.required && <span class="text-red-500 ml-1">*</span>}
                        <Show when={field.description}>
                          <span class="text-wopr-muted"> - {field.description}</span>
                        </Show>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <div class="flex justify-end pt-2">
              <button
                onClick={() => {
                  handleInstall(detailPlugin()?.name);
                  setDetailPlugin(null);
                }}
                disabled={isInstalled(detailPlugin()?.name) || !!installing()}
                class="px-4 py-2 bg-wopr-accent text-wopr-bg rounded font-semibold hover:bg-wopr-accent/90 disabled:opacity-50"
              >
                {isInstalled(detailPlugin()?.name) ? "Installed" : "Install"}
              </button>
            </div>
          </div>
        </Show>

        {/* Installed Plugins Tab */}
        <Show when={tab() === "installed"}>
          <Show
            when={installed().length > 0}
            fallback={
              <div class="text-center text-wopr-muted py-12">
                No plugins installed. Browse the
                <button onClick={() => setTab("available")} class="text-wopr-accent hover:underline ml-1">
                  Available
                </button>{" "}
                tab to install plugins.
              </div>
            }
          >
            <div class="space-y-3">
              <For each={installed()}>
                {(plugin) => (
                  <div class="bg-wopr-panel border border-wopr-border rounded-lg p-4 flex items-center justify-between">
                    <div class="flex items-center gap-3 flex-1 min-w-0">
                      {/* Health indicator */}
                      <span
                        class={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${
                          plugin.healthy ? "bg-green-500" : "bg-red-500"
                        }`}
                        title={plugin.healthy ? "Healthy" : "Unhealthy"}
                      />

                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="font-semibold text-wopr-text truncate">{plugin.name}</span>
                          <span class="text-xs text-wopr-muted">v{plugin.version}</span>
                          <Show when={plugin.updateAvailable}>
                            <span class="text-xs bg-wopr-accent/20 text-wopr-accent px-1.5 py-0.5 rounded">
                              Update: v{plugin.updateAvailable}
                            </span>
                          </Show>
                          <Show when={plugin.category}>
                            <span class="text-xs bg-wopr-border text-wopr-muted px-1.5 py-0.5 rounded">
                              {CATEGORY_LABELS[plugin.category!] ?? plugin.category}
                            </span>
                          </Show>
                        </div>
                        <Show when={plugin.description}>
                          <p class="text-sm text-wopr-muted truncate">{plugin.description}</p>
                        </Show>
                      </div>
                    </div>

                    <div class="flex items-center gap-2 flex-shrink-0 ml-4">
                      {/* Enable/Disable toggle */}
                      <button
                        onClick={() => handleToggle(plugin)}
                        disabled={toggling() === plugin.id}
                        class={`px-3 py-1 rounded text-xs font-semibold ${
                          plugin.enabled
                            ? "bg-green-500/20 text-green-500 hover:bg-green-500/30"
                            : "bg-wopr-border text-wopr-muted hover:bg-wopr-border/80"
                        } disabled:opacity-50`}
                        title={plugin.enabled ? "Click to disable" : "Click to enable"}
                      >
                        {toggling() === plugin.id ? "..." : plugin.enabled ? "Enabled" : "Disabled"}
                      </button>

                      {/* Configure button */}
                      <button
                        onClick={() => openConfig(plugin)}
                        class="px-3 py-1 rounded text-xs text-wopr-muted hover:text-wopr-text bg-wopr-border hover:bg-wopr-border/80"
                      >
                        Configure
                      </button>

                      {/* Uninstall button */}
                      <button
                        onClick={() => handleUninstall(plugin)}
                        disabled={uninstalling() === plugin.id}
                        class="px-3 py-1 rounded text-xs text-red-500 hover:bg-red-500/20 disabled:opacity-50"
                      >
                        {uninstalling() === plugin.id ? "..." : "Uninstall"}
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>

        {/* Available Plugins Tab */}
        <Show when={tab() === "available"}>
          {/* Category filter */}
          <Show when={availableCategories().length > 0}>
            <div class="flex gap-2 mb-4 flex-wrap">
              <button
                onClick={() => setCategoryFilter("all")}
                class={`px-3 py-1 rounded text-xs ${
                  categoryFilter() === "all"
                    ? "bg-wopr-accent text-wopr-bg"
                    : "bg-wopr-border text-wopr-muted hover:text-wopr-text"
                }`}
              >
                All
              </button>
              <For each={availableCategories()}>
                {(cat) => (
                  <button
                    onClick={() => setCategoryFilter(cat)}
                    class={`px-3 py-1 rounded text-xs ${
                      categoryFilter() === cat
                        ? "bg-wopr-accent text-wopr-bg"
                        : "bg-wopr-border text-wopr-muted hover:text-wopr-text"
                    }`}
                  >
                    {CATEGORY_LABELS[cat] ?? cat}
                  </button>
                )}
              </For>
            </div>
          </Show>

          <Show
            when={filteredAvailable().length > 0}
            fallback={<div class="text-center text-wopr-muted py-12">No available plugins found.</div>}
          >
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <For each={filteredAvailable()}>
                {(plugin) => (
                  <div class="bg-wopr-panel border border-wopr-border rounded-lg p-4 flex flex-col">
                    <div class="flex items-start justify-between mb-2">
                      <div class="min-w-0">
                        <div class="flex items-center gap-2">
                          <span class="font-semibold text-wopr-text truncate">{plugin.name}</span>
                          <span class="text-xs text-wopr-muted">v{plugin.version}</span>
                        </div>
                        <Show when={plugin.category}>
                          <span class="text-xs bg-wopr-border text-wopr-muted px-1.5 py-0.5 rounded inline-block mt-1">
                            {CATEGORY_LABELS[plugin.category!] ?? plugin.category}
                          </span>
                        </Show>
                      </div>
                    </div>

                    <p class="text-sm text-wopr-muted mb-3 flex-1">{plugin.description}</p>

                    <div class="flex items-center justify-between">
                      <button onClick={() => setDetailPlugin(plugin)} class="text-xs text-wopr-accent hover:underline">
                        Details
                      </button>
                      <button
                        onClick={() => handleInstall(plugin.name)}
                        disabled={isInstalled(plugin.name) || installing() === plugin.name}
                        class="px-4 py-1.5 rounded text-xs font-semibold bg-wopr-accent text-wopr-bg hover:bg-wopr-accent/90 disabled:opacity-50"
                      >
                        {installing() === plugin.name
                          ? "Installing..."
                          : isInstalled(plugin.name)
                            ? "Installed"
                            : "Install"}
                      </button>
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </Show>
      </Show>
    </div>
  );
};

export default Plugins;
