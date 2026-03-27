/**
 * Security policy enforcement for http_fetch.
 */

import type { HttpPluginConfig } from "./types.js";

const BLOCKED_DOMAINS = ["169.254.169.254", "metadata.google.internal", "metadata.google"];

export function parseList(val: unknown): string[] {
	if (Array.isArray(val)) return val as string[];
	if (typeof val === "string")
		return val
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	return [];
}

export function checkDomainPolicy(url: string, config: HttpPluginConfig): string | null {
	let hostname: string;
	try {
		hostname = new URL(url).hostname;
	} catch {
		return `Invalid URL: ${url}`;
	}

	for (const blocked of BLOCKED_DOMAINS) {
		if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
			return `Domain '${hostname}' is blocked by security policy`;
		}
	}

	if (config.blockedDomains?.length) {
		for (const blocked of config.blockedDomains) {
			if (hostname === blocked || hostname.endsWith(`.${blocked}`)) {
				return `Domain '${hostname}' is blocked by security policy`;
			}
		}
	}

	if (config.allowedDomains?.length) {
		const allowed = config.allowedDomains.some((d) => hostname === d || hostname.endsWith(`.${d}`));
		if (!allowed) {
			return `Domain '${hostname}' is not in the allowed domains list`;
		}
	}

	return null;
}
