// Popup shown only when AJ Lens cannot run on the current tab. Persian unless English was chosen.
import { DEFAULT_LOCALE, dirFor, isLocale, messages, type MessageKey } from '../shared/i18n';

const params = new URLSearchParams(location.search);
const langParam = params.get('lang');
const locale = isLocale(langParam) ? langParam : DEFAULT_LOCALE;
const t = messages(locale);
const keyParam = params.get('key') ?? '';
const key: MessageKey = keyParam in t ? (keyParam as MessageKey) : 'restrictedBrowser';

document.documentElement.lang = locale;
document.documentElement.dir = dirFor(locale);
const set = (id: string, text: string) => {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
};
set('heading', t.noticeHeading);
set('reason', t[key]);
set('hint', t.noticeHint);
const detail = params.get('detail');
if (detail) set('detail', detail);
