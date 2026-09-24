const CONVERSATION_SHARE_MODE_TRANSITION_DURATION_SECONDS = 0.2;
const CONVERSATION_SHARE_MODE_EASING = [0.4, 0, 0.2, 1] as const;

const PANEL_VISIBLE_TRANSFORM = "translate3d(0, -50%, 0)";
// 发布包把隐藏位移收成字面量。模板字符串不会被生产压缩折成同一段文本。
const PANEL_HIDDEN_TRANSFORM = "translate3d(-8px, -50%, 0)";

export function resolveConversationShareSelectionPanelMotion(prefersReducedMotion: boolean) {
  if (prefersReducedMotion) {
    return {
      initial: false as const,
      animate: { opacity: 1, transform: PANEL_VISIBLE_TRANSFORM },
      exit: { opacity: 1, transform: PANEL_VISIBLE_TRANSFORM },
      transition: { duration: 0 },
    };
  }

  return {
    initial: { opacity: 0, transform: PANEL_HIDDEN_TRANSFORM },
    animate: { opacity: 1, transform: PANEL_VISIBLE_TRANSFORM },
    exit: { opacity: 0, transform: PANEL_HIDDEN_TRANSFORM },
    transition: {
      duration: CONVERSATION_SHARE_MODE_TRANSITION_DURATION_SECONDS,
      ease: CONVERSATION_SHARE_MODE_EASING,
    },
  };
}

export function resolveConversationShareSelectionScrimMotion(prefersReducedMotion: boolean) {
  if (prefersReducedMotion) {
    return {
      initial: false as const,
      animate: { opacity: 1 },
      exit: { opacity: 1 },
      transition: { duration: 0 },
    };
  }

  return {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: {
      duration: CONVERSATION_SHARE_MODE_TRANSITION_DURATION_SECONDS,
      ease: CONVERSATION_SHARE_MODE_EASING,
    },
  };
}
