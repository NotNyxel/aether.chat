/** The moving background effect of a custom theme (stars, snow, petals…), drawn behind the app. */
import { useMemo, type CSSProperties } from 'react';
import { DEFAULT_CUSTOM_THEME, useSettingsStore } from '../stores/settingsStore';

function rand(seed: number) {
  const x = Math.sin(seed * 9301 + 49297) * 233280;
  return x - Math.floor(x);
}

export function ThemeEffectLayer() {
  const custom = useSettingsStore((s) => s.theme.custom);
  const c = { ...DEFAULT_CUSTOM_THEME, ...(custom ?? {}) };
  const on = !!custom?.enabled && c.effect !== 'none';
  const count = Math.round(8 + (c.effectAmount / 100) * (c.effect === 'rain' ? 70 : c.effect === 'aurora' ? 0 : 52));
  const tint = c.colors[0] ?? '#ffffff';
  const parts = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: rand(i + 1) * 100,
        top: rand(i + 101) * 100,
        size: rand(i + 201),
        delay: rand(i + 301) * -20,
        dur: 0.6 + rand(i + 401) * 0.9,
        drift: rand(i + 501) * 2 - 1,
      })),
    [count],
  );
  if (!on) return null;
  return (
    <div className="ae-theme-fx" data-fx={c.effect} aria-hidden style={{ '--fx-tint': tint, '--fx-tint2': c.colors[1] ?? tint } as CSSProperties}>
      {c.effect === 'aurora' ? (
        <>
          <span className="ae-fx-blob" style={{ left: '-10%', top: '-20%' }} />
          <span className="ae-fx-blob" style={{ left: '45%', top: '10%', animationDelay: '-8s' }} />
          <span className="ae-fx-blob" style={{ left: '10%', top: '55%', animationDelay: '-15s' }} />
        </>
      ) : (
        parts.map((p, i) => (
          <i
            key={i}
            style={
              {
                left: `${p.left}%`,
                top: `${p.top}%`,
                '--s': p.size,
                '--d': p.dur,
                '--x': p.drift,
                animationDelay: `${p.delay}s`,
              } as CSSProperties
            }
          />
        ))
      )}
    </div>
  );
}
