<div dir="rtl">

# معماری AJ Lens

AJ Lens از سه بخش اجرایی و یک هسته TypeScript مستقل تشکیل شده است: service worker پس‌زمینه، content script داخل صفحه، صفحه پیام صفحات محدود (`notice.html`) و هسته `src/core` که هیچ وابستگی به `chrome.*` ندارد.

</div>

```text
toolbar click / Alt+Shift+S
        │
        ▼
┌──────────────────────┐   executeScript(content.js) + aj-lens/toggle   ┌────────────────────────────────┐
│ background.js (SW)   │ ─────────────────────────────────────────────▶ │ content.js (isolated world)    │
│ - restricted check   │                                                 │ InspectorController            │
│ - inject + toggle    │ ◀───────────────────────────────────────────── │  ├ Overlay (shadow root)       │
│ - captureVisibleTab  │   aj-lens/capture-visible-tab                   │  ├ React Panel (shadow root)   │
│ - downloads          │   aj-lens/download-artifact, aj-lens/state     │  ├ selection engine (core)     │
│ - badge / notice     │                                                 │  └ analysis + prompt (core)    │
└──────────────────────┘                                                 └────────────────────────────────┘
```

<div dir="rtl">

## Manifest V3

`public/manifest.json` یک افزونه MV3 با این ویژگی‌ها تعریف می‌کند:

- `background.service_worker` برابر `background.js` با `type: "module"`
- مجوزهای `activeTab`، `scripting`، `storage` و `downloads` (بدون host permission)
- فرمان `_execute_action` با کلید <bdi dir="ltr">`Alt+Shift+S`</bdi>
- `default_locale: "fa"` و پیام‌های محلی در `_locales/fa` و `_locales/en`
- `minimum_chrome_version: "127"`

هیچ `content_scripts` ثابتی تعریف نشده است؛ اسکریپت فقط هنگام درخواست کاربر تزریق می‌شود.

## Service worker پس‌زمینه (`src/background`)

- **`action.onClicked`:** اگر آدرس تب محدود باشد (`restricted.ts`)، یک popup مخصوص همان تب (`notice.html`) با دلیل محدودیت باز می‌کند و نشان قرمز `!` می‌گذارد. در غیر این صورت پیام `aj-lens/toggle` را می‌فرستد؛ اگر پاسخی نیاید، `content.js` را تزریق و دوباره toggle می‌کند. خطاهای تزریق (مثلاً نبود دسترسی به `file://` یا مسدودشدن با policy) به پیام قابل‌فهم تبدیل می‌شوند.
- **`aj-lens/capture-visible-tab`:** فراخوانی `chrome.tabs.captureVisibleTab(windowId, { format: 'png' })` برای پنجره فرستنده. خطاهای مجوز و محدودیت نرخ به پیام خوانا تبدیل می‌شوند.
- **`aj-lens/download-artifact`:** اعتبارسنجی payload، ساخت data URL با کدگذاری UTF-8 (چون `URL.createObjectURL` در service worker وجود ندارد)، فراخوانی `chrome.downloads.download` و پیگیری کوتاه `downloads.onChanged` تا لغو یا قطع دانلود به‌صورت خطا برگردد. پس از آن چیزی نگه داشته نمی‌شود. `aj-lens/show-download` فایل را با `chrome.downloads.show` نشان می‌دهد.
- **`aj-lens/state`:** به‌روزرسانی نشان `ON` روی آیکون همان تب.
- با شروع بارگذاری صفحه جدید (`tabs.onUpdated`)، popup، نشان و عنوان تب بازنشانی می‌شوند.

## پیام‌رسانی typed

همه پیام‌ها در `src/shared/messages.ts` با union typeها تعریف و با type guardها اعتبارسنجی می‌شوند. نوع پاسخ هر پیام از نوع درخواست استخراج می‌شود. پیام‌هایی که از افزونه‌های دیگر بیایند (`sender.id` متفاوت) رد می‌شوند.

## Content script (`src/content`)

`index.ts` در هر صفحه فقط یک‌بار اجرا می‌شود (با محافظ `window.__ajLens` در isolated world)، باقی‌مانده رابط نسخه قبلی افزونه را پاک می‌کند و شنونده پیام را ثبت می‌کند. فقط فریم اصلی بررسی می‌شود.

### Shadow DOM و پنل شناور

- یک عنصر میزبان `<aj-lens-root>` با استایل `all: initial` و یک **shadow root باز** ساخته می‌شود. overlay و پنل React داخل آن قرار دارند؛ بنابراین CSS صفحه به پنل نمی‌رسد و CSS افزونه هم به صفحه نشت نمی‌کند.
- پنل یک کامپوننت React 19 است (`panel/Panel.tsx`) که وضعیت را از `Store` کنترلر با `useSyncExternalStore` می‌خواند. پنل از سربرگ قابل جابه‌جایی و کوچک‌شدن است و همیشه داخل viewport نگه داشته می‌شود.

### Overlay بازرس

`overlay.ts` یک کادر `position: fixed` با `aria-hidden` و `pointer-events: none` رسم می‌کند و با transform جابه‌جا می‌شود، تا روی چیدمان صفحه اثری نگذارد.

### کنترلر و رویدادها

`InspectorController` مالک همه چیزهایی است که هنگام فعال‌بودن بازرس ساخته می‌شوند:

- همه شنونده‌ها با یک `AbortController` ثبت می‌شوند: `pointermove`، `scroll` و `resize` یک فریم زمان‌بندی می‌کنند. کلیک‌ها فقط در حالت انتخاب و بیرون از رابط افزونه مهار می‌شوند و کلیک، بخش را قفل می‌کند. `keydown` میانبرها را مدیریت می‌کند و فیلدهای قابل‌ویرایش را نادیده می‌گیرد.
- حلقه `requestAnimationFrame` فقط وقتی چیزی تغییر کرده اجرا می‌شود، به‌علاوه یک بررسی ایمنی ۳۰۰ میلی‌ثانیه‌ای و یک `ResizeObserver` روی هدف.
- `destroy()` همه شنونده‌ها، تایمرها، observerها و تحلیل در حال اجرا را لغو، React را unmount و میزبان را حذف می‌کند. باز و بسته‌کردن مکرر هیچ شنونده یا گره‌ای باقی نمی‌گذارد.

## موتور انتخاب (`src/core/selection.ts`، `filters.ts`، `selector.ts`)

- از `elementFromPoint` شروع می‌کند، تا اولین عنصر معنادار با اندازه یک «ناحیه» بالا می‌رود و wrapperهای هم‌اندازه را ادغام می‌کند.
- عناصر قابل‌چشم‌پوشی (script، style، مخفی، رابط افزونه) کنار گذاشته می‌شوند.
- ناوبری والد و فرزند با امتیازدهی وابسته به موقعیت نشانگر انجام می‌شود.
- hysteresis (۱۴۰ میلی‌ثانیه برای تغییرات تودرتو و ۴۵ میلی‌ثانیه برای خواهر و برادرها) از پرش انتخاب جلوگیری می‌کند.
- `selector.ts` انتخابگر کوتاه برای نمایش و انتخابگر یکتا و پایدار می‌سازد و کلاس‌ها و idهای hash‌شده (CSS-in-JS، CSS Modules و فریم‌ورک‌ها) را فیلتر می‌کند.

## خط لوله تحلیل (`src/core/analysis`)

`analysis/index.ts` مراحل را به‌ترتیب اجرا و هر مرحله را برای نوار پیشرفت و ناحیه ARIA live گزارش می‌کند. تحلیل قابل لغو (abort) است.

| ماژول              | مسئولیت                                           |
| ------------------ | ------------------------------------------------- |
| `dom.ts`           | ساختار، عمق، تعداد گره‌ها و خلاصه درخت            |
| `layout.ts`        | flex، grid، فاصله‌ها، ابعاد                       |
| `typography.ts`    | فونت‌ها، اندازه‌ها، وزن‌ها، ارتفاع خط             |
| `colors.ts`        | پالت، توکن‌ها، متغیرهای CSS، کنتراست              |
| `assets.ts`        | تصاویر، SVG، پس‌زمینه‌ها، رسانه‌ها                |
| `interactions.ts`  | عناصر تعاملی موجود                                |
| `accessibility.ts` | نقش‌ها، ARIA، برچسب‌ها، سرتیترها                  |
| `responsive.ts`    | پویش stylesheetها برای media queryهای مرتبط       |
| `classify.ts`      | دسته‌بندی قطعی و اکتشافی با میزان اطمینان و شواهد |

ماژول‌های کمکی: `measure.ts` (کش `getBoundingClientRect` و `getComputedStyle` در هر دور)، `styles.ts` و `color.ts` (فهرست مجاز ویژگی‌ها، حذف مقادیر پیش‌فرض و ارثی، فشرده‌سازی shorthand، نرمال‌سازی رنگ)، `sanitize.ts` (پاک‌سازی URL، خلاصه data URL، حذف اطلاعات حساس از متن).

محدودیت‌های پیش‌فرض (`DEFAULT_LIMITS`): عمق ۱۴، ۱٬۵۰۰ گره، ۴۰۰ نمونه استایل و ۶٬۰۰۰ قانون stylesheet. انتخاب‌های بزرگ‌تر کوتاه می‌شوند و تحلیل و پرامپت هشدار می‌دهند.

## خط لوله ثبت تصویر (`src/content/capture.ts`)

1. ثبت فقط پس از قفل‌کردن انجام می‌شود.
2. اگر بخش کامل دیده نشود، کاربر بین ثبت ناحیه قابل‌مشاهده، اسکرول و ثبت، یا انصراف انتخاب می‌کند.
3. پنل و overlay پنهان می‌شوند و دو animation frame صبر می‌شود.
4. service worker `captureVisibleTab` را فراخوانی می‌کند.
5. مقیاس برش از نسبت عرض bitmap به عرض viewport محاسبه می‌شود، پس devicePixelRatio و بزرگ‌نمایی مرورگر هر دو پوشش داده می‌شوند (`geometry.ts`).
6. تصویر برش‌خورده به PNG تبدیل و فقط در حافظه نگه داشته می‌شود.

## تولید پرامپت (`src/core/prompt/generate.ts`)

پرامپت از بخش‌هایی با اولویت ساخته می‌شود. اگر از بودجه (۲۵٬۰۰۰ نویسه در حالت کامل و ۶٬۰۰۰ در حالت خلاصه) بیشتر شود، کم‌اهمیت‌ترین بخش‌ها اول کوتاه می‌شوند و code fenceها متوازن می‌مانند. وظیفه، ورودی‌ها، الزامات پروژه و دستورالعمل‌های پیاده‌سازی هرگز کوتاه نمی‌شوند. پرامپت همیشه انگلیسی است و با تغییر تنظیمات پرامپت به‌صورت همزمان دوباره ساخته می‌شود؛ تحلیل دوباره فقط هنگام قفل، اندازه‌گیری دوباره یا تغییر انتخاب در حالت قفل اجرا می‌شود.

## Clipboard (`src/content/clipboard.ts`)

`controller.copyPrompt()` کل رشته پرامپت حالت فعال را از store می‌خواند (نه از textarea) و فقط وقتی تولید کامل شده (`stage === 'ready'`) کپی می‌کند. `ClipboardService` ابتدا `navigator.clipboard.writeText` را امتحان می‌کند و در صورت شکست، یک textarea موقت خارج از دید داخل shadow root افزونه با `execCommand('copy')` به کار می‌برد، آن را فوراً حذف و فوکوس را برمی‌گرداند.

## سیستم خروجی و دانلود (`src/core/prompt/export.ts`)

پس از کامل‌شدن تحلیل، کنترلر یک `CaptureExportSession` می‌سازد. پوشه آن `AJ-Lens/<hostname-پاک‌سازی‌شده>-<YYYY-MM-DD-HHmmss>` از زمان ثبت ساخته می‌شود و هر سه دکمه از آن استفاده می‌کنند. هر دکمه وضعیت جداگانه (آماده، در حال ذخیره، ذخیره‌شده، ناموفق) دارد و در حالت در حال ذخیره کلیک دوباره را نادیده می‌گیرد. نتیجه در یک خط `aria-live` اعلام می‌شود و نتیجه مربوط به ثبتی که در این فاصله جایگزین شده کنار گذاشته می‌شود.

## بومی‌سازی (`src/shared/i18n.ts`)

- همه متن‌های رابط در یک دیکشنری typed با دو زبان `fa` و `en` قرار دارند. `fa` از نوع `Record<MessageKey, string>` است، پس نبود یک کلید فارسی خطای کامپایل است.
- زبان از `prefs.locale` خوانده می‌شود، پیش‌فرض آن `fa` است و هرگز از زبان مرورگر گرفته نمی‌شود.
- ریشه پنل `lang` و `dir` می‌گیرد و مقادیر فنی داخل `<bdi dir="ltr">` قرار می‌گیرند. چیدمان سربرگ (`brand | selector | window controls`) با جهت پنل خودبه‌خود آینه می‌شود.
- پیام‌ها به‌صورت کلید ذخیره می‌شوند، نه متن؛ بنابراین تغییر زبان پیام‌های روی صفحه را هم ترجمه می‌کند.
- service worker و `notice.html` از همان دیکشنری استفاده می‌کنند. توضیح افزونه و توضیح میانبر از `_locales` می‌آیند.

## ذخیره‌سازی (`src/shared/preferences.ts`)

فقط تنظیمات در `chrome.storage.local` زیر کلید `aj-lens.preferences` ذخیره می‌شوند: زبان، موقعیت پنل، حالت کوچک‌شده، فناوری ساخت، دستورهای سفارشی، میزان جزئیات و گزینه‌های پرامپت. تنظیمات قدیمی کلید `sectionLens.preferences` یک‌بار به کلید جدید منتقل می‌شوند.

## ساخت

`scripts/build.mjs` سه ساخت کتابخانه‌ای Vite در `dist/` انجام می‌دهد:

- `content.js`: فرمت IIFE، همراه React و CSS درون‌خطی
- `background.js`: ماژول ES برای service worker
- `notice.js`: فرمت IIFE

محتوای `public/` بدون تغییر کپی می‌شود. `scripts/validate.mjs` manifest، مجوزها و فایل‌های ارجاع‌شده را بررسی می‌کند و مطمئن می‌شود content script سینتکس ماژول ندارد. `scripts/package.mjs` یک ZIP قابل‌تکرار (با timestamp ثابت) می‌سازد.

## تست‌ها

- **تست‌های واحد** (`tests/*.test.ts(x)`) با Vitest و jsdom اجرا می‌شوند. هسته با یک `Measurer` قابل‌تزریق تست می‌شود و هندسه از طریق `data-rect` به آن داده می‌شود.
- `tests/i18n.test.tsx` پنل فارسی را در همه وضعیت‌های اصلی رندر می‌کند و اگر متن لاتین ترجمه‌نشده‌ای خارج از فهرست مجاز پیدا شود شکست می‌خورد.
- **تست دود** (`scripts/smoke.mjs`) افزونه ساخته‌شده را در Chromium واقعی بارگذاری و کل جریان کاربر را روی `tests/fixtures/landing.html` اجرا می‌کند. جزئیات در [DEVELOPMENT.fa.md](DEVELOPMENT.fa.md).

نسخه انگلیسی: [ARCHITECTURE.md](ARCHITECTURE.md)

</div>
