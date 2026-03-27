/**
 * Browser A2A tools: browser_navigate, browser_click, browser_type,
 * browser_screenshot, browser_evaluate
 *
 * Uses Playwright for browser automation with CDP control.
 * Browser profiles persist cookies/sessions across invocations.
 */

import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { A2AServerConfig, A2AToolResult, PluginLogger } from "@wopr-network/plugin-types";
import { loadProfile, saveProfile } from "./browser-profile.js";

// ---------------------------------------------------------------------------
// Configuration constants
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_EVALUATE_RESULT_LENGTH = 10_000;
const MAX_PAGE_CONTENT_LENGTH = 15_000;

// ---------------------------------------------------------------------------
// SSRF protection: URL validation
// ---------------------------------------------------------------------------

export function isUrlSafe(rawUrl: string): { safe: boolean; reason?: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { safe: false, reason: "Invalid URL" };
  }

  const scheme = parsed.protocol.toLowerCase();
  if (scheme !== "http:" && scheme !== "https:") {
    return { safe: false, reason: `Blocked URL scheme: ${scheme}` };
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, "");
  if (isPrivateHost(hostname)) {
    return { safe: false, reason: `Blocked private/internal address: ${hostname}` };
  }

  return { safe: true };
}

function isPrivateHost(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "localhost.") {
    return true;
  }

  const ipv4 = parseIPv4(hostname);
  if (ipv4) {
    return isPrivateIPv4(ipv4);
  }

  const ipv6 = parseIPv6(hostname);
  if (ipv6) {
    return isPrivateIPv6(ipv6);
  }

  return false;
}

function parseIPv4(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => Number.isNaN(n) || n < 0 || n > 255 || !Number.isInteger(n))) return null;
  return nums;
}

function isPrivateIPv4(octets: number[]): boolean {
  const [a, b] = octets;
  if (a === 127) return true;
  if (a === 10) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 169 && b === 254) return true;
  if (octets.every((o) => o === 0)) return true;
  return false;
}

function parseIPv6(host: string): string | null {
  if (!host.includes(":")) return null;
  try {
    const u = new URL(`http://[${host}]`);
    return u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  } catch {
    return null;
  }
}

function isPrivateIPv6(normalized: string): boolean {
  if (normalized === "::1") return true;
  if (normalized === "::") return true;
  if (normalized.startsWith("fe80:") || normalized.startsWith("fe80")) return true;
  if (normalized.startsWith("fd")) return true;
  if (normalized.startsWith("fc")) return true;

  const v4MappedMatch = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (v4MappedMatch) {
    const ipv4 = parseIPv4(v4MappedMatch[1]);
    if (ipv4 && isPrivateIPv4(ipv4)) return true;
  }

  const v4HexMatch = normalized.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (v4HexMatch) {
    const hi = parseInt(v4HexMatch[1], 16);
    const lo = parseInt(v4HexMatch[2], 16);
    const octets = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff];
    if (isPrivateIPv4(octets)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Lazy Playwright loading
// ---------------------------------------------------------------------------

// biome-ignore lint/suspicious/noExplicitAny: Playwright types loaded dynamically
let pw: any = null;

// biome-ignore lint/suspicious/noExplicitAny: Playwright types loaded dynamically
async function getPlaywright(): Promise<any> {
  if (pw) return pw;
  try {
    const moduleName = "playwright";
    pw = await import(/* webpackIgnore: true */ moduleName);
    return pw;
  } catch {
    throw new Error("Playwright is not installed. Install it with: npm install playwright");
  }
}

// ---------------------------------------------------------------------------
// Browser instance cache (keyed by profile name)
// ---------------------------------------------------------------------------

interface BrowserInstance {
  // biome-ignore lint/suspicious/noExplicitAny: Playwright types unavailable (dynamic import)
  browser: any;
  // biome-ignore lint/suspicious/noExplicitAny: Playwright types unavailable (dynamic import)
  context: any;
  // biome-ignore lint/suspicious/noExplicitAny: Playwright types unavailable (dynamic import)
  page: any;
  profileName: string;
}

const instances = new Map<string, BrowserInstance>();

const CLEANUP_SYMBOL = Symbol.for("wopr-browser-plugin-cleanup");
function ensureProcessCleanup(): void {
  if ((process as unknown as Record<symbol, boolean>)[CLEANUP_SYMBOL]) return;
  (process as unknown as Record<symbol, boolean>)[CLEANUP_SYMBOL] = true;
  const cleanup = () => {
    for (const [, instance] of instances) {
      try {
        const proc = instance.browser.process?.();
        if (proc && !proc.killed) {
          proc.kill("SIGKILL");
        }
      } catch {
        // Best-effort
      }
      try {
        instance.browser.close();
      } catch {
        // Best-effort
      }
    }
    instances.clear();
  };
  process.on("exit", cleanup);
  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
}

async function getOrCreateInstance(profileName: string, headless: boolean): Promise<BrowserInstance> {
  const existing = instances.get(profileName);
  if (existing) {
    try {
      if (existing.browser.isConnected()) {
        return existing;
      }
    } catch {
      instances.delete(profileName);
    }
  }

  ensureProcessCleanup();

  const playwright = await getPlaywright();
  const profile = await loadProfile(profileName);

  const browser = await playwright.chromium.launch({ headless });
  const context = await browser.newContext();

  if (profile.cookies.length > 0) {
    await context.addCookies(profile.cookies);
  }

  const page = await context.newPage();

  const instance: BrowserInstance = { browser, context, page, profileName };
  instances.set(profileName, instance);
  return instance;
}

async function persistProfile(instance: BrowserInstance, log: PluginLogger): Promise<void> {
  try {
    const cookies = await instance.context.cookies();
    const profile = await loadProfile(instance.profileName);
    profile.cookies = cookies;
    await saveProfile(profile);
  } catch (err) {
    log.warn(`[browser] Failed to persist profile "${instance.profileName}": ${err}`);
  }
}

// ---------------------------------------------------------------------------
// HTML-to-Markdown conversion (lightweight)
// ---------------------------------------------------------------------------

function htmlToMarkdown(html: string): string {
  let text = html.replace(/<script[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[\s\S]*?<\/style>/gi, "");

  text = text.replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "# $1\n\n");
  text = text.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "## $1\n\n");
  text = text.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "### $1\n\n");
  text = text.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "#### $1\n\n");
  text = text.replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "##### $1\n\n");
  text = text.replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "###### $1\n\n");

  text = text.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");

  text = text.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*\/?>/gi, "![$1]($2)");
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, "![$2]($1)");
  text = text.replace(/<img[^>]*src="([^"]*)"[^>]*\/?>/gi, "![]($1)");

  text = text.replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, "*$2*");
  text = text.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");

  text = text.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");

  text = text.replace(/<br\s*\/?>/gi, "\n");
  text = text.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "$1\n\n");
  text = text.replace(/<div[^>]*>([\s\S]*?)<\/div>/gi, "$1\n");

  text = text.replace(/<[^>]+>/g, "");

  text = text.replace(/&amp;/g, "&");
  text = text.replace(/&lt;/g, "<");
  text = text.replace(/&gt;/g, ">");
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  text = text.replace(/&nbsp;/g, " ");

  text = text.replace(/\n{3,}/g, "\n\n");
  text = text.trim();

  return text;
}

// ---------------------------------------------------------------------------
// Cleanup helper
// ---------------------------------------------------------------------------

export async function closeAllBrowsers(log: PluginLogger): Promise<void> {
  for (const [name, instance] of instances) {
    try {
      await persistProfile(instance, log);
    } catch (err) {
      log.warn(`[browser] Error persisting profile "${name}": ${err}`);
    }
    try {
      await instance.browser.close();
    } catch (err) {
      log.warn(`[browser] Error closing browser for profile "${name}": ${err}`);
      try {
        const proc = instance.browser.process?.();
        if (proc && !proc.killed) {
          proc.kill("SIGKILL");
        }
      } catch {
        // Best-effort
      }
    }
  }
  instances.clear();
}

// ---------------------------------------------------------------------------
// A2A tool builder (returns A2AServerConfig for registration)
// ---------------------------------------------------------------------------

export function buildBrowserA2ATools(log: PluginLogger, headless: boolean): A2AServerConfig {
  return {
    name: "browser",
    version: "1.0.0",
    tools: [
      // ----- browser_navigate -----
      {
        name: "browser_navigate",
        description:
          "Navigate to a URL and return the page content as markdown. Creates a browser instance if needed. Use the profile parameter to persist cookies/sessions across calls.",
        inputSchema: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to navigate to" },
            profile: {
              type: "string",
              description: "Browser profile name for session persistence (default: 'default')",
            },
            waitFor: {
              type: "string",
              enum: ["load", "domcontentloaded", "networkidle"],
              description: "Wait condition (default: 'domcontentloaded')",
            },
            timeout: {
              type: "number",
              description: `Navigation timeout in ms (default: ${DEFAULT_TIMEOUT_MS})`,
            },
          },
          required: ["url"],
        },
        async handler(args): Promise<A2AToolResult> {
          const url = args.url as string;
          const profileName = (args.profile as string) ?? "default";
          const waitFor = (args.waitFor as "load" | "domcontentloaded" | "networkidle") ?? "domcontentloaded";
          const timeout = (args.timeout as number) ?? DEFAULT_TIMEOUT_MS;

          const urlCheck = isUrlSafe(url);
          if (!urlCheck.safe) {
            return { content: [{ type: "text", text: `Navigation blocked: ${urlCheck.reason}` }], isError: true };
          }

          try {
            const instance = await getOrCreateInstance(profileName, headless);
            await instance.page.goto(url, { waitUntil: waitFor, timeout });

            const pageUrl = instance.page.url();
            const finalCheck = isUrlSafe(pageUrl);
            if (!finalCheck.safe) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Navigation blocked after redirect: ${finalCheck.reason} (redirected to ${pageUrl})`,
                  },
                ],
                isError: true,
              };
            }

            const title = await instance.page.title();
            const html = await instance.page.content();
            const markdown = htmlToMarkdown(html);
            await persistProfile(instance, log);

            const truncated =
              markdown.length > MAX_PAGE_CONTENT_LENGTH
                ? `${markdown.substring(0, MAX_PAGE_CONTENT_LENGTH)}\n\n... (truncated)`
                : markdown;

            return {
              content: [{ type: "text", text: `# ${title}\n\nURL: ${pageUrl}\n\n---\n\n${truncated}` }],
            };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Navigation failed: ${message}` }], isError: true };
          }
        },
      },

      // ----- browser_click -----
      {
        name: "browser_click",
        description: "Click an element on the current page by CSS selector.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector of the element to click" },
            profile: { type: "string", description: "Browser profile name (default: 'default')" },
            timeout: { type: "number", description: "Timeout in ms to wait for element (default: 5000)" },
          },
          required: ["selector"],
        },
        async handler(args): Promise<A2AToolResult> {
          const selector = args.selector as string;
          const profileName = (args.profile as string) ?? "default";
          const timeout = (args.timeout as number) ?? 5000;

          try {
            const instance = await getOrCreateInstance(profileName, headless);
            await instance.page.click(selector, { timeout });
            await persistProfile(instance, log);
            const pageUrl = instance.page.url();
            return { content: [{ type: "text", text: `Clicked "${selector}" on ${pageUrl}` }] };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Click failed: ${message}` }], isError: true };
          }
        },
      },

      // ----- browser_type -----
      {
        name: "browser_type",
        description: "Type text into an input field identified by CSS selector.",
        inputSchema: {
          type: "object",
          properties: {
            selector: { type: "string", description: "CSS selector of the input element" },
            text: { type: "string", description: "Text to type" },
            profile: { type: "string", description: "Browser profile name (default: 'default')" },
            clear: { type: "boolean", description: "Clear the field before typing (default: true)" },
            pressEnter: { type: "boolean", description: "Press Enter after typing (default: false)" },
            timeout: { type: "number", description: "Timeout in ms to wait for element (default: 5000)" },
          },
          required: ["selector", "text"],
        },
        async handler(args): Promise<A2AToolResult> {
          const selector = args.selector as string;
          const text = args.text as string;
          const profileName = (args.profile as string) ?? "default";
          const clear = (args.clear as boolean) ?? true;
          const pressEnter = (args.pressEnter as boolean) ?? false;
          const timeout = (args.timeout as number) ?? 5000;

          try {
            const instance = await getOrCreateInstance(profileName, headless);
            if (clear) {
              await instance.page.fill(selector, "", { timeout });
            }
            await instance.page.fill(selector, text, { timeout });
            if (pressEnter) {
              await instance.page.press(selector, "Enter");
            }
            await persistProfile(instance, log);
            return {
              content: [{ type: "text", text: `Typed into "${selector}"${pressEnter ? " and pressed Enter" : ""}` }],
            };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Type failed: ${message}` }], isError: true };
          }
        },
      },

      // ----- browser_screenshot -----
      {
        name: "browser_screenshot",
        description: "Take a screenshot of the current page. Returns base64-encoded PNG data and saves to a temp file.",
        inputSchema: {
          type: "object",
          properties: {
            profile: { type: "string", description: "Browser profile name (default: 'default')" },
            fullPage: { type: "boolean", description: "Capture full scrollable page (default: false)" },
            selector: { type: "string", description: "CSS selector to screenshot a specific element" },
          },
        },
        async handler(args): Promise<A2AToolResult> {
          const profileName = (args.profile as string) ?? "default";
          const fullPage = (args.fullPage as boolean) ?? false;
          const selector = args.selector as string | undefined;

          try {
            const instance = await getOrCreateInstance(profileName, headless);
            let buffer: Buffer;
            if (selector) {
              const element = await instance.page.$(selector);
              if (!element) {
                return { content: [{ type: "text", text: `Element not found: ${selector}` }], isError: true };
              }
              buffer = await element.screenshot({ type: "png" });
            } else {
              buffer = await instance.page.screenshot({ type: "png", fullPage });
            }

            const base64 = buffer.toString("base64");
            const tempPath = join(tmpdir(), `wopr-screenshot-${Date.now()}.png`);
            writeFileSync(tempPath, buffer);

            return {
              content: [
                { type: "text", text: `Screenshot saved to ${tempPath}` },
                { type: "image", data: base64, mimeType: "image/png" },
              ],
            };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Screenshot failed: ${message}` }], isError: true };
          }
        },
      },

      // ----- browser_evaluate -----
      {
        name: "browser_evaluate",
        description:
          "Execute JavaScript in the browser page context. The expression is evaluated in a sandboxed scope with no access to the host file system or Node.js APIs. Returns the serialized result.",
        inputSchema: {
          type: "object",
          properties: {
            expression: { type: "string", description: "JavaScript expression to evaluate in the browser page" },
            profile: { type: "string", description: "Browser profile name (default: 'default')" },
          },
          required: ["expression"],
        },
        async handler(args): Promise<A2AToolResult> {
          const expression = args.expression as string;
          const profileName = (args.profile as string) ?? "default";

          const blocked = [
            "require(",
            "process.",
            "child_process",
            "__dirname",
            "__filename",
            "import(",
            "eval(",
            "function(",
            "fetch(",
            "xmlhttprequest",
          ];
          const normalized = expression.replace(/\s+/g, "").toLowerCase();
          for (const pattern of blocked) {
            if (normalized.includes(pattern.toLowerCase())) {
              return {
                content: [
                  {
                    type: "text",
                    text: `Blocked: expression contains disallowed pattern "${pattern}". Browser evaluate runs in the browser context only.`,
                  },
                ],
                isError: true,
              };
            }
          }

          try {
            const instance = await getOrCreateInstance(profileName, headless);
            const result = await instance.page.evaluate(expression);
            const serialized = JSON.stringify(result, null, 2) ?? "undefined";
            const truncated =
              serialized.length > MAX_EVALUATE_RESULT_LENGTH
                ? `${serialized.substring(0, MAX_EVALUATE_RESULT_LENGTH)}\n... (truncated, ${serialized.length} chars total)`
                : serialized;
            return { content: [{ type: "text", text: truncated }] };
          } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return { content: [{ type: "text", text: `Evaluate failed: ${message}` }], isError: true };
          }
        },
      },
    ],
  };
}
