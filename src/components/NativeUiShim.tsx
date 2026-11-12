/**
 * Replaces what's left of the browser's own UI:
 *   - the right-click menu (text boxes get Undo/Redo/Cut/Copy/Paste/Select all/Emoji; selections
 *     get Copy; links get Open/Copy; images get Open/Copy link; anywhere else, nothing),
 *   - browser shortcuts that would open built-in UI (print, find bar, history, downloads…),
 *   - slider fill colour (sets --fill on every range input so the track shows progress).
 */
import { useEffect, useState } from 'react';
import { isTauri, openExternal } from '../lib/platform';
import { useUiStore } from '../stores/uiStore';
import { openContextMenu } from './ContextMenu';
import { EmojiPicker } from './EmojiPicker';
import { ColorPopover, DateTimePopover, SelectPopover } from './NativePickers';
import { CopyIcon, CutIcon, EmojiIcon, ExternalLinkIcon, ImageIcon, LinkIcon, PasteIcon, RedoIcon, SelectAllIcon, UndoIcon } from './icons';
import { toast } from './Toaster';

type Editable = HTMLInputElement | HTMLTextAreaElement | HTMLElement;

function isEditable(el: Element | null): el is Editable {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return /^(text|search|email|url|password|number|tel|)$/.test(el.type) && !el.readOnly && !el.disabled;
  return (el as HTMLElement).isContentEditable;
}

function insertText(target: Editable, text: string) {
  target.focus();
  // execCommand keeps the field's undo history and fires React's onChange.
  if (!document.execCommand('insertText', false, text)) {
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
      const { selectionStart: a = target.value.length, selectionEnd: b = target.value.length } = target;
      target.setRangeText(text, a ?? 0, b ?? 0, 'end');
      target.dispatchEvent(new Event('input', { bubbles: true }));
    }
  }
}

function fillRange(el: HTMLInputElement) {
  const min = Number(el.min || 0);
  const max = Number(el.max || 100);
  const pct = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty('--fill', `${pct}%`);
}

export function NativeUiShim() {
  const [emojiFor, setEmojiFor] = useState<{ target: Editable; x: number; y: number } | null>(null);
  const [picker, setPicker] = useState<{ kind: 'select'; el: HTMLSelectElement } | { kind: 'color' | 'date'; el: HTMLInputElement } | null>(null);

  // <select>, colour and date inputs open our popovers instead of the browser's.
  useEffect(() => {
    const target = (e: Event) => (e.target as HTMLElement | null)?.closest?.('select, input[type="color"], input[type="date"], input[type="datetime-local"], input[type="time"]') as
      | HTMLSelectElement
      | HTMLInputElement
      | null;
    const open = (el: HTMLSelectElement | HTMLInputElement) => {
      if (el.disabled) return;
      if (el instanceof HTMLSelectElement) setPicker({ kind: 'select', el });
      else setPicker({ kind: el.type === 'color' ? 'color' : 'date', el });
    };
    const down = (e: MouseEvent) => {
      const el = target(e);
      if (!el || e.button !== 0) return;
      e.preventDefault();
      el.focus();
      open(el);
    };
    const click = (e: MouseEvent) => {
      // colour/date inputs open on click (mousedown is already handled), so swallow it
      if (target(e)) e.preventDefault();
    };
    const key = (e: KeyboardEvent) => {
      const el = target(e);
      if (!el) return;
      if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown') || e.key === 'F4') {
        e.preventDefault();
        open(el);
      }
    };
    document.addEventListener('mousedown', down, true);
    document.addEventListener('click', click, true);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down, true);
      document.removeEventListener('click', click, true);
      document.removeEventListener('keydown', key, true);
    };
  }, []);
  const openLightbox = useUiStore((s) => s.openLightbox);

  // Slider fill
  useEffect(() => {
    const all = () => document.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach(fillRange);
    const onInput = (e: Event) => {
      const t = e.target as HTMLInputElement;
      if (t?.type === 'range') fillRange(t);
    };
    document.addEventListener('input', onInput, true);
    let raf = 0;
    const mo = new MutationObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(all);
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['value'] });
    all();
    return () => {
      document.removeEventListener('input', onInput, true);
      mo.disconnect();
    };
  }, []);

  // Right-click menu
  useEffect(() => {
    const onContext = (e: MouseEvent) => {
      if (e.defaultPrevented) return; // one of our own menus handled it
      e.preventDefault();
      const target = e.target as HTMLElement;
      const editable = target.closest('input, textarea, [contenteditable="true"]');
      const selection = window.getSelection()?.toString() ?? '';

      if (isEditable(editable)) {
        const el = editable;
        const hasSel = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.selectionStart !== el.selectionEnd : !!selection;
        const isPassword = el instanceof HTMLInputElement && el.type === 'password';
        openContextMenu(e, [
          { label: 'Undo', icon: <UndoIcon size={15} />, hint: 'Ctrl+Z', onClick: () => (el.focus(), document.execCommand('undo')) },
          { label: 'Redo', icon: <RedoIcon size={15} />, hint: 'Ctrl+Y', onClick: () => (el.focus(), document.execCommand('redo')) },
          'divider',
          { label: 'Cut', icon: <CutIcon size={15} />, hint: 'Ctrl+X', disabled: !hasSel || isPassword, onClick: () => (el.focus(), document.execCommand('cut')) },
          { label: 'Copy', icon: <CopyIcon size={15} />, hint: 'Ctrl+C', disabled: !hasSel || isPassword, onClick: () => (el.focus(), document.execCommand('copy')) },
          {
            label: 'Paste',
            icon: <PasteIcon size={15} />,
            hint: 'Ctrl+V',
            onClick: () =>
              void navigator.clipboard.readText().then(
                (t) => insertText(el, t),
                () => toast.error('Clipboard access was blocked. Use Ctrl+V.'),
              ),
          },
          {
            label: 'Select all',
            icon: <SelectAllIcon size={15} />,
            hint: 'Ctrl+A',
            onClick: () => {
              el.focus();
              if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) el.select();
              else document.execCommand('selectAll');
            },
          },
          !isPassword && 'divider',
          !isPassword && { label: 'Emoji', icon: <EmojiIcon size={15} />, onClick: () => setEmojiFor({ target: el, x: e.clientX, y: e.clientY }) },
        ]);
        return;
      }

      const link = target.closest('a[href]') as HTMLAnchorElement | null;
      const img = target.closest('img') as HTMLImageElement | null;
      openContextMenu(e, [
        selection && { label: 'Copy', icon: <CopyIcon size={15} />, hint: 'Ctrl+C', onClick: () => void navigator.clipboard.writeText(selection) },
        link && /^https?:/i.test(link.href) && { label: 'Open link', icon: <ExternalLinkIcon size={15} />, onClick: () => void openExternal(link.href) },
        link && { label: 'Copy link', icon: <LinkIcon size={15} />, onClick: () => void navigator.clipboard.writeText(link.href).then(() => toast('Link copied')) },
        img && img.src.startsWith('http') && { label: 'Open image', icon: <ImageIcon size={15} />, onClick: () => openLightbox({ url: img.src, alt: img.alt }) },
        img && img.src.startsWith('http') && { label: 'Copy image link', icon: <LinkIcon size={15} />, onClick: () => void navigator.clipboard.writeText(img.src).then(() => toast('Link copied')) },
      ]);
    };
    document.addEventListener('contextmenu', onContext);
    return () => document.removeEventListener('contextmenu', onContext);
  }, [openLightbox]);

  // Browser shortcuts that would open built-in UI.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;
      const blocked =
        (ctrl && ['p', 'f', 'g', 'h', 'j', 'u', 's', 'o', 'n', 't'].includes(k) && !e.altKey) ||
        (ctrl && e.shiftKey && ['i', 'j', 'c', 'o', 'delete'].includes(k) && !import.meta.env.DEV) ||
        ['f3', 'f7', 'f12'].includes(k) && !import.meta.env.DEV ||
        (isTauri && (k === 'f5' || (ctrl && k === 'r')) && !import.meta.env.DEV);
      if (blocked) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (picker) {
    const close = () => setPicker(null);
    if (picker.kind === 'select') return <SelectPopover el={picker.el} onClose={close} />;
    if (picker.kind === 'color') return <ColorPopover el={picker.el} onClose={close} />;
    return <DateTimePopover el={picker.el} onClose={close} />;
  }
  if (!emojiFor) return null;
  const left = Math.min(emojiFor.x, window.innerWidth - 360);
  const top = Math.min(emojiFor.y, window.innerHeight - 440);
  return (
    <div className="fixed z-[86]" style={{ left, top }}>
      <EmojiPicker
        className="top-0 left-0"
        onClose={() => setEmojiFor(null)}
        onPick={(emoji) => {
          insertText(emojiFor.target, emoji);
          setEmojiFor(null);
        }}
      />
    </div>
  );
}
