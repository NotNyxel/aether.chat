/** "Translate" on a message (2.1): runs on this device (lib/ondevice.ts), shown under the original. */
import { useEffect, useState } from 'react';
import { currentLanguage, LANGUAGES, t } from '../lib/i18n';
import { canTranslateTo, SAME_LANGUAGE, translate } from '../lib/ondevice';

/** The language to translate into: the app's language (2-letter code). */
export function translateTarget(): string {
  const c = currentLanguage().slice(0, 2).toLowerCase();
  return /^[a-z]{2}$/.test(c) ? c : 'en';
}

export const canTranslate = () => canTranslateTo(translateTarget());

type State = { s: 'busy'; p: number | null } | { s: 'done'; text: string } | { s: 'same' } | { s: 'error'; msg: string };

export function TranslatedText({ text, onClose }: { text: string; onClose: () => void }) {
  const [state, setState] = useState<State>({ s: 'busy', p: null });
  const target = translateTarget();
  useEffect(() => {
    let gone = false;
    translate(text, target, (p) => !gone && setState({ s: 'busy', p }))
      .then((out) => !gone && setState({ s: 'done', text: out }))
      .catch((e: Error) => !gone && setState(e.message === SAME_LANGUAGE ? { s: 'same' } : { s: 'error', msg: e.message }));
    return () => {
      gone = true;
    };
  }, [text, target]);
  const name = LANGUAGES.find((l) => l.code === target)?.name ?? target;
  return (
    <div className="mt-1 max-w-prose rounded-ae border-l-2 border-ae-accent/60 bg-ae-surface/60 px-3 py-1.5" role="status">
      <p className="mb-0.5 flex items-center gap-2 text-[11px] font-semibold text-ae-muted">
        {state.s === 'busy'
          ? state.p !== null && state.p < 1
            ? t('Getting translation ready on this device… {n}%', { n: Math.round(state.p * 100) })
            : t('Translating…')
          : t('Translated to {lang} on this device', { lang: name })}
        <button type="button" onClick={onClose} className="ml-auto font-normal hover:text-ae-text hover:underline">
          {t('Hide')}
        </button>
      </p>
      {state.s === 'done' && <p className="text-[15px] leading-[1.375rem] whitespace-pre-wrap text-ae-text/95">{state.text}</p>}
      {state.s === 'same' && <p className="text-sm text-ae-muted">{t('This is already in {lang}.', { lang: name })}</p>}
      {state.s === 'error' && <p className="text-sm text-ae-danger">{state.msg}</p>}
    </div>
  );
}
