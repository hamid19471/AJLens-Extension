/**
 * AJ Lens interface strings. Persian is the default interface language; English is used
 * only when the user selects it. Generated reconstruction prompts are never translated.
 */
export type Locale = 'fa' | 'en';

export const DEFAULT_LOCALE: Locale = 'fa';
export const LOCALES: { value: Locale; label: string }[] = [
  { value: 'fa', label: 'فارسی' },
  { value: 'en', label: 'English' },
];

export function isLocale(value: unknown): value is Locale {
  return value === 'fa' || value === 'en';
}

const en = {
  // Panel chrome
  panelRegion: 'AJ Lens inspector',
  dragToMove: 'Drag to move',
  minimizePanel: 'Minimize panel',
  expandPanel: 'Expand panel',
  closePanel: 'Close AJ Lens',
  dismissMessage: 'Dismiss message',
  // Inspector state
  inspectorActive: 'Inspector active',
  sectionLocked: 'Section locked',
  tagline: 'Point. Capture. Rebuild.',
  description:
    'Hover over a section to generate its prompt. Click the page to lock it and capture a reference.',
  // Selection information
  selectedSection: 'Selected section',
  noSectionSelected: 'No section selected — move the pointer over the page.',
  elementsUnit: 'elements',
  assetsUnit: 'assets',
  assetsEstimated: 'Estimated until the section is locked',
  // Selection controls
  parent: 'Parent',
  smaller: 'Smaller',
  pickAnother: 'Pick another',
  lockSection: 'Lock section',
  unlockSection: 'Unlock section',
  refresh: 'Refresh',
  refreshMeasurement: 'Refresh measurement',
  selectionControls: 'Selection controls',
  // Partial capture dialog
  partialCaptureGroup: 'Partial capture options',
  partialOutside: 'The selected section is partially outside the viewport.',
  partialVisible: 'Only {percent}% is currently visible.',
  captureVisible: 'Capture visible area',
  captureScroll: 'Scroll into view and capture',
  cancel: 'Cancel',
  overlayLocked: 'Locked',
  // Settings
  language: 'Language',
  buildWith: 'Build with',
  buildExisting: 'Follow the existing project stack',
  buildCustom: 'Custom instructions',
  customInstructionsLabel: 'Custom build instructions',
  customPlaceholder:
    'e.g. Use our <Card> component, Tailwind tokens from theme.ts, and put it in src/sections/',
  // Prompt area
  reconstructionPrompt: 'Reconstruction prompt',
  characters: 'characters',
  promptDetail: 'Prompt detail',
  detailed: 'Detailed',
  compact: 'Compact',
  analysisProgress: 'Analysis progress',
  promptPlaceholderIdle: 'Lock a section to generate its reconstruction prompt.',
  promptPlaceholderBusy: 'Analyzing…',
  promptPreview: 'Generated reconstruction prompt (English)',
  referenceAlt: 'Captured reference, {width} by {height} pixels',
  copyFullPrompt: 'Copy full prompt',
  copyFullPromptAria: 'Copy the complete reconstruction prompt to the clipboard',
  fullPromptCopied: 'Full prompt copied',
  copyFailed: 'Could not copy the prompt. Please try again.',
  generatingPrompt: 'Generating prompt…',
  modeDetailed: 'Detailed prompt',
  modeCompact: 'Compact prompt',
  savePrompt: 'Save prompt.md',
  saveReference: 'Save reference.png',
  saveAnalysis: 'Save analysis.json',
  // Include section
  includeInPrompt: 'Include in prompt',
  includeVisibleText: 'Visible text',
  includeAssetUrls: 'Asset URLs',
  includeDomSummary: 'DOM summary',
  includeCssEvidence: 'CSS evidence',
  includeAccessibility: 'Accessibility',
  includeInteractions: 'Interactions',
  includeResponsive: 'Responsive evidence',
  includeCustomProperties: 'CSS custom properties',
  // Progress
  stageMeasuring: 'Measuring selected section…',
  stageLayout: 'Analyzing layout…',
  stageTypography: 'Collecting typography…',
  stageAssets: 'Detecting assets…',
  stageResponsive: 'Inspecting responsive rules…',
  stageCapturing: 'Capturing visible reference…',
  stageClassifying: 'Classifying section…',
  stagePrompt: 'Generating reconstruction prompt…',
  stageReady: 'Ready',
  // Footer
  footerEsc: 'Esc closes',
  footerArrows: '↑/↓ changes selection',
  footerClick: 'Click locks',
  footerPrivate: 'Measured locally. Nothing is uploaded.',
  // Notices
  errorDetail: 'Details',
  runtimeUnavailable:
    'Extension runtime unavailable — screenshots and downloads may not work. Reload the page if AJ Lens was updated.',
  elementRemoved:
    'The selected element was removed from the page (the site re-rendered it). Hover and select it again.',
  crossOriginIframe:
    'Cross-origin iframe: its contents belong to another site and cannot be inspected. You can still capture its outer box.',
  noCandidate: 'No meaningful section under the pointer. Move over a visible region and try again.',
  noParent: 'No larger meaningful parent — this is the outermost region.',
  noChild: 'No smaller meaningful child inside this section.',
  analysisFailed: 'Analysis failed.',
  captureFailed: 'The reference screenshot could not be captured.',
  partialReference: 'reference.png only contains the part of the section that was visible.',
  oversizedSelection:
    'Oversized selection: analysis was capped. Consider selecting a smaller section.',
  inaccessibleStylesheets:
    '{count} cross-origin stylesheet(s) could not be read; some media queries and variables are missing.',
  downloadFailed: 'Download failed.',
  storageFailed: 'Your settings could not be saved. They will apply until the panel is closed.',
  // Screen-reader announcements
  announceActive: 'AJ Lens inspector active. Hover over a section.',
  announceHoverFirst: 'Hover over a section first.',
  announceSelected: 'Selected {selector}.',
  announceLocked: 'Locked {selector}.',
  announceUnlocked: 'Selection unlocked. Hover over a section.',
  announcePickAnother: 'Pick another section: hover and click to lock.',
  announceRefreshed: 'Measurement refreshed.',
  announceReady: 'Ready. Prompt generated with {count} characters.',
  announcePartial:
    'Only {percent}% of the section is visible. Choose how to capture the reference.',
  announceSaved: 'Saved {file}.',
  announceLanguage: 'Interface language: English.',
  // Service worker and notice popup
  titleActive: 'AJ Lens — inspector active',
  titleIdle: 'AJ Lens',
  restrictedBrowser:
    'AJ Lens cannot run on internal browser pages or the Chrome Web Store. Open a regular website and try again.',
  restrictedExtension:
    'AJ Lens cannot run on extension pages. Open a regular website and try again.',
  restrictedData:
    'AJ Lens cannot run on data: or blob: pages. Open a regular website and try again.',
  injectFileAccess:
    'Enable "Allow access to file URLs" for AJ Lens in chrome://extensions to inspect local files.',
  injectFailed: 'AJ Lens could not be injected into this page.',
  noResponse: 'The page did not respond. Reload the tab and try again.',
  noticeHeading: 'Unavailable on this page',
  noticeHint: 'Open a regular website (http/https) and click the toolbar icon again.',
};

export type MessageKey = keyof typeof en;
export type Messages = Record<MessageKey, string>;

const fa: Messages = {
  panelRegion: 'بازرس AJ Lens',
  dragToMove: 'برای جابه‌جایی بکشید',
  minimizePanel: 'کوچک‌کردن پنل',
  expandPanel: 'بازکردن پنل',
  closePanel: 'بستن AJ Lens',
  dismissMessage: 'بستن پیام',
  inspectorActive: 'بازرس فعال است',
  sectionLocked: 'بخش قفل شده است',
  tagline: 'انتخاب کنید، ثبت کنید، بازسازی کنید.',
  description:
    'نشانگر را روی یک بخش ببرید تا پرامپت آن تولید شود. برای قفل‌کردن بخش و ثبت تصویر مرجع، روی صفحه کلیک کنید.',
  selectedSection: 'بخش انتخاب‌شده',
  noSectionSelected: 'بخشی انتخاب نشده است — نشانگر را روی صفحه ببرید.',
  elementsUnit: 'عنصر',
  assetsUnit: 'فایل',
  assetsEstimated: 'تا پیش از قفل‌کردن بخش، تخمینی است',
  parent: 'والد',
  smaller: 'بخش کوچک‌تر',
  pickAnother: 'انتخاب بخش دیگر',
  lockSection: 'قفل‌کردن بخش',
  unlockSection: 'بازکردن قفل',
  refresh: 'اندازه‌گیری دوباره',
  refreshMeasurement: 'اندازه‌گیری دوباره',
  selectionControls: 'کنترل‌های انتخاب',
  partialCaptureGroup: 'گزینه‌های ثبت بخشی از تصویر',
  partialOutside: 'بخشی از ناحیه انتخاب‌شده خارج از محدوده قابل مشاهده است.',
  partialVisible: 'اکنون تنها {percent}٪ از آن قابل مشاهده است.',
  captureVisible: 'ثبت بخش قابل مشاهده',
  captureScroll: 'نمایش کامل بخش و ثبت تصویر',
  cancel: 'انصراف',
  overlayLocked: 'قفل‌شده',
  language: 'زبان',
  buildWith: 'فناوری ساخت',
  buildExisting: 'پیروی از فناوری‌های موجود پروژه',
  buildCustom: 'دستورهای سفارشی',
  customInstructionsLabel: 'دستورهای سفارشی ساخت',
  customPlaceholder:
    'مثلاً: از کامپوننت <Card> و توکن‌های theme.ts استفاده کن و فایل را در src/sections/ قرار بده',
  reconstructionPrompt: 'پرامپت بازسازی',
  characters: 'نویسه',
  promptDetail: 'میزان جزئیات پرامپت',
  detailed: 'کامل',
  compact: 'خلاصه',
  analysisProgress: 'پیشرفت تحلیل',
  promptPlaceholderIdle: 'برای تولید پرامپت بازسازی، یک بخش را قفل کنید.',
  promptPlaceholderBusy: 'در حال تحلیل…',
  promptPreview: 'پرامپت بازسازی تولیدشده (انگلیسی)',
  referenceAlt: 'تصویر مرجع ثبت‌شده، {width} در {height} پیکسل',
  copyFullPrompt: 'کپی کامل پرامپت',
  copyFullPromptAria: 'کپی کامل پرامپت بازسازی در کلیپ‌بورد',
  fullPromptCopied: 'پرامپت کامل کپی شد',
  copyFailed: 'کپی پرامپت انجام نشد. دوباره تلاش کنید.',
  generatingPrompt: 'در حال تولید پرامپت…',
  modeDetailed: 'پرامپت کامل',
  modeCompact: 'پرامپت خلاصه',
  savePrompt: 'ذخیره prompt.md',
  saveReference: 'ذخیره reference.png',
  saveAnalysis: 'ذخیره analysis.json',
  includeInPrompt: 'موارد موجود در پرامپت',
  includeVisibleText: 'متن قابل مشاهده',
  includeAssetUrls: 'آدرس فایل‌ها',
  includeDomSummary: 'خلاصه ساختار DOM',
  includeCssEvidence: 'اطلاعات CSS',
  includeAccessibility: 'دسترس‌پذیری',
  includeInteractions: 'تعاملات',
  includeResponsive: 'اطلاعات واکنش‌گرایی',
  includeCustomProperties: 'متغیرهای سفارشی CSS',
  stageMeasuring: 'در حال اندازه‌گیری بخش انتخاب‌شده…',
  stageLayout: 'در حال تحلیل چیدمان…',
  stageTypography: 'در حال بررسی تایپوگرافی…',
  stageAssets: 'در حال شناسایی فایل‌ها و تصاویر…',
  stageResponsive: 'در حال بررسی قواعد واکنش‌گرا…',
  stageCapturing: 'در حال ثبت تصویر مرجع…',
  stageClassifying: 'در حال تشخیص نوع بخش…',
  stagePrompt: 'در حال تولید پرامپت بازسازی…',
  stageReady: 'آماده',
  footerEsc: 'Esc: بستن',
  footerArrows: '↑/↓: تغییر انتخاب',
  footerClick: 'کلیک: قفل‌کردن',
  footerPrivate: 'اندازه‌گیری به‌صورت محلی انجام می‌شود و هیچ داده‌ای بارگذاری نمی‌شود.',
  errorDetail: 'جزئیات',
  runtimeUnavailable:
    'ارتباط با افزونه برقرار نیست؛ ممکن است ثبت تصویر و دانلود کار نکند. اگر AJ Lens به‌روزرسانی شده است، صفحه را دوباره بارگذاری کنید.',
  elementRemoved:
    'عنصر انتخاب‌شده از صفحه حذف شد (سایت آن را دوباره ساخته است). دوباره نشانگر را روی آن ببرید و انتخابش کنید.',
  crossOriginIframe:
    'این iframe متعلق به سایت دیگری است و محتوای آن قابل بررسی نیست. همچنان می‌توانید کادر بیرونی آن را ثبت کنید.',
  noCandidate:
    'زیر نشانگر بخش معناداری پیدا نشد. نشانگر را روی ناحیه‌ای قابل مشاهده ببرید و دوباره تلاش کنید.',
  noParent: 'والد معنادار بزرگ‌تری وجود ندارد؛ این بیرونی‌ترین ناحیه است.',
  noChild: 'بخش کوچک‌تر معناداری درون این بخش وجود ندارد.',
  analysisFailed: 'تحلیل بخش انجام نشد.',
  captureFailed: 'ثبت تصویر مرجع انجام نشد.',
  partialReference: 'فایل reference.png فقط شامل قسمت قابل مشاهده بخش است.',
  oversizedSelection:
    'بخش انتخاب‌شده بسیار بزرگ است و تحلیل محدود شد. بهتر است بخش کوچک‌تری انتخاب کنید.',
  inaccessibleStylesheets:
    '{count} فایل استایل از دامنه‌ای دیگر قابل خواندن نبود؛ برخی مدیاکوئری‌ها و متغیرها در دسترس نیستند.',
  downloadFailed: 'دانلود انجام نشد.',
  storageFailed: 'تنظیمات شما ذخیره نشد. این تنظیمات تا بستن پنل اعمال می‌شوند.',
  announceActive: 'بازرس AJ Lens فعال است. نشانگر را روی یک بخش ببرید.',
  announceHoverFirst: 'ابتدا نشانگر را روی یک بخش ببرید.',
  announceSelected: 'بخش {selector} انتخاب شد.',
  announceLocked: 'بخش {selector} قفل شد.',
  announceUnlocked: 'قفل انتخاب باز شد. نشانگر را روی یک بخش ببرید.',
  announcePickAnother: 'بخش دیگری انتخاب کنید: نشانگر را ببرید و برای قفل‌کردن کلیک کنید.',
  announceRefreshed: 'اندازه‌گیری دوباره انجام شد.',
  announceReady: 'آماده است. پرامپتی با {count} نویسه تولید شد.',
  announcePartial: 'تنها {percent}٪ از بخش قابل مشاهده است. روش ثبت تصویر مرجع را انتخاب کنید.',
  announceSaved: 'فایل {file} ذخیره شد.',
  announceLanguage: 'زبان رابط: فارسی.',
  titleActive: 'AJ Lens — بازرس فعال است',
  titleIdle: 'AJ Lens',
  restrictedBrowser:
    'AJ Lens نمی‌تواند در صفحات داخلی مرورگر یا فروشگاه Chrome اجرا شود. یک وب‌سایت معمولی را باز کنید و دوباره تلاش کنید.',
  restrictedExtension:
    'AJ Lens نمی‌تواند در صفحات افزونه‌ها اجرا شود. یک وب‌سایت معمولی را باز کنید و دوباره تلاش کنید.',
  restrictedData:
    'AJ Lens نمی‌تواند در صفحات data: یا blob: اجرا شود. یک وب‌سایت معمولی را باز کنید و دوباره تلاش کنید.',
  injectFileAccess:
    'برای بررسی فایل‌های محلی، گزینه «Allow access to file URLs» را برای AJ Lens در chrome://extensions فعال کنید.',
  injectFailed: 'AJ Lens نتوانست در این صفحه اجرا شود.',
  noResponse: 'صفحه پاسخ نداد. زبانه را دوباره بارگذاری کنید و دوباره تلاش کنید.',
  noticeHeading: 'در این صفحه در دسترس نیست',
  noticeHint: 'یک وب‌سایت معمولی (http/https) را باز کنید و دوباره روی آیکون افزونه کلیک کنید.',
};

export const TRANSLATIONS: Record<Locale, Messages> = { en, fa };

/** Messages for a locale; empty or missing entries fall back to English. */
export function messages(locale: Locale): Messages {
  if (locale === 'en') return en;
  const out = { ...en };
  for (const key of Object.keys(en) as MessageKey[]) {
    const v = TRANSLATIONS[locale][key];
    if (typeof v === 'string' && v.trim()) out[key] = v;
  }
  return out;
}

/** Replaces `{name}` placeholders. */
export function format(template: string, vars: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m));
}

/** Locale-aware number (Persian digits in fa). */
export function formatNumber(n: number, locale: Locale): string {
  return n.toLocaleString(locale === 'fa' ? 'fa-IR' : 'en-US');
}

export function dirFor(locale: Locale): 'rtl' | 'ltr' {
  return locale === 'fa' ? 'rtl' : 'ltr';
}
