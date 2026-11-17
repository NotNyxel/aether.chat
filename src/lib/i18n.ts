/**
 * Languages (2.0). `t('Friends')` returns the text in the chosen language, or the English text when
 * a translation is missing, so the app is always complete. The English text is the key, which keeps
 * call sites readable. `{name}`-style placeholders are filled from `vars`.
 *
 * The language is picked in Settings → Appearance → Language (or follows the device). Changing it
 * reloads the window, so nothing has to re-render live. Right-to-left languages flip the layout.
 */
export interface Language {
  code: string;
  /** The language's own name. */
  name: string;
  /** Its name in English, for search and the settings hint. */
  english: string;
  dir?: 'rtl';
}

export const LANGUAGES: Language[] = [
  { code: 'en', name: 'English', english: 'English' },
  { code: 'es', name: 'Español', english: 'Spanish' },
  { code: 'fr', name: 'Français', english: 'French' },
  { code: 'de', name: 'Deutsch', english: 'German' },
  { code: 'pt', name: 'Português (Brasil)', english: 'Portuguese' },
  { code: 'it', name: 'Italiano', english: 'Italian' },
  { code: 'tr', name: 'Türkçe', english: 'Turkish' },
  { code: 'ru', name: 'Русский', english: 'Russian' },
  { code: 'pl', name: 'Polski', english: 'Polish' },
  { code: 'id', name: 'Bahasa Indonesia', english: 'Indonesian' },
  { code: 'hi', name: 'हिन्दी', english: 'Hindi' },
  { code: 'ja', name: '日本語', english: 'Japanese' },
  { code: 'ar', name: 'العربية', english: 'Arabic', dir: 'rtl' },
  { code: 'ko', name: '한국어', english: 'Korean' },
  { code: 'zh', name: '简体中文', english: 'Chinese (Simplified)' },
  { code: 'vi', name: 'Tiếng Việt', english: 'Vietnamese' },
  { code: 'nl', name: 'Nederlands', english: 'Dutch' },
  { code: 'uk', name: 'Українська', english: 'Ukrainian' },
  { code: 'bn', name: 'বাংলা', english: 'Bengali' },
  { code: 'ur', name: 'اردو', english: 'Urdu', dir: 'rtl' },
];

const KEY = 'aether.lang';
type Dict = Record<string, string>;
let dict: Dict = {};
let current = 'en';

/** 'auto' (follow the device) or a language code. */
export function languageSetting(): string {
  try {
    return localStorage.getItem(KEY) ?? 'auto';
  } catch {
    return 'auto';
  }
}

function resolve(setting: string): string {
  if (setting !== 'auto' && LANGUAGES.some((l) => l.code === setting)) return setting;
  for (const tag of navigator.languages ?? [navigator.language]) {
    const base = tag.toLowerCase().split('-')[0]!;
    // Only Simplified Chinese is translated; Traditional (TW/HK/MO) keeps English unless picked.
    if (base === 'zh' && /^zh-(tw|hk|mo|hant)/i.test(tag)) continue;
    if (LANGUAGES.some((l) => l.code === base)) return base;
  }
  return 'en';
}

const loaders = import.meta.glob<{ default: Dict }>('../locales/*.ts');

/** Loads the chosen language before the app renders. Never throws: falls back to English. */
export async function loadLanguage(): Promise<void> {
  current = resolve(languageSetting());
  const lang = LANGUAGES.find((l) => l.code === current)!;
  document.documentElement.lang = current;
  document.documentElement.dir = lang.dir ?? 'ltr';
  if (current === 'en') return;
  try {
    const mod = await loaders[`../locales/${current}.ts`]?.();
    dict = mod?.default ?? {};
  } catch {
    dict = {};
  }
}

export function currentLanguage(): string {
  return current;
}

export function setLanguage(setting: string): void {
  try {
    localStorage.setItem(KEY, setting);
  } catch {
    /* can't remember it: still switch for now */
  }
  location.reload();
}

/** The text in the current language. */
export function t(text: string, vars?: Record<string, string | number>): string {
  let out = dict[text] ?? text;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}
