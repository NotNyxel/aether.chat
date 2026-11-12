/**
 * ThemeEngine: Aether's dynamic theming and custom CSS system.
 *
 * 1. Token engine: resolves the active preset plus the accent override (or profile accent) into
 *    `--ae-*` custom properties on <html>. All Tailwind `ae-*` utilities read those variables, so a
 *    theme switch is one style recalculation with no React re-render of the tree.
 *
 * 2. Custom CSS compiler (`compileScopedCss`): user CSS is
 *      a) size-capped and stripped of script-capable constructs (expression(), javascript:, bindings),
 *      b) parsed by the browser's own CSS parser (a constructable CSSStyleSheet, which drops @import
 *         and anything malformed),
 *      c) re-serialized with every style rule wrapped in `@scope (<root>)` so it cannot leak outside
 *         its container. @keyframes and @font-face are hoisted because they cannot live in @scope,
 *      d) url() scrubbed. App CSS may load https: and data:image. Profile CSS may only use
 *         data:image, so viewing someone's profile can never ping a tracking server with your IP.
 *
 * 3. App-level CSS is injected through a single adopted stylesheet (no <style> churn).
 *    Profile CSS is rendered by <ScopedCss> inside a container with `contain: layout paint style`,
 *    so even `position: fixed` stays clipped to the card.
 */
import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react';
import { useSettingsStore, type ThemeSettings } from '../stores/settingsStore';
import { isHexColor, readableTextOn, THEME_PRESETS, type ThemePresetId, type ThemeTokens } from '../theme/presets';

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Token resolution
// ─────────────────────────────────────────────────────────────────────────────────────────────

export function resolveTokens(theme: ThemeSettings, profileAccent: string | null): ThemeTokens {
  const preset = THEME_PRESETS[theme.presetId] ?? THEME_PRESETS['oled-dark'];
  const tokens: ThemeTokens = { ...preset.tokens };
  const accent =
    theme.useProfileAccent && isHexColor(profileAccent)
      ? profileAccent
      : isHexColor(theme.accentOverride)
        ? theme.accentOverride
        : null;
  if (accent) {
    tokens.accent = accent;
    tokens.accentContrast = readableTextOn(accent);
  }
  return tokens;
}

/** camelCase token key → `--ae-kebab-case` variable name. */
function cssVarName(key: string): string {
  return `--ae-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Custom CSS compiler
// ─────────────────────────────────────────────────────────────────────────────────────────────

export interface CompileOptions {
  /** Allow `url(https://…)`. Off for profile CSS (privacy: no remote fetches when viewing a profile). */
  allowRemoteUrls: boolean;
  maxBytes?: number;
}

export interface CompiledCss {
  css: string;
  ruleCount: number;
  truncated: boolean;
  error: string | null;
}

const SCRIPT_VECTORS = /expression\s*\(|javascript\s*:|vbscript\s*:|-moz-binding|behavior\s*:/gi;
const SAFE_DATA_IMAGE = /^data:image\/(?:png|gif|jpe?g|webp|avif|svg\+xml)[;,]/i;
const RESERVED_KEYFRAMES = /^ae-/i;

function scrubUrls(css: string, allowRemote: boolean): string {
  return css
    .replace(/url\(\s*(["']?)(.*?)\1\s*\)/gi, (_match, _quote: string, raw: string) => {
      const url = raw.trim();
      if (SAFE_DATA_IMAGE.test(url) || (allowRemote && /^https:\/\//i.test(url))) {
        return `url("${url.replace(/["\\\n]/g, (c) => encodeURIComponent(c))}")`;
      }
      return 'none';
    })
    .replace(/(?:-webkit-)?image-set\([^;{}]*\)/gi, 'none'); // image-set("…") fetches without url()
}

/** Sanitizes and scopes arbitrary user CSS to `scopeSelector`. Never throws. */
export function compileScopedCss(source: string, scopeSelector: string, options: CompileOptions): CompiledCss {
  const maxBytes = options.maxBytes ?? 32_768;
  const truncated = source.length > maxBytes;
  const input = (truncated ? source.slice(0, maxBytes) : source)
    .replace(SCRIPT_VECTORS, '')
    .replace(/@import[^;]*;?/gi, '');

  if (!input.trim()) return { css: '', ruleCount: 0, truncated, error: null };

  let rules: CSSRuleList;
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(input);
    rules = sheet.cssRules;
  } catch (err) {
    return { css: '', ruleCount: 0, truncated, error: err instanceof Error ? err.message : 'Invalid CSS' };
  }

  const hoisted: string[] = [];
  const scoped: string[] = [];
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSImportRule || rule instanceof CSSNamespaceRule) continue;
    if (rule instanceof CSSKeyframesRule) {
      if (!RESERVED_KEYFRAMES.test(rule.name)) hoisted.push(rule.cssText); // app animations are off-limits
      continue;
    }
    if (rule instanceof CSSFontFaceRule) {
      hoisted.push(rule.cssText);
      continue;
    }
    scoped.push(rule.cssText);
  }

  const parts = [...hoisted];
  if (scoped.length) parts.push(`@scope (${scopeSelector}) {\n${scoped.join('\n')}\n}`);
  return {
    css: scrubUrls(parts.join('\n'), options.allowRemoteUrls),
    ruleCount: hoisted.length + scoped.length,
    truncated,
    error: null,
  };
}

/** Owns one constructable stylesheet adopted into the document and keeps its text in sync. */
function useAdoptedStyleSheet(css: string): void {
  const sheetRef = useRef<CSSStyleSheet | null>(null);

  useLayoutEffect(() => {
    const sheet = new CSSStyleSheet();
    sheetRef.current = sheet;
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    return () => {
      document.adoptedStyleSheets = document.adoptedStyleSheets.filter((s) => s !== sheet);
      sheetRef.current = null;
    };
  }, []);

  useLayoutEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    try {
      sheet.replaceSync(css);
    } catch {
      sheet.replaceSync('');
    }
  }, [css]);
}

/** Renders sanitized, scoped CSS for an embedded container such as a profile card. */
export function ScopedCss({ css, scopeSelector }: { css: string | null | undefined; scopeSelector: string }) {
  const compiled = useMemo(
    () => compileScopedCss(css ?? '', scopeSelector, { allowRemoteUrls: false, maxBytes: 16_384 }),
    [css, scopeSelector],
  );
  return compiled.css ? <style>{compiled.css}</style> : null;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────────────────────────────────────────────────────

export const APP_SCOPE_SELECTOR = '[data-ae-scope="app"]';

interface ThemeContextValue {
  presetId: ThemePresetId;
  tokens: ThemeTokens;
  /** Result of compiling the user's app CSS (for diagnostics in Settings). */
  customCss: CompiledCss;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const theme = useSettingsStore((s) => s.theme);
  const profileAccent = useSettingsStore((s) => s.profileAccent);
  const tokens = useMemo(() => resolveTokens(theme, profileAccent), [theme, profileAccent]);

  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [key, value] of Object.entries(tokens)) root.style.setProperty(cssVarName(key), value);
    root.dataset.aeTheme = theme.presetId;
    root.dataset.aeReduceMotion = String(theme.reduceMotion);
    root.dataset.aeAmbient = String(theme.ambientBackground);
    root.dataset.aeAnimations = theme.animations;
    root.dataset.aeStatusAnim = String(theme.animateStatus);
    const light = !!THEME_PRESETS[theme.presetId]?.light;
    root.dataset.aeLight = String(light);
    root.style.colorScheme = light ? 'light' : 'dark';
  }, [tokens, theme.presetId, theme.reduceMotion, theme.ambientBackground, theme.animations, theme.animateStatus]);

  const customCss = useMemo(
    () =>
      theme.customCssEnabled
        ? compileScopedCss(theme.customCss, APP_SCOPE_SELECTOR, { allowRemoteUrls: true })
        : { css: '', ruleCount: 0, truncated: false, error: null },
    [theme.customCss, theme.customCssEnabled],
  );
  useAdoptedStyleSheet(customCss.css);

  const value = useMemo(() => ({ presetId: theme.presetId, tokens, customCss }), [theme.presetId, tokens, customCss]);

  return (
    <ThemeContext.Provider value={value}>
      <div data-ae-scope="app" className="contents">
        {children}
      </div>
    </ThemeContext.Provider>
  );
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used inside <ThemeProvider>');
  return ctx;
}
