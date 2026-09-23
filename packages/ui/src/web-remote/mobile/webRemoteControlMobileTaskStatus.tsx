import { CircleAlert, CircleCheck, Loader } from "lucide-react";
import type { WebRemoteControlTaskSnapshot } from "@zcode/shared";

export function mobileTaskStatusClass(
  status: NonNullable<WebRemoteControlTaskSnapshot["displayStatus"]>,
): string {
  switch (status) {
    case "running":
      return "border-brand/40 bg-accent text-foreground";
    case "completed":
      return "border-success/40 bg-success text-success-foreground";
    case "error":
      return "border-destructive/40 bg-destructive text-destructive-foreground";
    case "idle":
      return "border-border bg-surface text-foreground-subtle";
  }
}

/** 发布包直接调用这个函数，而不是再包一层组件。 */
export function mobileTaskStatusIcon(
  status: NonNullable<WebRemoteControlTaskSnapshot["displayStatus"]>,
) {
  if (status === "running") return <Loader className="size-3 animate-spin" />;
  if (status === "completed") return <CircleCheck className="size-3" />;
  if (status === "error") return <CircleAlert className="size-3" />;
  return null;
}
