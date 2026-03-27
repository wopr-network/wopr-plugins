/**
 * exec_command A2A tool handler.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse as parseShellQuote } from "shell-quote";
import { checkCommandPolicy, checkCwdPolicy } from "./security-policy.js";
import type { A2AToolResult, ExecPluginConfig } from "./types.js";

const execFileAsync = promisify(execFile);

const SAFE_ENV_KEYS = ["PATH", "HOME", "USER", "LANG", "LC_ALL", "TERM", "TZ"];

function buildSafeEnv(): Record<string, string> {
	const env: Record<string, string> = {};
	for (const key of SAFE_ENV_KEYS) {
		if (process.env[key]) {
			env[key] = process.env[key] as string;
		}
	}
	return env;
}

export interface ExecCommandArgs {
	command: string;
	cwd?: string;
	timeout?: number;
}

export function createExecCommandHandler(getConfig: () => ExecPluginConfig) {
	return async (args: Record<string, unknown>): Promise<A2AToolResult> => {
		const { command, cwd, timeout = 10000 } = args as unknown as ExecCommandArgs;

		const config = getConfig();
		const maxExecTimeout = config.maxExecTimeout ?? 60000;
		const effectiveTimeout = Math.min(timeout, maxExecTimeout);
		const maxOutputSize = config.maxOutputSize ?? 10000;
		const stripEnv = config.stripEnv !== false;

		const cwdError = checkCwdPolicy(cwd);
		if (cwdError) {
			return { content: [{ type: "text", text: cwdError }], isError: true };
		}

		const commandError = checkCommandPolicy(command, config);
		if (commandError) {
			return { content: [{ type: "text", text: commandError }], isError: true };
		}

		const parsedParts = parseShellQuote(command);
		const parts = parsedParts.filter((p): p is string => typeof p === "string");
		if (parts.length === 0) {
			return { content: [{ type: "text", text: "Empty command" }], isError: true };
		}
		const executable = parts[0];
		const execArgs = parts.slice(1);

		try {
			const { stdout, stderr } = await execFileAsync(executable, execArgs, {
				cwd: cwd || undefined,
				timeout: effectiveTimeout,
				maxBuffer: 1024 * 1024,
				env: stripEnv ? buildSafeEnv() : undefined,
			});
			let output = stdout;
			if (stderr) output += `\n[stderr]\n${stderr}`;
			if (output.length > maxOutputSize)
				output = `${output.substring(0, maxOutputSize)}\n... (truncated)`;
			return { content: [{ type: "text", text: output || "(no output)" }] };
		} catch (err: unknown) {
			const message = err instanceof Error ? err.message : String(err);
			return { content: [{ type: "text", text: `Command failed: ${message}` }], isError: true };
		}
	};
}
