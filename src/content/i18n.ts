/** Interface locale for the panel's prompt actions. The generated prompt itself is always English. */
export type UiLocale = 'en' | 'fa';

export function detectLocale(language?: string | null): UiLocale {
  return (language ?? '').toLowerCase().startsWith('fa') ? 'fa' : 'en';
}

/** Browser UI language: chrome.i18n when available, otherwise navigator.language. */
export function browserLanguage(): string {
  try {
    if (typeof chrome !== 'undefined' && typeof chrome.i18n?.getUILanguage === 'function') {
      return chrome.i18n.getUILanguage();
    }
  } catch {
    // Context invalidated — fall back to the page's navigator.
  }
  return typeof navigator !== 'undefined' ? navigator.language : 'en';
}

export interface CopyStrings {
  copyLabel: string;
  copyAriaLabel: string;
  copied: string;
  copyFailed: string;
  preparing: string;
  modeDetailed: string;
  modeCompact: string;
}

export const COPY_STRINGS: Record<UiLocale, CopyStrings> = {
  en: {
    copyLabel: 'Copy full prompt',
    copyAriaLabel: 'Copy the complete reconstruction prompt to the clipboard',
    copied: 'Full prompt copied',
    copyFailed: 'Could not copy the prompt. Please try again.',
    preparing: 'Generating prompt…',
    modeDetailed: 'Detailed prompt',
    modeCompact: 'Compact prompt',
  },
  fa: {
    copyLabel: 'کپی کامل پرامپت',
    copyAriaLabel: 'کپی کامل پرامپت بازسازی در کلیپ‌بورد',
    copied: 'پرامپت کامل کپی شد',
    copyFailed: 'کپی پرامپت انجام نشد. دوباره تلاش کنید.',
    preparing: 'در حال ساخت پرامپت…',
    modeDetailed: 'پرامپت مفصل (Detailed)',
    modeCompact: 'پرامپت فشرده (Compact)',
  },
};
