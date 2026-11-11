/**
 * One floating tooltip for the whole app. Any element with `data-tip="text"` shows it on hover or
 * keyboard focus; `data-tip-side="right|top|bottom|left"` picks the side (default: top). It's
 * fixed-positioned, so scrolling containers (the server rail) never clip it. Plain `title`
 * attributes are adopted on first hover, so the whole app gets the same tooltips.
 */
import { useEffect, useState } from 'react';

interface Tip {
  text: string;
  x: number;
  y: number;
  side: 'right' | 'top' | 'bottom' | 'left';
}

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);

  useEffect(() => {
    let current: HTMLElement | null = null;
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text) return;
      current = el;
      const r = el.getBoundingClientRect();
      const side = (el.dataset.tipSide as Tip['side']) ?? 'top';
      const pos =
        side === 'right'
          ? { x: r.right + 12, y: r.top + r.height / 2 }
          : side === 'left'
            ? { x: r.left - 12, y: r.top + r.height / 2 }
            : side === 'bottom'
              ? { x: r.left + r.width / 2, y: r.bottom + 8 }
              : { x: r.left + r.width / 2, y: r.top - 8 };
      setTip({ text, side, ...pos });
    };
    const over = (e: Event) => {
      const el = (e.target as HTMLElement | null)?.closest?.('[data-tip],[title]') as HTMLElement | null;
      // Adopt native title tooltips so every tooltip looks the same (and appears instantly).
      let adopted = false;
      if (el?.hasAttribute('title') && el.tagName !== 'IFRAME') {
        adopted = true;
        const t = el.getAttribute('title') ?? '';
        el.removeAttribute('title');
        if (t) {
          el.dataset.tip = t;
          if (!el.getAttribute('aria-label') && !el.textContent?.trim()) el.setAttribute('aria-label', t);
        }
      }
      if (el && (el !== current || adopted)) show(el);
      else if (!el && current) {
        current = null;
        setTip(null);
      }
    };
    const hide = () => {
      current = null;
      setTip(null);
    };
    document.addEventListener('mouseover', over);
    document.addEventListener('focusin', over);
    document.addEventListener('mousedown', hide);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('mouseover', over);
      document.removeEventListener('focusin', over);
      document.removeEventListener('mousedown', hide);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
    };
  }, []);

  if (!tip) return null;
  const transform =
    tip.side === 'right' ? 'translate(0, -50%)' : tip.side === 'left' ? 'translate(-100%, -50%)' : tip.side === 'bottom' ? 'translate(-50%, 0)' : 'translate(-50%, -100%)';
  return (
    <div className="pointer-events-none fixed z-[90]" style={{ left: tip.x, top: tip.y, transform }}>
      <div className="ae-tooltip max-w-xs rounded-lg border border-ae-border bg-ae-elevated px-2.5 py-1.5 text-[13px] font-semibold text-ae-text shadow-xl">
        {tip.text}
      </div>
    </div>
  );
}
