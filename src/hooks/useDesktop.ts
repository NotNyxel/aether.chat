/** App-level desktop behaviour: auto-idle, game activity, taskbar badge, tray, custom status expiry. */
import { useEffect, useState } from 'react';
import { idleSeconds, runningProcesses, setBadge, setCloseToTray } from '../lib/desktop';
import { detectGame } from '../lib/games';
import { isTauri } from '../lib/platform';
import { useSettingsStore } from '../stores/settingsStore';
import type { PresenceStatus, UserProfile } from '../types/db';
import { useUpdateProfile } from './useChatData';

/**
 * While your chosen status is Online, shows you as Idle after `autoIdleMinutes` without keyboard or
 * mouse input (system-wide on desktop). Your saved status is untouched; this only changes presence.
 */
export function useAutoIdle(status: PresenceStatus): PresenceStatus {
  const minutes = useSettingsStore((s) => s.system.autoIdleMinutes);
  const [idle, setIdle] = useState(false);
  useEffect(() => {
    if (status !== 'online' || minutes <= 0) {
      setIdle(false);
      return;
    }
    let stopped = false;
    const check = async () => {
      const secs = await idleSeconds().catch(() => 0);
      if (!stopped) setIdle(secs >= minutes * 60);
    };
    void check();
    const t = setInterval(() => void check(), 15_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [status, minutes]);
  return status === 'online' && idle ? 'idle' : status;
}

/** Opt-in "Playing …" detection (desktop only): polls running processes every 30 seconds. */
export function useGameActivity(): string | null {
  const { shareActivity, customGames } = useSettingsStore((s) => s.activity);
  const [game, setGame] = useState<string | null>(null);
  useEffect(() => {
    if (!shareActivity || !isTauri) {
      setGame(null);
      return;
    }
    let stopped = false;
    const scan = async () => {
      const procs = await runningProcesses().catch(() => []);
      if (!stopped) setGame(detectGame(procs, customGames));
    };
    void scan();
    const t = setInterval(() => void scan(), 30_000);
    return () => {
      stopped = true;
      clearInterval(t);
    };
  }, [shareActivity, customGames]);
  return game;
}

export function useTaskbarBadge(count: number): void {
  const enabled = useSettingsStore((s) => s.notifications.taskbarBadge);
  useEffect(() => {
    void setBadge(enabled ? count : 0);
  }, [count, enabled]);
}

export function useTraySync(): void {
  const closeToTray = useSettingsStore((s) => s.system.closeToTray);
  useEffect(() => {
    void setCloseToTray(closeToTray).catch(() => undefined);
  }, [closeToTray]);
}

/** The custom status, or null once it has expired. */
export function activeCustomStatus(p: Pick<UserProfile, 'custom_status' | 'custom_status_expires_at'> | null | undefined): string | null {
  if (!p?.custom_status) return null;
  if (p.custom_status_expires_at && Date.parse(p.custom_status_expires_at) <= Date.now()) return null;
  return p.custom_status;
}

/** Clears your own custom status when its timer runs out (others already hide it via activeCustomStatus). */
export function useCustomStatusExpiry(userId: string, me: UserProfile | null | undefined): void {
  const update = useUpdateProfile(userId);
  const { mutate } = update;
  const expires = me?.custom_status ? me.custom_status_expires_at : null;
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!expires) return;
    const ms = Date.parse(expires) - Date.now();
    const clear = () => mutate({ custom_status: null, status_emoji: null, custom_status_expires_at: null });
    if (ms <= 0) {
      clear();
      return;
    }
    // setTimeout overflows above ~24.8 days; re-check daily instead.
    const t = setTimeout(() => (Date.parse(expires) <= Date.now() ? clear() : setTick((n) => n + 1)), Math.min(ms, 86_400_000));
    return () => clearTimeout(t);
  }, [expires, mutate, tick]);
}
