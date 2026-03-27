import { type Component, createSignal, For, onMount, Show } from "solid-js";
import { type AvailableSkill, api, type InstalledSkill } from "../lib/api.js";

const Skills: Component = () => {
	const [tab, setTab] = createSignal<"installed" | "available">("installed");
	const [installed, setInstalled] = createSignal<InstalledSkill[]>([]);
	const [available, setAvailable] = createSignal<AvailableSkill[]>([]);
	const [loading, setLoading] = createSignal(true);
	const [error, setError] = createSignal<string | null>(null);
	const [actionInProgress, setActionInProgress] = createSignal<string | null>(null);

	async function loadInstalled() {
		try {
			const data = await api.getSkills();
			setInstalled(data.skills);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setError(`Failed to load installed skills: ${msg}`);
		}
	}

	async function loadAvailable() {
		try {
			const data = await api.getAvailableSkills();
			setAvailable(data.skills);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setError(`Failed to load available skills: ${msg}`);
		}
	}

	onMount(async () => {
		setLoading(true);
		await Promise.all([loadInstalled(), loadAvailable()]);
		setLoading(false);
	});

	async function handleToggle(skill: InstalledSkill) {
		setActionInProgress(skill.id);
		setError(null);
		try {
			if (skill.enabled) {
				await api.disableSkill(skill.id);
			} else {
				await api.enableSkill(skill.id);
			}
			await loadInstalled();
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setError(`Failed to ${skill.enabled ? "disable" : "enable"} skill: ${msg}`);
		} finally {
			setActionInProgress(null);
		}
	}

	async function handleUninstall(skill: InstalledSkill) {
		if (!confirm(`Uninstall "${skill.name}"?`)) return;
		setActionInProgress(skill.id);
		setError(null);
		try {
			await api.uninstallSkill(skill.id);
			await Promise.all([loadInstalled(), loadAvailable()]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setError(`Failed to uninstall skill: ${msg}`);
		} finally {
			setActionInProgress(null);
		}
	}

	async function handleInstall(skill: AvailableSkill) {
		setActionInProgress(skill.id);
		setError(null);
		try {
			await api.installSkill(skill.id);
			await Promise.all([loadInstalled(), loadAvailable()]);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : "Unknown error";
			setError(`Failed to install skill: ${msg}`);
		} finally {
			setActionInProgress(null);
		}
	}

	return (
		<div class="max-w-4xl mx-auto p-6">
			<h1 class="text-2xl font-bold text-wopr-accent mb-6">Skills</h1>

			{/* Tabs */}
			<div class="flex gap-2 mb-6 border-b border-wopr-border pb-2">
				<button
					type="button"
					onClick={() => setTab("installed")}
					class={`px-4 py-2 rounded-t text-sm font-semibold transition-colors ${
						tab() === "installed" ? "bg-wopr-accent text-wopr-bg" : "text-wopr-muted hover:text-wopr-text"
					}`}
				>
					Installed
				</button>
				<button
					type="button"
					onClick={() => setTab("available")}
					class={`px-4 py-2 rounded-t text-sm font-semibold transition-colors ${
						tab() === "available" ? "bg-wopr-accent text-wopr-bg" : "text-wopr-muted hover:text-wopr-text"
					}`}
				>
					Available
				</button>
			</div>

			{/* Error banner */}
			<Show when={error()}>
				<div class="mb-4 p-3 rounded bg-red-500/20 text-red-500">{error()}</div>
			</Show>

			<Show when={loading()}>
				<div class="text-wopr-muted">Loading skills...</div>
			</Show>

			<Show when={!loading()}>
				{/* Installed tab */}
				<Show when={tab() === "installed"}>
					<Show
						when={installed().length > 0}
						fallback={<div class="text-wopr-muted">No skills installed. Browse the Available tab to find skills.</div>}
					>
						<div class="space-y-3">
							<For each={installed()}>
								{(skill) => (
									<div class="bg-wopr-panel border border-wopr-border rounded-lg p-4 flex items-center justify-between">
										<div class="flex-1 min-w-0">
											<div class="flex items-center gap-2">
												<span class="font-semibold text-wopr-text">{skill.name}</span>
												<Show when={skill.version}>
													<span class="text-xs text-wopr-muted">v{skill.version}</span>
												</Show>
												<span
													class={`text-xs px-2 py-0.5 rounded ${
														skill.enabled ? "bg-green-500/20 text-green-500" : "bg-wopr-border text-wopr-muted"
													}`}
												>
													{skill.enabled ? "enabled" : "disabled"}
												</span>
											</div>
											<p class="text-sm text-wopr-muted mt-1 truncate">{skill.description}</p>
										</div>
										<div class="flex items-center gap-2 ml-4 shrink-0">
											<button
												type="button"
												onClick={() => handleToggle(skill)}
												disabled={actionInProgress() === skill.id}
												class={`px-3 py-1 rounded text-sm transition-colors ${
													skill.enabled
														? "bg-wopr-border text-wopr-text hover:bg-wopr-muted"
														: "bg-wopr-accent/20 text-wopr-accent hover:bg-wopr-accent/30"
												} disabled:opacity-50`}
											>
												{actionInProgress() === skill.id ? "..." : skill.enabled ? "Disable" : "Enable"}
											</button>
											<button
												type="button"
												onClick={() => handleUninstall(skill)}
												disabled={actionInProgress() === skill.id}
												class="px-3 py-1 rounded text-sm bg-red-500/20 text-red-500 hover:bg-red-500/30 disabled:opacity-50"
											>
												{actionInProgress() === skill.id ? "..." : "Uninstall"}
											</button>
										</div>
									</div>
								)}
							</For>
						</div>
					</Show>
				</Show>

				{/* Available tab */}
				<Show when={tab() === "available"}>
					<Show
						when={available().length > 0}
						fallback={<div class="text-wopr-muted">No additional skills available.</div>}
					>
						<div class="space-y-3">
							<For each={available()}>
								{(skill) => (
									<div class="bg-wopr-panel border border-wopr-border rounded-lg p-4 flex items-center justify-between">
										<div class="flex-1 min-w-0">
											<div class="flex items-center gap-2">
												<span class="font-semibold text-wopr-text">{skill.name}</span>
												<Show when={skill.version}>
													<span class="text-xs text-wopr-muted">v{skill.version}</span>
												</Show>
												<Show when={skill.category}>
													<span class="text-xs px-2 py-0.5 rounded bg-wopr-border text-wopr-muted">
														{skill.category}
													</span>
												</Show>
											</div>
											<p class="text-sm text-wopr-muted mt-1 truncate">{skill.description}</p>
										</div>
										<div class="ml-4 shrink-0">
											<button
												type="button"
												onClick={() => handleInstall(skill)}
												disabled={actionInProgress() === skill.id}
												class="px-4 py-1 rounded text-sm font-semibold bg-wopr-accent text-wopr-bg hover:bg-wopr-accent/90 disabled:opacity-50"
											>
												{actionInProgress() === skill.id ? "Installing..." : "Install"}
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

export default Skills;
