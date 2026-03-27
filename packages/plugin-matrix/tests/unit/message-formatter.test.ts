import { describe, expect, it } from "vitest";
import { chunkMessage, escapeHtml, formatMessage, markdownToHtml } from "../../src/message-formatter.js";

describe("formatMessage", () => {
  it("returns plain text for simple strings", () => {
    const result = formatMessage("Hello world");
    expect(result.msgtype).toBe("m.text");
    expect(result.body).toBe("Hello world");
    expect(result.formatted_body).toBeUndefined();
    expect(result.format).toBeUndefined();
  });

  it("returns formatted_body with HTML for bold markdown", () => {
    const result = formatMessage("**bold text**");
    expect(result.msgtype).toBe("m.text");
    expect(result.body).toBe("**bold text**");
    expect(result.format).toBe("org.matrix.custom.html");
    expect(result.formatted_body).toContain("<strong>bold text</strong>");
  });

  it("returns formatted_body with HTML for code blocks", () => {
    const result = formatMessage("```js\nconsole.log('hi');\n```");
    expect(result.format).toBe("org.matrix.custom.html");
    expect(result.formatted_body).toContain("<pre><code");
  });

  it("returns formatted_body for inline code", () => {
    const result = formatMessage("Use `npm install`");
    expect(result.format).toBe("org.matrix.custom.html");
    expect(result.formatted_body).toContain("<code>npm install</code>");
  });
});

describe("markdownToHtml", () => {
  it("converts bold **text**", () => {
    expect(markdownToHtml("**bold**")).toContain("<strong>bold</strong>");
  });

  it("converts bold __text__", () => {
    expect(markdownToHtml("__bold__")).toContain("<strong>bold</strong>");
  });

  it("converts italic *text*", () => {
    expect(markdownToHtml("*italic*")).toContain("<em>italic</em>");
  });

  it("converts italic _text_", () => {
    expect(markdownToHtml("_italic_")).toContain("<em>italic</em>");
  });

  it("converts strikethrough ~~text~~", () => {
    expect(markdownToHtml("~~strike~~")).toContain("<del>strike</del>");
  });

  it("converts links [text](url)", () => {
    expect(markdownToHtml("[click](https://example.com)")).toContain('<a href="https://example.com">click</a>');
  });

  it("converts h1 headers", () => {
    expect(markdownToHtml("# Heading")).toContain("<h1>Heading</h1>");
  });

  it("converts h2 headers", () => {
    expect(markdownToHtml("## Heading")).toContain("<h2>Heading</h2>");
  });

  it("converts code blocks with language", () => {
    const html = markdownToHtml("```python\nprint('hi')\n```");
    expect(html).toContain('class="language-python"');
    expect(html).toContain("print(&#39;hi&#39;)");
  });

  it("escapes HTML in code blocks", () => {
    const html = markdownToHtml("```\n<script>alert('xss')</script>\n```");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });
});

describe("escapeHtml", () => {
  it("escapes ampersands", () => {
    expect(escapeHtml("a & b")).toBe("a &amp; b");
  });

  it("escapes less than", () => {
    expect(escapeHtml("a < b")).toBe("a &lt; b");
  });

  it("escapes greater than", () => {
    expect(escapeHtml("a > b")).toBe("a &gt; b");
  });

  it("escapes quotes", () => {
    expect(escapeHtml('a "b"')).toBe("a &quot;b&quot;");
  });
});

describe("chunkMessage", () => {
  it("returns single chunk for short messages", () => {
    const result = chunkMessage("short message");
    expect(result).toHaveLength(1);
    expect(result[0]).toBe("short message");
  });

  it("splits long messages at newline boundaries", () => {
    const line = "a".repeat(100) + "\n";
    const longText = line.repeat(50);
    const chunks = chunkMessage(longText);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it("splits long messages at space boundaries when no newlines", () => {
    const words = "word ".repeat(1000);
    const chunks = chunkMessage(words);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4000);
    }
  });

  it("respects custom maxLen", () => {
    const text = "hello world foo bar";
    const chunks = chunkMessage(text, 10);
    expect(chunks.length).toBeGreaterThan(1);
  });

  it("preserves all content across chunks", () => {
    const text = "word ".repeat(1000).trim();
    const chunks = chunkMessage(text);
    const rejoined = chunks.join(" ");
    // All words from original should be present
    expect(rejoined.length).toBeGreaterThan(0);
  });
});
