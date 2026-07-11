const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button",
  "input",
  "select",
  "textarea",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

export function getFocusableElements(container) {
  return [...container.querySelectorAll(FOCUSABLE_SELECTOR)].filter((element) => {
    if (element.disabled || element.hidden) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest('[aria-hidden="true"], [hidden]')) return false;
    return element.getClientRects().length > 0;
  });
}

export function createFocusTrap({ container, onEscape, returnFocus } = {}) {
  let active = false;
  let savedReturnFocus = null;

  function handleKeydown(event) {
    if (event.key === "Escape") {
      event.preventDefault();
      onEscape?.();
      return;
    }

    if (event.key !== "Tab") return;

    const focusable = getFocusableElements(container);
    if (!focusable.length) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable.at(-1);
    const current = container.ownerDocument.activeElement;
    const shouldWrapBackward = event.shiftKey && (current === first || !focusable.includes(current));
    const shouldWrapForward = !event.shiftKey && (current === last || !focusable.includes(current));

    if (shouldWrapBackward) {
      event.preventDefault();
      last.focus();
    } else if (shouldWrapForward) {
      event.preventDefault();
      first.focus();
    }
  }

  return {
    activate() {
      if (active) return;
      active = true;
      savedReturnFocus = returnFocus || container.ownerDocument.activeElement;
      container.addEventListener("keydown", handleKeydown);
      getFocusableElements(container)[0]?.focus();
    },
    deactivate() {
      if (!active) return;
      active = false;
      container.removeEventListener("keydown", handleKeydown);
    },
    getReturnFocus() {
      return savedReturnFocus;
    }
  };
}
