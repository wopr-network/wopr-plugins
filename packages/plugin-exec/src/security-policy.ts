/**
 * Security policy enforcement for exec_command.
 */

import { normalize } from "node:path";
import { parse as parseShellQuote } from "shell-quote";
import type { ExecPluginConfig } from "./types.js";

const DEFAULT_ALLOWED_COMMANDS = [
	"ls",
	"cat",
	"grep",
	"find",
	"echo",
	"date",
	"pwd",
	"whoami",
	"head",
	"tail",
	"wc",
	"sort",
	"uniq",
	"diff",
	"which",
	"file",
	"stat",
	"du",
	"df",
	"uptime",
	"hostname",
	"uname",
];

const SHELL_OPERATORS = [";", "&&", "||", "|", "`", "$("];

const SENSITIVE_PATHS = [
	"/etc/shadow",
	"/etc/passwd",
	"/etc/sudoers",
	"/proc/self/environ",
	"/proc/self/cmdline",
	"/proc/self/maps",
];

const BLOCKED_CWD_PREFIXES = ["/proc", "/sys", "/dev"];

export function parseList(val: unknown): string[] {
	if (Array.isArray(val)) return val as string[];
	if (typeof val === "string")
		return val
			.split(",")
			.map((s) => s.trim())
			.filter(Boolean);
	return [];
}

export function checkCwdPolicy(cwd: string | undefined): string | null {
	if (cwd === undefined) return null;
	if (!cwd.startsWith("/")) {
		return "Working directory must be an absolute path";
	}
	const segments = cwd.split("/");
	if (segments.some((seg) => seg === "..")) {
		return "Path traversal not allowed in working directory";
	}
	const normalized = normalize(cwd);
	for (const prefix of BLOCKED_CWD_PREFIXES) {
		if (normalized === prefix || normalized.startsWith(`${prefix}/`)) {
			return `Working directory '${prefix}' is not allowed`;
		}
	}
	return null;
}

export function checkCommandPolicy(command: string, config: ExecPluginConfig): string | null {
	const allowedCommands = config.allowedCommands ?? DEFAULT_ALLOWED_COMMANDS;
	const blockOperators = config.blockShellOperators !== false;

	if (blockOperators) {
		for (const op of SHELL_OPERATORS) {
			if (command.includes(op)) {
				return "Shell operators not allowed on host. Enable sandboxing for full shell access.";
			}
		}
	}

	const parsedTokens = parseShellQuote(command);
	for (const token of parsedTokens) {
		if (typeof token !== "string") continue;
		const normalizedToken = normalize(token);
		for (const sensitive of SENSITIVE_PATHS) {
			const normalizedSensitive = normalize(sensitive);
			if (
				normalizedToken === normalizedSensitive ||
				normalizedToken.startsWith(`${normalizedSensitive}/`)
			) {
				return `Access to '${sensitive}' is not allowed`;
			}
		}
	}

	const firstWord = command.trim().split(/\s+/)[0];
	if (!allowedCommands.includes(firstWord)) {
		return `Command '${firstWord}' not allowed. Allowed: ${allowedCommands.join(", ")}. Enable sandboxing for full shell access.`;
	}

	return null;
}
