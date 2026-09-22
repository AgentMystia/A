import { Bot, Webhook } from "lucide-react";

import feishuLarkIconUrl from "@/assets/bot-provider-icons/feishu-lark.png";
import { cn } from "@/components/lib/utils.js";

export function BotProviderIcon({ provider, className }: { provider: string; className?: string }) {
  if (provider === "feishu" || provider === "lark") {
    return (
      <img
        src={feishuLarkIconUrl}
        alt=""
        aria-hidden="true"
        className={cn("size-4 object-contain", className)}
      />
    );
  }
  const Icon = provider === "webhook" ? Webhook : Bot;
  return <Icon className={cn("size-4", className)} />;
}
