/**
 * Shell Escape Utility
 * Sanitizes strings for safe inclusion in shell commands.
 */

/**
 * Escape a string for safe use as a single shell argument within a shell command string.
 * Wraps the value in single quotes and escapes any embedded single quotes.
 * This is the POSIX-standard approach: 'value' with ' escaped as '\''
 *
 * Use this to safely embed a dynamic value as an argument inside a shell command string
 * that will be passed to `sh -c`. For example:
 *   `find ${shellEscapeArg(userPath)} -name "*.txt"`
 *
 * Do NOT use this to validate or escape a full command string — use execInContainerRaw()
 * instead when you need to avoid shell interpretation entirely.
 */
export function shellEscapeArg(arg: string): string {
  // Replace each single quote with: end quote, escaped quote, start quote
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Shell metacharacters that enable command injection when passed to `sh -c`.
 * Any command containing these characters is rejected by validateCommand().
 *
 * To run commands that require shell features (pipes, redirects, chaining),
 * build the command string manually using shellEscapeArg() for dynamic values,
 * or use execInContainerRaw() to bypass the shell entirely.
 */
const SHELL_METACHAR_PATTERN = /[;&|`$<>\\]/;

/**
 * Validate a command string for shell injection vectors.
 * Returns the trimmed command if safe; throws with a descriptive message otherwise.
 *
 * Blocks all shell metacharacters that enable injection: ; & | ` $ < > \
 * This is intentionally strict. If you need shell features (pipes, redirects,
 * variable expansion), use execInContainerRaw() for the parts you control
 * and shellEscapeArg() for any dynamic values embedded in a shell string.
 *
 * @throws {Error} If the command contains null bytes, is empty, or contains shell metacharacters.
 */
export function validateCommand(command: string): string {
  // Reject null bytes — these can truncate strings in C-based shells
  if (command.includes("\0")) {
    throw new Error("Command contains null bytes");
  }

  // Reject empty commands
  const trimmed = command.trim();
  if (!trimmed) {
    throw new Error("Command is empty");
  }

  // Reject shell metacharacters that enable injection
  const match = trimmed.match(SHELL_METACHAR_PATTERN);
  if (match) {
    throw new Error(
      `Command contains shell metacharacter '${match[0]}' — use execInContainerRaw() for complex commands or shellEscapeArg() for dynamic values`,
    );
  }

  return trimmed;
}

/**
 * Validate that an environment variable key is a legal POSIX identifier.
 * Throws if the key contains characters that could be used for injection
 * when constructing env strings (e.g. `KEY=value` passed to `docker exec -e`).
 *
 * @throws {Error} If the key is not a valid POSIX environment variable name.
 */
export function validateEnvKey(key: string): string {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
    throw new Error(`Invalid environment variable key '${key}' — keys must match /^[A-Za-z_][A-Za-z0-9_]*$/`);
  }
  return key;
}
