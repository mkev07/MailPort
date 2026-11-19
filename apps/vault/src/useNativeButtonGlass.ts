import { tintChannels } from "./features/settings/model/tint";
import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";

const MAX_GLASS_CONTROLS = 128;

function glassBounds(button: HTMLElement) {
  const { left, top, width, height, right, bottom } = button.getBoundingClientRect();
  if (
    !width ||
    !height ||
    left < 0 ||
    top < 0 ||
    right > innerWidth ||
    bottom > innerHeight
  )
    return null;

  const style = getComputedStyle(button);
  if (style.visibility !== "visible" || style.opacity === "0") return null;

  // AppKit views sit outside the WebKit scroll containers. Only place material
  // under fully visible buttons so it cannot bleed beyond an editor or sidebar.
  for (
    let parent = button.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    // WebKit can report a box for disclosure content that it no longer paints.
    if (
      parent instanceof HTMLDetailsElement &&
      !parent.open &&
      !parent.querySelector(":scope > summary")?.contains(button)
    ) {
      return null;
    }

    const { overflowX, overflowY } = getComputedStyle(parent);
    if (overflowX === "visible" && overflowY === "visible") continue;
    const bounds = parent.getBoundingClientRect();
    if (
      (overflowX !== "visible" &&
        (left < bounds.left || right > bounds.right)) ||
      (overflowY !== "visible" && (top < bounds.top || bottom > bounds.bottom))
    )
      return null;
  }

  const cssRadius = style.borderTopLeftRadius;
  const radius = parseFloat(cssRadius) || 0;
  const pixels = cssRadius.endsWith("%")
    ? (Math.min(width, height) * radius) / 100
    : radius;
  const destructive = button.classList.contains("danger-button");
  const role = destructive ? "danger"
    : button.matches('.account-select-avatar[aria-checked="true"]') ? "selection"
    : button.classList.contains("primary") ? "primary"
    : "standard";
  const profileTint = button.matches(".profile-avatar")
    ? tintChannels(style.getPropertyValue("--profile-avatar-color").trim())
    : null;
  const controlTint = tintChannels(style.getPropertyValue("--vault-control-tint").trim());
  const tint = controlTint ?? profileTint ?? tintChannels(style.getPropertyValue(`--vault-button-${role}-color`).trim());
  const strength = Number.parseInt(
    style.getPropertyValue(controlTint ? "--vault-control-tint-strength" : `--vault-button-${role}-strength`),
    10,
  );
  return {
    tint: button.matches("dialog") ? null : tint,
    neutralTint: profileTint ? 100 : Number.isNaN(strength) ? null : strength,
    light: document.documentElement.classList.contains("theme-light"),
    left: left / innerWidth,
    top: top / innerHeight,
    width: width / innerWidth,
    height: height / innerHeight,
    radius: Math.min(pixels, width / 2, height / 2) / innerHeight,
    panel: button.matches("dialog"),
    inDialog: !!button.closest("dialog"),
    destructive,
    slider: button.dataset.sliderId ? {
      id: button.dataset.sliderId,
      label: button.dataset.sliderLabel ?? "",
      value: Number(button.dataset.sliderValue),
    } : null,
    interactive: button.closest("button")?.matches(":enabled") ?? false,
  };
}

export function useNativeButtonGlass() {
  useEffect(() => {
    const html = document.documentElement;
    const app = document.querySelector<HTMLElement>(".vault-app");
    if (!app || !html.classList.contains("is-mac")) return;

    const reduced = matchMedia("(prefers-reduced-transparency: reduce)");
    const painted = new Set<HTMLElement>();
    let frame = 0;
    let stopped = false;
    let updating = false;
    let dirty = false;
    let resizeTimer = 0;
    let resizeGeneration = 0;
    let scrollTimer = 0;
    const scrolling = new Set<Element>();

    function onScroll(event: Event) {
      const target = event.target === document ? document.documentElement : event.target;
      if (!(target instanceof Element) || (!app!.contains(target) && !target.contains(app!))) return;
      if (!scrolling.has(target)) {
        scrolling.add(target);
        queue();
      }
      window.clearTimeout(scrollTimer);
      scrollTimer = window.setTimeout(() => {
        scrolling.clear();
        queue();
      }, 120);
    }

    function scheduleResizePaint() {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = 0;
        queue();
      }, 120);
    }

    function onWindowResize() {
      resizeGeneration++;
      for (const control of painted) {
        control.removeAttribute("data-native-glass");
        resize.unobserve(control);
      }
      painted.clear();
      html.classList.remove("has-vault-control-glass");
      scheduleResizePaint();
    }

    const resize = new ResizeObserver(queue);
    resize.observe(app);
    const mutations = new MutationObserver((records) => {
      if (
        records.some(
          ({ attributeName, target }) =>
            attributeName !== "style" ||
            !(
              target instanceof Element &&
              target.matches(".account-drag-card, .account-delete-area")
            ),
        )
      )
        queue();
    });
    mutations.observe(document.body, { childList: true });
    mutations.observe(html, { attributes: true, attributeFilter: ["style", "class"] });
    mutations.observe(app, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "open",
        "hidden",
        "class",
        "style",
        "disabled",
        "aria-pressed",
        "aria-checked",
        "data-passphrase-state",
        "data-floating-action",
        "data-slider-value",
      ],
    });

    function onPassphraseTransition(event: TransitionEvent) {
      if (
        event.propertyName === "grid-template-rows" &&
        event.target instanceof Element &&
        event.target.matches(".passphrase-fields")
      )
        queue();
    }

    function onExportHover(event: PointerEvent) {
      if (!(event.target instanceof Element)) return;
      const button = event.target.closest(".export-action, .transfer-cancel");
      if (button && !(event.relatedTarget instanceof Node && button.contains(event.relatedTarget))) {
        queue();
      }
    }

    function queue() {
      dirty = true;
      if (!frame && !updating && !stopped && !resizeTimer)
        frame = requestAnimationFrame(update);
    }

    async function update() {
      frame = 0;
      if (resizeTimer) return;
      const generation = resizeGeneration;
      dirty = false;
      updating = true;
      const dialog = app!.querySelector("dialog[open]");
      const unlockForm = app!.querySelector(".unlock-form");
      const passphraseState = unlockForm?.getAttribute("data-passphrase-state");
      const unlockIsMoving =
        passphraseState === "pending" ||
        passphraseState === "verified" ||
        unlockForm
          ?.querySelector(".passphrase-fields")
          ?.getAnimations()
          .some((animation) => animation.playState === "running");
      const outsideAction = document.body.querySelector(":scope > .editor-outside-backdrop");
      const floatingActions = outsideAction?.querySelector(".editor-outside-actions");
      const floatingButtons = floatingActions && !floatingActions.getAnimations().some(
        (animation) => animation.playState === "running",
      )
        ? Array.from(floatingActions.querySelectorAll<HTMLButtonElement>("button"))
        : [];
      const controls = reduced.matches
        ? []
        : [
            ...(dialog instanceof HTMLElement ? [dialog] : []),
            ...floatingButtons,
            ...Array.from(
              (dialog ?? app!).querySelectorAll<HTMLElement>(
                dialog
                  ? "button, .profile-preview .profile-avatar"
                  : "button:not(.account-heading-select, .account-button, .profile-link), .profile-sidebar .profile-link .profile-avatar, .appearance-slider-track",
              ),
            ),
          ]
            .filter((element) => !element.closest(".account-profile-options"))
            .flatMap((button) => {
              // Native overlays cannot move with WebKit's compositor scroll.
              // Use the in-page control until this container settles.
              if ([...scrolling].some((target) => target !== button && target.contains(button))) return [];
              if (unlockIsMoving && button.closest(".welcome")) return [];
              if (outsideAction && button.closest(".drag-strip, .profile-sidebar, .account-pane, .export-sidebar")) return [];
              const bounds = glassBounds(button);
              return bounds ? [{ button, bounds }] : [];
            })
            .slice(0, MAX_GLASS_CONTROLS);
      const native = await invoke<boolean | null>("set_vault_control_glass", {
        controls: controls.map(({ bounds }) => bounds),
      }).catch(() => false);
      updating = false;
      if (stopped) return;
      if (generation !== resizeGeneration) {
        if (dirty) queue();
        return;
      }
      if (native === null) scheduleResizePaint();

      const next = new Set(
        native && !reduced.matches ? controls.map(({ button }) => button) : [],
      );
      const surfaces = [app!, ...app!.querySelectorAll<HTMLElement>(
        ".detail-pane, .account-card, .profile-sidebar, .account-pane, .export-sidebar, .account-profile-options, dialog[open]",
      )];
      for (const surface of surfaces) {
        const { left, top, width, height } = surface.getBoundingClientRect();
        const fill = getComputedStyle(surface).getPropertyValue("--glass-surface-fill").trim();
        const holes = fill && width && height ? controls
          .filter(({ button, bounds }) => !bounds.slider && next.has(button) && (
            (surface !== button && surface.contains(button)) || floatingButtons.some((floatingButton) => button === floatingButton)
          ))
          .map(({ button, bounds }) => {
            const rect = button.getBoundingClientRect();
            const radius = Math.min(bounds.radius * innerHeight, rect.width / 2, rect.height / 2);
            return `<rect x="${rect.left - left}" y="${rect.top - top}" width="${rect.width}" height="${rect.height}" rx="${radius}" fill="black"/>`;
          }).join("") : "";
        const image = holes && `url("data:image/svg+xml,${encodeURIComponent(
          `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none"><mask id="glass"><rect width="100%" height="100%" fill="white"/>${holes}</mask><rect width="100%" height="100%" fill="${fill}" mask="url(#glass)"/></svg>`,
        )}")`;
        if (surface.style.getPropertyValue("--glass-surface-image") !== image) {
          if (image) surface.style.setProperty("--glass-surface-image", image);
          else surface.style.removeProperty("--glass-surface-image");
        }
      }
      for (const button of painted) {
        if (!next.has(button)) {
          button.removeAttribute("data-native-glass");
          resize.unobserve(button);
          painted.delete(button);
        }
      }
      for (const button of next) {
        if (!painted.has(button)) {
          button.setAttribute("data-native-glass", "");
          resize.observe(button);
          painted.add(button);
        }
      }
      html.classList.toggle("has-vault-control-glass", next.size > 0);
      if (dirty) queue();
    }

    app.addEventListener(
      "transitionrun",
      onPassphraseTransition as EventListener,
    );
    function onFloatingAnimationEnd(event: AnimationEvent) {
      if (event.animationName === "editor-outside-button-in") queue();
    }
    function onFloatingTransition(event: TransitionEvent) {
      if (
        event.propertyName === "translate" &&
        event.target instanceof Element &&
        event.target.matches(".editor-outside-actions")
      ) queue();
    }
    document.body.addEventListener("animationend", onFloatingAnimationEnd);
    document.body.addEventListener("animationcancel", onFloatingAnimationEnd);
    document.body.addEventListener("transitionrun", onFloatingTransition);
    document.body.addEventListener("transitionend", onFloatingTransition);
    document.body.addEventListener("transitioncancel", onFloatingTransition);
    app.addEventListener(
      "transitionend",
      onPassphraseTransition as EventListener,
    );
    app.addEventListener(
      "transitioncancel",
      onPassphraseTransition as EventListener,
    );
    reduced.addEventListener("change", queue);
    app.addEventListener("pointerover", onExportHover);
    app.addEventListener("pointerout", onExportHover);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onWindowResize);
    window.addEventListener("focus", queue);
    window.addEventListener("blur", queue);
    queue();
    return () => {
      stopped = true;
      cancelAnimationFrame(frame);
      window.clearTimeout(resizeTimer);
      window.clearTimeout(scrollTimer);
      resize.disconnect();
      mutations.disconnect();
      document.body.removeEventListener("animationend", onFloatingAnimationEnd);
      document.body.removeEventListener("animationcancel", onFloatingAnimationEnd);
      document.body.removeEventListener("transitionrun", onFloatingTransition);
      document.body.removeEventListener("transitionend", onFloatingTransition);
      document.body.removeEventListener("transitioncancel", onFloatingTransition);
      app.removeEventListener(
        "transitionrun",
        onPassphraseTransition as EventListener,
      );
      app.removeEventListener(
        "transitionend",
        onPassphraseTransition as EventListener,
      );
      app.removeEventListener(
        "transitioncancel",
        onPassphraseTransition as EventListener,
      );
      reduced.removeEventListener("change", queue);
      app.removeEventListener("pointerover", onExportHover);
      app.removeEventListener("pointerout", onExportHover);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("focus", queue);
      window.removeEventListener("blur", queue);
      html.classList.remove("has-vault-control-glass");
      for (const button of painted) {
        button.removeAttribute("data-native-glass");
      }
    };
  }, []);
}
