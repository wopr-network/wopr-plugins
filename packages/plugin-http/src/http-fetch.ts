/**
 * http_fetch A2A tool handler.
 */

import { checkDomainPolicy } from "./security-policy.js";
import type { A2AToolResult, HttpPluginConfig } from "./types.js";

export interface HttpFetchArgs {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeout?: number;
  includeHeaders?: boolean;
}

export function createHttpFetchHandler(getConfig: () => HttpPluginConfig) {
  return async (args: Record<string, unknown>): Promise<A2AToolResult> => {
    const {
      url,
      method = "GET",
      headers = {},
      body,
      timeout = 30000,
      includeHeaders = false,
    } = args as unknown as HttpFetchArgs;

    const config = getConfig();
    const maxTimeout = config.maxTimeout ?? 30000;
    const maxResponseSize = config.maxResponseSize ?? 10000;
    const effectiveTimeout = Math.min(timeout, maxTimeout);

    const domainError = checkDomainPolicy(url, config);
    if (domainError) {
      return { content: [{ type: "text", text: `Access denied: ${domainError}` }], isError: true };
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);
      const response = await fetch(url, {
        method: method.toUpperCase(),
        headers: headers as Record<string, string>,
        body: body || undefined,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      let responseHeaders = "";
      if (includeHeaders) {
        const headerLines: string[] = [];
        response.headers.forEach((value, key) => {
          headerLines.push(`${key}: ${value}`);
        });
        responseHeaders = `${headerLines.join("\n")}\n\n`;
      }

      const contentType = response.headers.get("content-type") || "";
      let responseBody: string;
      if (contentType.includes("application/json")) {
        const json = await response.json();
        responseBody = JSON.stringify(json, null, 2);
      } else {
        responseBody = await response.text();
      }

      if (responseBody.length > maxResponseSize) {
        responseBody = `${responseBody.substring(0, maxResponseSize)}\n... (truncated)`;
      }

      return {
        content: [
          {
            type: "text",
            text: `HTTP ${response.status} ${response.statusText}\n${responseHeaders}\n${responseBody}`,
          },
        ],
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        content: [{ type: "text", text: `HTTP request failed: ${message}` }],
        isError: true,
      };
    }
  };
}
