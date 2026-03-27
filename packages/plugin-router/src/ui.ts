/**
 * Router Plugin UI Component for WOPR
 *
 * SolidJS component for managing message routing rules.
 */

declare const Solid: {
	createSignal: <T>(initial: T) => [{ (): T; (fn: (value: T) => void): void }, (value: T) => void];
	onMount: (fn: () => void | Promise<void>) => void;
};

interface Route {
	sourceSession: string;
	targetSessions: string[];
	channelType?: string;
}

interface RouterConfig {
	routes?: Route[];
	outgoingRoutes?: Route[];
}

interface PluginConfig {
	plugins?: {
		data?: {
			router?: RouterConfig;
		};
	};
}

interface RouterPluginProps {
	api: {
		getConfig(): Promise<PluginConfig>;
	};
	saveConfig(config: RouterConfig): Promise<void>;
}

const { createSignal, onMount } = (window as unknown as { Solid: typeof Solid }).Solid || Solid;

export default function RouterPluginUI(props: RouterPluginProps): HTMLDivElement {
	const [routes, setRoutes] = createSignal<Route[]>([]);
	const [outgoingRoutes, setOutgoingRoutes] = createSignal<Route[]>([]);
	const [newSource, setNewSource] = createSignal("");
	const [newTargets, setNewTargets] = createSignal("");
	const [newChannelType, setNewChannelType] = createSignal("");

	onMount(async () => {
		const config = await props.api.getConfig();
		const routerConfig = config.plugins?.data?.router || {};
		setRoutes(routerConfig.routes || []);
		setOutgoingRoutes(routerConfig.outgoingRoutes || []);
	});

	const handleAddRoute = async (): Promise<void> => {
		if (!newSource() || !newTargets()) return;

		const newRoute: Route = {
			sourceSession: newSource(),
			targetSessions: newTargets()
				.split(",")
				.map((s) => s.trim())
				.filter(Boolean),
			channelType: newChannelType() || undefined,
		};

		const updatedRoutes = [...routes(), newRoute];
		await props.saveConfig({
			routes: updatedRoutes,
			outgoingRoutes: outgoingRoutes(),
		});

		setRoutes(updatedRoutes);
		setNewSource("");
		setNewTargets("");
		setNewChannelType("");
	};

	const handleDeleteRoute = async (index: number): Promise<void> => {
		const updatedRoutes = routes().filter((_, i) => i !== index);
		await props.saveConfig({
			routes: updatedRoutes,
			outgoingRoutes: outgoingRoutes(),
		});
		setRoutes(updatedRoutes);
	};

	// Create DOM
	const container = document.createElement("div");
	container.className = "router-plugin-ui";

	// Header
	const header = document.createElement("div");
	header.className = "flex items-center justify-between mb-4";
	header.innerHTML = `
    <h3 class="text-lg font-semibold">Message Router</h3>
    <span class="px-2 py-1 rounded text-xs bg-blue-500/20 text-blue-400">
      ${routes().length} rules
    </span>
  `;
	container.appendChild(header);

	// Routes list
	const routesSection = document.createElement("div");
	routesSection.className = "mb-4";

	const updateRoutesList = (): void => {
		routesSection.innerHTML = "";

		if (routes().length === 0) {
			routesSection.innerHTML = `
        <div class="text-sm text-wopr-muted p-3 bg-wopr-panel rounded border border-wopr-border">
          No routing rules configured. Messages will not be forwarded.
        </div>
      `;
		} else {
			routes().forEach((route, index) => {
				const item = document.createElement("div");
				item.className = "p-3 bg-wopr-panel rounded border border-wopr-border flex items-center justify-between mb-2";

				const detailDiv = document.createElement("div");

				const titleDiv = document.createElement("div");
				titleDiv.className = "font-medium";
				titleDiv.textContent = `${route.sourceSession} → ${route.targetSessions.join(", ")}`;
				detailDiv.appendChild(titleDiv);

				if (route.channelType) {
					const channelDiv = document.createElement("div");
					channelDiv.className = "text-sm text-wopr-muted";
					channelDiv.textContent = `Channel: ${route.channelType}`;
					detailDiv.appendChild(channelDiv);
				}

				const deleteBtn = document.createElement("button");
				deleteBtn.className = "delete-route px-3 py-1 bg-red-500/20 text-red-400 rounded text-sm hover:bg-red-500/30";
				deleteBtn.textContent = "Delete";
				deleteBtn.addEventListener("click", () => handleDeleteRoute(index));

				item.appendChild(detailDiv);
				item.appendChild(deleteBtn);
				routesSection.appendChild(item);
			});
		}
	};

	// Initial render and reactive updates
	routes(updateRoutesList);
	updateRoutesList();

	container.appendChild(routesSection);

	// Add route form
	const formSection = document.createElement("div");
	formSection.className = "p-3 bg-wopr-panel rounded border border-wopr-border";
	formSection.innerHTML = `
    <h4 class="text-sm font-semibold text-wopr-muted uppercase mb-3">Add Route</h4>
    <div class="space-y-2">
      <input type="text" placeholder="Source session" class="source-input w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 text-sm" />
      <input type="text" placeholder="Target sessions (comma-separated)" class="targets-input w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 text-sm" />
      <input type="text" placeholder="Channel type (optional)" class="channel-input w-full bg-wopr-bg border border-wopr-border rounded px-3 py-2 text-sm" />
      <button class="add-btn w-full px-4 py-2 bg-wopr-accent text-wopr-bg rounded text-sm font-medium hover:bg-wopr-accent/90">
        Add Route
      </button>
    </div>
  `;

	// Bind inputs
	const sourceInput = formSection.querySelector(".source-input") as HTMLInputElement;
	const targetsInput = formSection.querySelector(".targets-input") as HTMLInputElement;
	const channelInput = formSection.querySelector(".channel-input") as HTMLInputElement;

	sourceInput.addEventListener("input", (e) => setNewSource((e.target as HTMLInputElement).value));
	targetsInput.addEventListener("input", (e) => setNewTargets((e.target as HTMLInputElement).value));
	channelInput.addEventListener("input", (e) => setNewChannelType((e.target as HTMLInputElement).value));

	const addBtn = formSection.querySelector(".add-btn");
	if (addBtn) {
		addBtn.addEventListener("click", handleAddRoute);
	}

	container.appendChild(formSection);

	// Info section
	const infoSection = document.createElement("div");
	infoSection.className = "mt-4 p-3 bg-wopr-panel/50 rounded border border-wopr-border text-sm text-wopr-muted";
	infoSection.innerHTML = `
    <p class="mb-1"><strong>Incoming:</strong> Messages to source session are forwarded to targets.</p>
    <p><strong>Outgoing:</strong> Responses are sent back to originating channel.</p>
  `;
	container.appendChild(infoSection);

	return container;
}
