import {
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useEffect,
  useRef,
  useState,
} from 'react';
import { Button } from './primitives';

export type SwipeRevealAction = 'archive' | 'delete';

export function SwipeReveal({
  action,
  actionLabel,
  itemName,
  showActionsLabel,
  hideActionsLabel,
  targetSelector,
  className = '',
  onAction,
  children,
}: {
  action: SwipeRevealAction;
  actionLabel: string;
  itemName: string;
  showActionsLabel: string;
  hideActionsLabel: string;
  targetSelector: string;
  className?: string;
  onAction: () => void;
  children: ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<{ x: number; y: number; pointerId: number } | null>(
    null,
  );
  const swipeConsumed = useRef(false);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    if (!revealed) return;
    function closeOnOutsidePointer(event: PointerEvent) {
      if (
        event.target instanceof Node &&
        !wrapperRef.current?.contains(event.target)
      ) {
        setRevealed(false);
      }
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () =>
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
  }, [revealed]);

  function beginSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const target = event.target;
    if (!(target instanceof Element) || !target.closest(targetSelector)) return;
    swipeStart.current = {
      x: event.clientX,
      y: event.clientY,
      pointerId: event.pointerId,
    };
  }

  function finishSwipe(event: ReactPointerEvent<HTMLDivElement>) {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (!start || start.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - start.x;
    const deltaY = event.clientY - start.y;
    if (Math.abs(deltaX) < 52 || Math.abs(deltaX) < Math.abs(deltaY) * 1.25)
      return;
    event.preventDefault();
    swipeConsumed.current = true;
    window.setTimeout(() => {
      swipeConsumed.current = false;
    }, 500);
    setRevealed(deltaX < 0);
  }

  function blockNavigationAfterSwipe(event: ReactMouseEvent<HTMLDivElement>) {
    if (!swipeConsumed.current) return;
    const target = event.target;
    if (target instanceof Element && target.closest(targetSelector)) {
      event.preventDefault();
      event.stopPropagation();
      swipeConsumed.current = false;
    }
  }

  function toggleActions() {
    if (revealed) {
      setRevealed(false);
      return;
    }
    setRevealed(true);
    window.requestAnimationFrame(() =>
      wrapperRef.current
        ?.querySelector<HTMLButtonElement>('.swipe-reveal-action-button')
        ?.focus(),
    );
  }

  return (
    <div
      ref={wrapperRef}
      className={`swipe-reveal ${className}`.trim()}
      data-revealed={revealed ? 'true' : 'false'}
      data-action={action}
      onPointerDown={beginSwipe}
      onPointerUp={finishSwipe}
      onPointerCancel={() => {
        swipeStart.current = null;
      }}
      onClickCapture={blockNavigationAfterSwipe}
    >
      <div className="swipe-reveal-main">{children}</div>
      <div className="swipe-reveal-keyboard-control">
        <Button
          variant="secondary"
          type="button"
          aria-expanded={revealed}
          aria-label={revealed ? hideActionsLabel : showActionsLabel}
          onClick={toggleActions}
        >
          {revealed ? hideActionsLabel : showActionsLabel}
        </Button>
      </div>
      <div
        className="swipe-reveal-actions"
        aria-hidden={!revealed}
        inert={!revealed}
      >
        <Button
          className={`swipe-reveal-action-button swipe-reveal-${action}`}
          type="button"
          aria-label={`${actionLabel}: ${itemName}`}
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      </div>
    </div>
  );
}
