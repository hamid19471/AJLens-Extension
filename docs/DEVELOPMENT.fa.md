<div dir="rtl">

# راهنمای توسعه AJ Lens

## پیش‌نیازها

- Node.js و npm
- Chrome نسخه 127 یا جدیدتر برای آزمایش دستی
- برای تست دود: Chromium مربوط به Playwright (از کش Playwright استفاده می‌شود یا مسیر آن با متغیر `CHROMIUM_PATH` تعیین می‌شود)

## راه‌اندازی

</div>

```bash
git clone https://github.com/hamid19471/JALens-Extension.git
cd JALens-Extension
npm install
npm run build
```

<div dir="rtl">

سپس پوشه `dist/` را از `chrome://extensions` با **Load unpacked** بارگذاری کنید.

## فرمان‌ها

همه فرمان‌های زیر در `package.json` تعریف شده‌اند:

| فرمان                   | کار                                                                          |
| ----------------------- | ---------------------------------------------------------------------------- |
| `npm run dev`           | ساخت `dist/` و ساخت دوباره هنگام تغییر فایل‌ها (`scripts/build.mjs --watch`) |
| `npm run build`         | ساخت با Vite و سپس اعتبارسنجی `dist/`                                        |
| `npm run validate`      | فقط اعتبارسنجی `dist/`                                                       |
| `npm run typecheck`     | `tsc --noEmit` در حالت strict                                                |
| `npm run lint`          | ESLint با typescript-eslint و react-hooks                                    |
| `npm run format`        | Prettier با نوشتن تغییرات                                                    |
| `npm run format:check`  | Prettier فقط برای بررسی                                                      |
| `npm test`              | تست‌های واحد Vitest در محیط jsdom                                            |
| `npm run test:coverage` | تست‌ها همراه با پوشش V8 در `coverage/`                                       |
| `npm run test:smoke`    | تست دود در Chromium واقعی (نیازمند build قبلی)                               |
| `npm run package`       | build و ساخت `release/aj-lens-<version>.zip`                                 |
| `npm run icons`         | ساخت دوباره `public/icons/*.png`                                             |

## خروجی ساخت

`scripts/build.mjs` سه بسته در `dist/` می‌سازد:

</div>

```text
dist/
├── manifest.json
├── background.js      # service worker (ES module)
├── content.js         # بازرس و پنل (IIFE، شامل React و CSS)
├── notice.html
├── notice.js          # صفحه پیام صفحات محدود (IIFE)
├── _locales/
└── icons/
```

<div dir="rtl">

`scripts/validate.mjs` بررسی می‌کند که:

- `manifest_version` برابر 3 باشد و نسخه manifest با نسخه `package.json` یکی باشد.
- service worker از نوع module باشد.
- فقط مجوزهای مجاز وجود داشته باشند، `host_permissions` خالی باشد و هیچ content script ثابتی تعریف نشده باشد.
- همه کلیدهای `__MSG_` در هر دو پوشه `_locales/fa` و `_locales/en` وجود داشته باشند و نام افزونه «AJ Lens» باشد.
- همه فایل‌های ارجاع‌شده در manifest وجود داشته باشند.
- content script سینتکس ماژول و صفحه notice اسکریپت درون‌خطی نداشته باشد.

`dist/` و `release/` در `.gitignore` هستند و در مخزن نگهداری نمی‌شوند؛ آن‌ها را با فرمان‌های بالا بسازید.

## بسته‌بندی

`npm run package` ابتدا build را اجرا می‌کند و سپس `release/aj-lens-1.0.0.zip` را با `manifest.json` در ریشه آرشیو می‌سازد. زمان فایل‌ها ثابت است تا خروجی قابل‌تکرار باشد. نسخه از `package.json` و `public/manifest.json` خوانده می‌شود؛ هر دو باید هم‌زمان تغییر کنند.

## تست‌های واحد

- مسیر: `tests/*.test.ts` و `tests/*.test.tsx`
- محیط: jsdom (`vitest.config.ts`)
- هسته (`src/core`) به `chrome.*` وابسته نیست و با `Measurer` قابل‌تزریق تست می‌شود. ابعاد عناصر در تست‌ها با ویژگی `data-rect` تعیین می‌شوند (`tests/helpers.ts`).
- `tests/i18n.test.tsx` هر متن لاتین ترجمه‌نشده در پنل فارسی را خطا می‌داند. هر متن جدید رابط باید در هر دو زبان در `src/shared/i18n.ts` اضافه شود.

## صفحه نمونه (fixture)

`tests/fixtures/landing.html` یک صفحه فرود ساختگی با nav، hero، بخش قیمت‌گذاری، فرم و media queryهاست. هیچ داده واقعی در آن نیست و هم تست دود و هم تصاویر مستندات از آن استفاده می‌کنند.

## تست دود

</div>

```bash
npm run build
npm run test:smoke
```

<div dir="rtl">

این تست بدون شبکه و بدون هیچ secret اجرا می‌شود و:

1. `dist/` را به‌عنوان افزونه unpacked در Chromium بارگذاری می‌کند و راه‌اندازی service worker، manifest، مجوزها و پیام‌های محلی را بررسی می‌کند.
2. صفحه popup محدودیت را به فارسی و RTL بررسی می‌کند.
3. `content.js` ساخته‌شده را روی صفحه نمونه با runtime شبیه‌سازی‌شده اجرا می‌کند و این جریان را آزمایش می‌کند: رابط فارسی پیش‌فرض، انتخابگر زبان، عبور نشانگر، انتخاب والد، قفل، انتخاب نحوه ثبت، برش تصویر، تولید پرامپت، کپی کامل پرامپت، دانلود واقعی هر سه فایل از طریق service worker، بازکردن قفل و بستن.

دانلودهای تست در یک پوشه موقت سیستم ذخیره می‌شوند و پوشه Downloads شما را تغییر نمی‌دهند. برای استفاده از Chromium دیگر:

</div>

```bash
CHROMIUM_PATH="/path/to/chromium" npm run test:smoke
```

<div dir="rtl">

## افزودن قابلیت جدید

1. منطق مستقل از مرورگر را در `src/core` بنویسید و برای آن تست واحد اضافه کنید.
2. پیام جدید بین content script و service worker را در `src/shared/messages.ts` با type guard تعریف کنید.
3. متن‌های رابط را در `src/shared/i18n.ts` به هر دو زبان اضافه کنید.
4. اگر مجوز جدیدی لازم است، `public/manifest.json`، `scripts/validate.mjs`، تست دود و مستندات مجوزها را با هم به‌روز کنید.
5. همه بررسی‌ها را اجرا کنید: `npm run format`، `npm run lint`، `npm run typecheck`، `npm test`، `npm run build` و `npm run test:smoke`.

معماری کامل: [ARCHITECTURE.fa.md](ARCHITECTURE.fa.md)

</div>
