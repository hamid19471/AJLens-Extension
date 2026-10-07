import { LOCALES, type Locale } from '../../shared/i18n';

export interface LanguageSelectorProps {
  value: Locale;
  onChange: (locale: Locale) => void;
  /** Accessible group label in the current interface language. */
  groupLabel: string;
  /** Header variant: short labels ("فارسی" / "EN") and compact sizing. */
  compact?: boolean;
}

/**
 * Persian/English interface-language switch. Each option is a toggle button exposing its
 * state through aria-pressed; labels are written (and announced) in their own language.
 */
export function LanguageSelector({
  value,
  onChange,
  groupLabel,
  compact = false,
}: LanguageSelectorProps) {
  return (
    <div
      className={`language-selector no-drag${compact ? ' language-selector--compact' : ''}`}
      role="group"
      aria-label={groupLabel}
      data-testid="language-selector"
    >
      {LOCALES.map((l) => (
        <button
          key={l.value}
          type="button"
          lang={l.value}
          aria-label={l.ariaLabel}
          aria-pressed={value === l.value}
          title={l.ariaLabel}
          className={value === l.value ? 'on' : ''}
          data-testid={`locale-${l.value}`}
          onClick={() => {
            if (value !== l.value) onChange(l.value);
          }}
        >
          {compact ? l.shortLabel : l.label}
        </button>
      ))}
    </div>
  );
}
