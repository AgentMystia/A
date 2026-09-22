export function readMarketingPlainLabel(value: {
  format: "plaintext" | "html" | "markdown";
  content: string;
}): string {
  if (value.format !== "html") {
    return value.content;
  }
  const template = document.createElement("template");
  template.innerHTML = value.content;
  template.content
    .querySelectorAll("script,style,iframe,object,svg,math,template")
    .forEach((node) => {
      node.remove();
    });
  return template.content.textContent?.trim() ?? "";
}
