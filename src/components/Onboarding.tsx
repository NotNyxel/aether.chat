/**
 * Server onboarding: the welcome screen new members see the first time they open a server with it
 * turned on (Server Settings → Community → Onboarding). Welcome message, the rules to accept, and
 * roles they can pick themselves. "Pick your roles" in the server menu opens it again later.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useServerMembers } from '../hooks/useChatData';
import { useMemberRoles, useServerRoles } from '../hooks/useServerAdmin';
import { Markdown } from '../lib/markdown';
import { useSupabase } from '../lib/supabase';
import type { Server } from '../types/db';
import { CheckIcon } from './icons';
import { toast } from './Toaster';

/** Opens the welcome screen again (server menu → Pick your roles). */
export function openOnboarding(serverId: string) {
  window.dispatchEvent(new CustomEvent('aether-onboarding', { detail: serverId }));
}

export function OnboardingGate({ server, userId }: { server: Server; userId: string }) {
  const sb = useSupabase();
  const qc = useQueryClient();
  const { data: members = [] } = useServerMembers(server.id);
  const { data: roles = [] } = useServerRoles(server.id);
  const { data: memberRoles = [] } = useMemberRoles(server.id);
  const me = members.find((m) => m.user_id === userId);
  const [forced, setForced] = useState(false);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const on = (e: Event) => (e as CustomEvent<string>).detail === server.id && setForced(true);
    window.addEventListener('aether-onboarding', on);
    return () => window.removeEventListener('aether-onboarding', on);
  }, [server.id]);

  const pickable = roles.filter((r) => r.self_assignable && !r.is_default).sort((a, b) => b.position - a.position);
  const mine = new Set(memberRoles.filter((m) => m.user_id === userId).map((m) => m.role_id));
  const show = !!me && (forced || (!!server.onboarding_enabled && !me.onboarded_at && server.owner_id !== userId));
  useEffect(() => {
    if (show && picked === null) setPicked(new Set(pickable.filter((r) => mine.has(r.id)).map((r) => r.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [show, roles.length]);
  if (!show) return null;

  const rules = server.rules?.trim();
  const finish = async () => {
    if (rules && !agreed && !me?.onboarded_at) return toast.error('Please read and accept the rules first.');
    setBusy(true);
    const { error } = await sb.rpc('complete_onboarding', { p_server_id: server.id, p_role_ids: [...(picked ?? [])] });
    setBusy(false);
    if (error) return toast.error(error.message);
    setForced(false);
    void qc.invalidateQueries({ queryKey: ['server-members', server.id] });
    void qc.invalidateQueries({ queryKey: ['member-roles', server.id] });
    toast.success(`Welcome to ${server.name}!`);
  };

  return (
    <div className="ae-backdrop fixed inset-0 z-[60] grid place-items-center bg-black/70 p-3" role="dialog" aria-modal="true" aria-label={`Welcome to ${server.name}`}>
      <div className="ae-dialog ae-scroll flex max-h-[min(720px,calc(100dvh-24px))] w-full max-w-[560px] flex-col overflow-y-auto rounded-[calc(var(--ae-radius)+6px)] border border-ae-border bg-ae-elevated shadow-2xl">
        <div className="relative h-28 shrink-0 bg-gradient-to-br from-ae-accent/60 to-ae-accent/10">
          {server.banner_url && <img src={server.banner_url} alt="" className="h-full w-full object-cover" />}
          <div className="absolute -bottom-8 left-6 grid h-16 w-16 place-items-center overflow-hidden rounded-2xl border-4 border-ae-elevated bg-ae-surface text-xl font-bold">
            {server.icon_url ? <img src={server.icon_url} alt="" className="h-full w-full object-cover" /> : server.name.slice(0, 2)}
          </div>
        </div>
        <div className="space-y-5 px-6 pt-11 pb-6">
          <div>
            <h2 className="text-2xl font-extrabold">Welcome to {server.name}</h2>
            {server.welcome_message ? (
              <Markdown source={server.welcome_message.replace(/\{user\}|@user/g, 'you')} className="mt-1 text-sm text-ae-muted" />
            ) : (
              server.description && <p className="mt-1 text-sm text-ae-muted">{server.description}</p>
            )}
          </div>

          {pickable.length > 0 && (
            <section>
              <h3 className="mb-2 font-semibold">{server.onboarding_prompt || 'Pick your roles'}</h3>
              <div className="flex flex-wrap gap-2">
                {pickable.map((r) => {
                  const on = picked?.has(r.id) ?? false;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() =>
                        setPicked((cur) => {
                          const next = new Set(cur ?? []);
                          if (next.has(r.id)) next.delete(r.id);
                          else next.add(r.id);
                          return next;
                        })
                      }
                      className={`ae-press flex items-center gap-2 rounded-full border px-3.5 py-2 text-sm ${on ? 'border-ae-accent bg-ae-accent/15 font-semibold' : 'border-ae-border hover:border-ae-text/30'}`}
                    >
                      <span className="h-3 w-3 rounded-full" style={{ background: r.color ?? 'var(--ae-text-muted)' }} />
                      {r.name}
                      {on && <CheckIcon size={14} />}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {rules && (
            <section>
              <h3 className="mb-2 font-semibold">Server rules</h3>
              <div className="max-h-56 overflow-y-auto rounded-ae bg-ae-sunken p-3 text-sm">
                <Markdown source={rules} />
              </div>
              {!me?.onboarded_at && (
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
                  <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} />
                  I've read and agree to the rules
                </label>
              )}
            </section>
          )}

          <div className="flex justify-end gap-2">
            {me?.onboarded_at && (
              <button type="button" className="rounded-ae px-4 py-2 text-sm hover:bg-ae-hover" onClick={() => setForced(false)}>
                Cancel
              </button>
            )}
            <button
              type="button"
              disabled={busy || (!!rules && !agreed && !me?.onboarded_at)}
              className="ae-press rounded-ae bg-ae-accent px-5 py-2 text-sm font-bold text-ae-on-accent disabled:opacity-40"
              onClick={() => void finish()}
            >
              {me?.onboarded_at ? 'Save' : 'Start chatting'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
