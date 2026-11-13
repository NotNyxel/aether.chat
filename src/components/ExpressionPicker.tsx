/**
 * The expressions menu above the message box: Emoji, GIFs and Stickers in one place, with tabs.
 * The GIF, sticker and emoji buttons all open it (on their tab), so only one menu is ever open.
 */
import { EmojiPanel, FloatingPanel } from './EmojiPicker';
import { GifPanel, type Gif } from './GifPicker';
import { StickerPanel, type ServerSticker } from './Stickers';

export type ExpressionTab = 'emoji' | 'gif' | 'sticker';

const TABS: { id: ExpressionTab; label: string }[] = [
  { id: 'gif', label: 'GIFs' },
  { id: 'sticker', label: 'Stickers' },
  { id: 'emoji', label: 'Emoji' },
];

export function ExpressionPicker({
  tab,
  onTab,
  onClose,
  onEmoji,
  onGif,
  onSticker,
}: {
  tab: ExpressionTab;
  onTab: (t: ExpressionTab) => void;
  onClose: () => void;
  onEmoji: (emoji: string) => void;
  onGif: (g: Gif) => void;
  onSticker: (s: ServerSticker) => void;
}) {
  return (
    <FloatingPanel onClose={onClose} className="bottom-full right-0 mb-2" width="w-[min(420px,calc(100vw-16px))]" height="h-[min(480px,70vh)]">
      <div className="flex shrink-0 gap-1 border-b border-ae-border p-1.5" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => onTab(t.id)}
            className={`flex-1 rounded-md py-1.5 text-sm font-semibold transition-colors ${tab === t.id ? 'bg-ae-surface text-ae-text' : 'text-ae-muted hover:bg-ae-hover hover:text-ae-text'}`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'emoji' && <EmojiPanel allowCustom onPick={onEmoji} />}
      {tab === 'gif' && <GifPanel onPick={onGif} />}
      {tab === 'sticker' && <StickerPanel onPick={onSticker} />}
    </FloatingPanel>
  );
}
