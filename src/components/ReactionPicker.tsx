/**
 * Reaction picker for phones and tablets, opened from a message's press-and-hold menu. It lives at
 * the top of the app (not inside the message), so nothing in the chat can close it by accident.
 * Also: the quick-reaction emoji, which follow what you use most.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { quickReactions } from '../lib/emoji';
import { EmojiPicker } from './EmojiPicker';

const useReactionPicker = create<{ onPick: ((emoji: string) => void) | null }>()(() => ({ onPick: null }));

export function openReactionPicker(onPick: (emoji: string) => void): void {
  useReactionPicker.setState({ onPick });
}

export function ReactionPickerLayer() {
  const onPick = useReactionPicker((s) => s.onPick);
  if (!onPick) return null;
  const close = () => useReactionPicker.setState({ onPick: null });
  return (
    <EmojiPicker
      onClose={close}
      onPick={(e) => {
        close();
        onPick(e);
      }}
    />
  );
}

/** Your most-used emoji, updating as you use them. */
export function useQuickReactions(count: number): string[] {
  const [list, setList] = useState(() => quickReactions(count));
  useEffect(() => {
    const on = () => setList(quickReactions(count));
    window.addEventListener('aether-emoji-usage', on);
    return () => window.removeEventListener('aether-emoji-usage', on);
  }, [count]);
  return list;
}
