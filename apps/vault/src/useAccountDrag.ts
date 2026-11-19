import { paintDeleteDropDots } from "./components/DeleteDropDots";
import {
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";

function targetAt(x: number, y: number): HTMLElement | null {
  const hit = document.elementFromPoint(x, y);
  const direct = hit?.closest<HTMLElement>("[data-account-drop]");
  if (direct) return direct;

  // Bridge gaps between adjacent profile buttons so the target ring follows
  // the pointer continuously while moving up or down the profile list.
  const list = hit?.closest(".profile-items");
  if (!list) return null;
  let nearest: HTMLElement | null = null;
  let distance = Infinity;
  for (const target of list.querySelectorAll<HTMLElement>(
    "[data-profile-drop-target]",
  )) {
    const bounds = target.getBoundingClientRect();
    const gap = Math.max(bounds.top - y, y - bounds.bottom, 0);
    if (gap < distance && gap <= 5 && x >= bounds.left && x <= bounds.right) {
      nearest = target;
      distance = gap;
    }
  }
  return nearest;
}

export function useAccountDrag(
  enabled: boolean,
  onDrop: (accountId: string, destination: string) => void,
) {
  const [draggedId, setDraggedId] = useState<string>();
  const [dropTarget, setDropTarget] = useState<string>();
  const card = useRef<HTMLDivElement>(null);
  const position = useRef({ x: 0, y: 0, tilt: 0 });
  const dispose = useRef<(() => void) | undefined>(undefined);
  const drop = useRef(onDrop);
  drop.current = onDrop;

  const paintCard = (element: HTMLDivElement | null) => {
    card.current = element;
    if (!element) return;
    const { x, y, tilt } = position.current;
    const left = Math.min(x + 12, window.innerWidth - element.offsetWidth - 8);
    const top = Math.min(y + 14, window.innerHeight - element.offsetHeight - 8);
    element.style.transform = `translate3d(${Math.max(8, left)}px, ${Math.max(8, top)}px, 0) rotate(${tilt}deg)`;
  };

  useEffect(() => {
    if (!enabled) dispose.current?.();
    return () => dispose.current?.();
  }, [enabled]);

  const start = (event: ReactPointerEvent<HTMLElement>, accountId: string) => {
    if (!enabled || !event.isPrimary || event.button !== 0 || dispose.current)
      return;
    event.preventDefault();
    const source = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startY = event.clientY;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    let dragging = false;
    let previousX = startX;
    let hovered: HTMLElement | null = null;
    let dotsFrame = 0;
    position.current = { x: startX, y: startY, tilt: 0 };
    source.setPointerCapture(pointerId);

    function move(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      const { clientX: x, clientY: y } = event;
      if (!dragging) {
        if (Math.hypot(x - startX, y - startY) < 4) return;
        dragging = true;
        setDraggedId(accountId);
      }
      position.current = {
        x,
        y,
        tilt: reduced.matches
          ? 0
          : Math.max(-5, Math.min(5, (x - previousX) * 0.3)),
      };
      previousX = x;
      paintCard(card.current);

      const target = targetAt(x, y);
      if (hovered !== target) {
        const previousDots = hovered?.querySelector<HTMLCanvasElement>(".account-delete-dots");
        if (previousDots) paintDeleteDropDots(previousDots);
        hovered = target;
        setDropTarget(target?.dataset.accountDrop);
      }
      cancelAnimationFrame(dotsFrame);
      if (target?.dataset.accountDrop === "delete" && !reduced.matches) {
        dotsFrame = requestAnimationFrame(() => {
          const canvas = target.querySelector<HTMLCanvasElement>(".account-delete-dots");
          if (canvas) paintDeleteDropDots(canvas, { x, y });
        });
      }
    }

    function clean() {
      cancelAnimationFrame(dotsFrame);
      source.removeEventListener("pointermove", move);
      source.removeEventListener("pointerup", release);
      source.removeEventListener("pointercancel", cancel);
      source.removeEventListener("lostpointercapture", cancel);
      window.removeEventListener("blur", clean);
      window.removeEventListener("keydown", keydown);
      if (source.hasPointerCapture(pointerId))
        source.releasePointerCapture(pointerId);
      dispose.current = undefined;
      setDraggedId(undefined);
      setDropTarget(undefined);
    }

    function release(event: PointerEvent) {
      if (event.pointerId !== pointerId) return;
      const destination = dragging
        ? targetAt(event.clientX, event.clientY)?.dataset.accountDrop
        : undefined;
      clean();
      if (destination) drop.current(accountId, destination);
    }

    function cancel(event: PointerEvent) {
      if (event.pointerId === pointerId) clean();
    }

    function keydown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      clean();
    }

    dispose.current = clean;
    source.addEventListener("pointermove", move);
    source.addEventListener("pointerup", release);
    source.addEventListener("pointercancel", cancel);
    source.addEventListener("lostpointercapture", cancel);
    window.addEventListener("blur", clean);
    window.addEventListener("keydown", keydown);
  };

  return { draggedId, dropTarget, start, paintCard };
}
