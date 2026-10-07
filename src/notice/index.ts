// Popup shown only when Section Lens cannot run on the current tab.
const params = new URLSearchParams(location.search);
const reason = params.get('reason') ?? 'Section Lens cannot run on this page.';
const el = document.getElementById('reason');
if (el) el.textContent = reason;
