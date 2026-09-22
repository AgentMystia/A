import { CloudDialogImageHero } from "./CloudDialogImageHero.js";
import { CloudDialogInteractiveHero } from "./CloudDialogInteractiveHero.js";
import { CloudDialogLottieHero } from "./CloudDialogLottieHero.js";
import { CloudDialogVideoHero } from "./CloudDialogVideoHero.js";
import type { CloudDialogHero } from "./cloudDialogModel.js";

export function CloudDialogHeroView({
  hero,
  locale,
  title,
  onAction,
}: {
  hero: CloudDialogHero;
  locale: string;
  title: string;
  onAction?: (eventId: string) => void;
}) {
  if (hero.type === "image") {
    return <CloudDialogImageHero hero={hero} />;
  }
  if (hero.type === "video") {
    return <CloudDialogVideoHero hero={hero} title={title} />;
  }
  if (hero.type === "lottie") {
    return <CloudDialogLottieHero hero={hero} title={title} />;
  }
  if (hero.resolvedUrl) {
    return (
      <CloudDialogInteractiveHero
        hero={hero}
        locale={locale}
        title={title}
        onAction={onAction}
        key={hero.resolvedUrl}
      />
    );
  }
  if (hero.fallback) {
    return <CloudDialogImageHero hero={hero.fallback} />;
  }
  return <div data-testid="cloud-dialog-hero-unresolved" className="size-full bg-surface" />;
}
