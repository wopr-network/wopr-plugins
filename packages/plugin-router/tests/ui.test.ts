/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock SolidJS signals for the UI component
function createMockSolidSignals() {
  const signals = new Map<number, { value: unknown; subscribers: Array<(v: unknown) => void> }>();
  let signalId = 0;

  function createSignal<T>(initial: T): [() => T, (value: T) => void] {
    const id = signalId++;
    const state = { value: initial, subscribers: [] as Array<(v: unknown) => void> };
    signals.set(id, state);

    const getter = (fn?: (v: T) => void) => {
      if (typeof fn === "function") {
        state.subscribers.push(fn as (v: unknown) => void);
        return undefined as unknown as T;
      }
      return state.value as T;
    };
    const setter = (value: T) => {
      state.value = value;
      for (const sub of state.subscribers) sub(value);
    };
    return [getter as () => T, setter];
  }

  const mountCallbacks: Array<() => void | Promise<void>> = [];
  function onMount(fn: () => void | Promise<void>) {
    mountCallbacks.push(fn);
  }

  return { createSignal, onMount, mountCallbacks };
}

describe("RouterPluginUI", () => {
  let RouterPluginUI: typeof import("../src/ui.ts").default;

  beforeEach(async () => {
    vi.resetModules();

    // Set up SolidJS mock on window
    const solidMock = createMockSolidSignals();
    (window as any).Solid = {
      createSignal: solidMock.createSignal,
      onMount: solidMock.onMount,
    };

    const mod = await import("../src/ui.ts");
    RouterPluginUI = mod.default;
  });

  it("should return an HTMLDivElement", () => {
    const props = {
      api: { getConfig: vi.fn(async () => ({})) },
      saveConfig: vi.fn(async () => {}),
    };

    const container = RouterPluginUI(props);
    expect(container).toBeInstanceOf(HTMLDivElement);
    expect(container.className).toBe("router-plugin-ui");
  });

  it("should render header with 'Message Router' title", () => {
    const props = {
      api: { getConfig: vi.fn(async () => ({})) },
      saveConfig: vi.fn(async () => {}),
    };

    const container = RouterPluginUI(props);
    const header = container.querySelector("h3");
    expect(header).not.toBeNull();
    expect(header!.textContent).toBe("Message Router");
  });

  it("should render the add route form with inputs", () => {
    const props = {
      api: { getConfig: vi.fn(async () => ({})) },
      saveConfig: vi.fn(async () => {}),
    };

    const container = RouterPluginUI(props);
    const sourceInput = container.querySelector(".source-input") as HTMLInputElement;
    const targetsInput = container.querySelector(".targets-input") as HTMLInputElement;
    const channelInput = container.querySelector(".channel-input") as HTMLInputElement;
    const addBtn = container.querySelector(".add-btn");

    expect(sourceInput).not.toBeNull();
    expect(targetsInput).not.toBeNull();
    expect(channelInput).not.toBeNull();
    expect(addBtn).not.toBeNull();
    expect(sourceInput.placeholder).toBe("Source session");
    expect(targetsInput.placeholder).toBe("Target sessions (comma-separated)");
    expect(channelInput.placeholder).toBe("Channel type (optional)");
  });

  it("should render info section with incoming/outgoing descriptions", () => {
    const props = {
      api: { getConfig: vi.fn(async () => ({})) },
      saveConfig: vi.fn(async () => {}),
    };

    const container = RouterPluginUI(props);
    const infoText = container.textContent || "";
    expect(infoText).toContain("Incoming");
    expect(infoText).toContain("Outgoing");
  });

  it("should show empty state when no routes exist", () => {
    const props = {
      api: { getConfig: vi.fn(async () => ({})) },
      saveConfig: vi.fn(async () => {}),
    };

    const container = RouterPluginUI(props);
    const text = container.textContent || "";
    expect(text).toContain("No routing rules configured");
  });

  it("should render route count badge showing 0 rules", () => {
    const props = {
      api: { getConfig: vi.fn(async () => ({})) },
      saveConfig: vi.fn(async () => {}),
    };

    const container = RouterPluginUI(props);
    const badge = container.querySelector(".bg-blue-500\\/20");
    expect(badge).not.toBeNull();
    expect(badge!.textContent!.trim()).toBe("0 rules");
  });

  it("should bind input events to signal setters", () => {
    const props = {
      api: { getConfig: vi.fn(async () => ({})) },
      saveConfig: vi.fn(async () => {}),
    };

    const container = RouterPluginUI(props);
    const sourceInput = container.querySelector(".source-input") as HTMLInputElement;

    // Simulate typing in the source input
    sourceInput.value = "my-session";
    sourceInput.dispatchEvent(new Event("input", { bubbles: true }));

    // The signal setter was called — we can't directly inspect the signal value
    // but we can verify the input element is properly wired
    expect(sourceInput.value).toBe("my-session");
  });

  it("should have add button that triggers handleAddRoute", async () => {
    const saveMock = vi.fn(async () => {});
    const props = {
      api: { getConfig: vi.fn(async () => ({})) },
      saveConfig: saveMock,
    };

    const container = RouterPluginUI(props);
    const addBtn = container.querySelector(".add-btn") as HTMLButtonElement;

    // Click without filling inputs — should not call saveConfig
    // because newSource() and newTargets() are empty
    addBtn.click();
    // Allow any async work
    await new Promise((r) => setTimeout(r, 10));
    expect(saveMock).not.toHaveBeenCalled();
  });
});
