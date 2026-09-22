import { Marked } from "marked";
import { createElement, type ComponentProps, type MouseEvent, type ReactNode } from "react";

import { cn } from "../components/lib/utils.js";
import { sanitizeMarketingStyle } from "./marketingStyle.js";

const ALLOWED_TAGS = new Set(
  "p.br.b.strong.i.em.u.s.ul.ol.li.code.a.span.time.h1.h2.h3.h4.h5.h6.blockquote.pre.hr.del.table.thead.tbody.tr.th.td".split(
    ".",
  ),
);
const BLOCK_TAGS = new Set([
  "p",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "hr",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
]);
const TAG_CLASS: Record<string, string> = {
  b: "font-semibold text-foreground",
  strong: "font-semibold text-foreground",
  ul: "list-disc pl-5",
  ol: "list-decimal pl-5",
  code: "font-mono text-ui-sm",
  a: "text-icon-blue underline underline-offset-4",
  time: "whitespace-nowrap font-semibold text-foreground underline decoration-foreground-subtle decoration-dashed underline-offset-4",
  h1: "text-ui-xl font-semibold",
  h2: "text-ui-lg font-semibold",
  h3: "text-ui-base font-semibold",
  h4: "text-ui-base font-semibold",
  h5: "text-ui-base font-medium",
  h6: "text-ui-base font-normal",
  blockquote: "border-l border-border pl-3",
  pre: "overflow-x-auto whitespace-pre-wrap font-mono text-ui-sm",
  table: "w-full text-ui-base",
  th: "border border-border p-2 font-semibold",
  td: "border border-border p-2",
};

const marketingMarked = new Marked({
  async: false,
  renderer: {
    html({ text }) {
      return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    },
  },
});

function readSafeHttpUrl(value: string | null): string | undefined {
  if (!value || !/^https?:\/\//i.test(value)) {
    return undefined;
  }
  try {
    const url = new URL(value);
    return url.username || url.password ? undefined : url.href;
  } catch {
    return undefined;
  }
}

function renderSanitizedHtml(
  html: string,
  onOpenExternal: ((url: string) => void) | undefined,
  inline: boolean,
): ReactNode {
  if (html.length > 20_000 || typeof document === "undefined") {
    return html;
  }
  const template = document.createElement("template");
  template.innerHTML = html;
  let overflow = false;
  const visit = (node: ChildNode, depth: number, key: number): ReactNode => {
    if (depth > 32) {
      overflow = true;
      return null;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      return node.textContent;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
      return null;
    }
    const element = node as Element;
    const tag = element.localName;
    if (element.namespaceURI !== "http://www.w3.org/1999/xhtml" || !ALLOWED_TAGS.has(tag)) {
      return null;
    }
    const children = Array.from(element.childNodes, (child, index) =>
      visit(child, depth + 1, index),
    );
    const className = cn(
      inline ? (tag === "b" || tag === "strong" ? "font-semibold" : undefined) : TAG_CLASS[tag],
      element.getAttribute("class"),
    );
    const style = sanitizeMarketingStyle(element.getAttribute("style"));
    if (tag === "a") {
      const href = readSafeHttpUrl(element.getAttribute("href"));
      if (!href || !onOpenExternal) {
        return createElement(
          "span",
          { key, className: element.getAttribute("class") ?? undefined, style },
          children,
        );
      }
      return createElement(
        "a",
        {
          key,
          className,
          style,
          href,
          title: element.getAttribute("title") ?? undefined,
          onClick: (event: MouseEvent) => {
            event.preventDefault();
            onOpenExternal(href);
          },
        },
        children,
      );
    }
    return createElement(
      inline && BLOCK_TAGS.has(tag) ? "span" : tag,
      { key, className, style },
      tag === "br" || tag === "hr" ? undefined : children,
    );
  };
  const nodes = Array.from(template.content.childNodes, (node, index) => visit(node, 0, index));
  return overflow ? html : nodes;
}

export function MarketingRichText({
  text,
  inline = false,
  onOpenExternal,
}: {
  text: { format: "plain_text" | "html" | "markdown"; text: string };
  inline?: boolean;
  onOpenExternal?: (url: string) => void;
}) {
  if (text.format === "plain_text" || text.text.length > 20_000) {
    return text.text;
  }
  const html =
    text.format === "markdown"
      ? String(marketingMarked.parse(text.text, { async: false })).trimEnd()
      : text.text;
  return renderSanitizedHtml(html, inline ? undefined : onOpenExternal, inline);
}

export function MarketingDescription({
  description,
  onOpenExternal,
  ...props
}: ComponentProps<"div"> & {
  description: { format: "plain_text" | "html" | "markdown"; text: string };
  onOpenExternal?: (url: string) => void;
}) {
  return (
    <div {...props} data-description-format={description.format}>
      <MarketingRichText text={description} onOpenExternal={onOpenExternal} />
    </div>
  );
}
