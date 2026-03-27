const MAX_MESSAGE_LENGTH = 4000;

/**
 * Build a Matrix message content object.
 * If the message contains markdown-like formatting, include HTML formatted_body.
 */
export function formatMessage(text: string): {
  msgtype: string;
  body: string;
  format?: string;
  formatted_body?: string;
} {
  const hasFormatting = containsFormatting(text);

  if (hasFormatting) {
    return {
      msgtype: "m.text",
      body: text,
      format: "org.matrix.custom.html",
      formatted_body: markdownToHtml(text),
    };
  }

  return {
    msgtype: "m.text",
    body: text,
  };
}

/**
 * Check if text contains markdown-like formatting that should be rendered as HTML.
 */
function containsFormatting(text: string): boolean {
  return /(\*\*|__|~~|```|`[^`]+`|\[.+\]\(.+\)|^#{1,6}\s|^[-*]\s|^\d+\.\s)/m.test(text);
}

/**
 * Convert basic markdown to HTML for Matrix formatted_body.
 */
export function markdownToHtml(text: string): string {
  // Extract code blocks before any other transforms so the newline→<br/> step
  // does not corrupt multi-line code output with double line breaks.
  const codeBlocks: string[] = [];
  // Placeholder must not contain markdown special chars (_*~`[#-) to avoid
  // being transformed by subsequent formatting rules before reinsertion.
  const PLACEHOLDER_PREFIX = "WOPRCBSTART";
  const PLACEHOLDER_SUFFIX = "WOPRCBEND";
  let html = text.replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang, code) => {
    const escapedCode = escapeHtml(code.trim());
    const block = lang
      ? `<pre><code class="language-${lang}">${escapedCode}</code></pre>`
      : `<pre><code>${escapedCode}</code></pre>`;
    const idx = codeBlocks.push(block) - 1;
    return `${PLACEHOLDER_PREFIX}${idx}${PLACEHOLDER_SUFFIX}`;
  });

  // Inline code
  html = html.replace(/`([^`]+)`/g, (_m, code) => `<code>${escapeHtml(code)}</code>`);

  // Bold
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");

  // Italic
  html = html.replace(/\*(.+?)\*/g, "<em>$1</em>");
  html = html.replace(/_(.+?)_/g, "<em>$1</em>");

  // Strikethrough
  html = html.replace(/~~(.+?)~~/g, "<del>$1</del>");

  // Links
  html = html.replace(/\[(.+?)\]\((.+?)\)/g, '<a href="$2">$1</a>');

  // Headers
  html = html.replace(/^######\s+(.+)$/gm, "<h6>$1</h6>");
  html = html.replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>");
  html = html.replace(/^####\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^###\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^##\s+(.+)$/gm, "<h2>$1</h2>");
  html = html.replace(/^#\s+(.+)$/gm, "<h1>$1</h1>");

  // Line breaks — applied only outside code blocks (which are already placeholders)
  html = html.replace(/\n/g, "<br/>");

  // Reinsert extracted code blocks
  html = html.replace(
    new RegExp(`${PLACEHOLDER_PREFIX}(\\d+)${PLACEHOLDER_SUFFIX}`, "g"),
    (_m, idx) => codeBlocks[Number(idx)] ?? "",
  );

  return html;
}

export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Split a long message into chunks at natural break points.
 */
export function chunkMessage(text: string, maxLen = MAX_MESSAGE_LENGTH): string[] {
  if (text.length <= maxLen) return [text];

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxLen) {
      chunks.push(remaining);
      break;
    }
    let splitAt = remaining.lastIndexOf("\n", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = remaining.lastIndexOf(" ", maxLen);
    if (splitAt < maxLen * 0.5) splitAt = maxLen;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }

  return chunks;
}
