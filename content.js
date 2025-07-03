/* MoneyIsTime – content script (refactored 2025‑07‑03) */

(async () => {
  // ---------- Storage & Initialization ----------
  /* Fetch both blacklist and user settings in a single call */
  const {
    blacklist = [],
    salary,
    salaryType,
    currency,
    hoursPerDay,
    daysPerMonth,
    enabled,
    language
  } = await storageGet([
    'blacklist',
    'salary',
    'salaryType',
    'currency',
    'hoursPerDay',
    'daysPerMonth',
    'enabled',
    'language'
  ]);

  const domain = location.hostname;
  if (!enabled || blacklist.includes(domain)) {
    console.log('[MoneyIsTime] Stopped:', domain);
    return;
  }
  console.log('[MoneyIsTime] Active with settings', { salary, salaryType, currency, hoursPerDay, daysPerMonth, language });

  // ---------- Translations & Styles ----------
  const translations = await getTranslations(language);
  injectStyles(); // Add CSS classes for badges

  // ---------- Prepare Regex ----------
  const priceRegex = buildPriceRegex();

  // ---------- DOM Observation ----------
  /* Use a debounced observer to scan new text nodes */
  const observer = new MutationObserver(debounce(() => scanTextNodes(document.body), 100));
  observer.observe(document.body, { childList: true, subtree: true });

  // Initial scan after a short delay
  setTimeout(() => scanTextNodes(document.body), 120);

  // ---------- Helpers ----------

  /* Promise wrapper for chrome.storage.local.get */
  function storageGet(keys) {
    return new Promise(res => chrome.storage.local.get(keys, res));
  }

  /* Promise wrapper for chrome.runtime.sendMessage */
  function sendMessage(msg) {
    return new Promise(res => chrome.runtime.sendMessage(msg, res));
  }

  /* Load translations via message and pick correct language */
  async function getTranslations(lang) {
    const res = await sendMessage({ type: 'getTranslations' });
    return (res.translations[lang] || res.translations.en) || {};
  }

  /* Caches exchange rates per base currency for 24h */
  const ratesCache = {};
  async function getRates(base) {
    const now = Date.now();
    if (ratesCache[base] && now - ratesCache[base].ts < 864e5) {
      return ratesCache[base].rates;
    }
    console.log('[MoneyIsTime] Fetch rates for', base);
    const res = await sendMessage({ type: 'getRates', base });
    if (!res.rates) {
      console.warn('[MoneyIsTime] No rates for', base);
      return {};
    }
    ratesCache[base] = { rates: res.rates, ts: now };
    return res.rates;
  }

  /* Escape special chars and build a global price regex */
  function buildPriceRegex() {
    const symbolMap = {
      '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY',
      '₹': 'INR', 'C$': 'CAD', 'A$': 'AUD', 'CHF': 'CHF',
      'RUB': 'RUB', 'R$': 'BRL', '₺': 'TRY'
    };
    const esc = s => s.replace(/[.*+?^${}()|[\\]\\]/g, '\\$&');
    const symbols = Object.keys(symbolMap).map(esc).join('|');
    return new RegExp(
      `(${symbols})[\\s\\u00A0\\u202F]*([\\d.,]+)|([\\d.,]+)[\\s\\u00A0\\u202F]*(${symbols})`,
      'gu'
    );
  }

  /* Debounce function calls within a delay */
  function debounce(fn, ms = 100) {
    let timeout;
    return (...args) => {
      clearTimeout(timeout);
      timeout = setTimeout(() => fn(...args), ms);
    };
  }

  /* Inject CSS for the .money-is-time-badge class */
  function injectStyles() {
    const css = `
      .money-is-time-badge {
        background: rgba(100,108,255,0.12);
        border: 1px solid rgba(100,108,255,0.2);
        margin-left: 4px;
        font-size: 0.82em;
        padding: 4px 6px;
        border-radius: 6px;
        line-height: 1.2;
        font-weight: 500;
        box-shadow: 0 1px 3px rgba(0,0,0,0.1);
        white-space: nowrap;
      }
      @media (prefers-color-scheme: dark) {
        .money-is-time-badge {
          background: rgba(100,108,255,0.2);
          border-color: rgba(100,108,255,0.4);
        }
      }
    `;
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  /* Normalize numbers based on separators */
  function normalize(raw) {
    const dots = (raw.match(/\./g) || []).length;
    const commas = (raw.match(/,/g) || []).length;
    if (dots && commas) return raw.replace(/\./g, '').replace(',', '.');
    if (commas) return raw.replace(',', '.');
    if (dots === 1 && /^\d{1,3}\.\d{3}$/.test(raw)) return raw.replace('.', '');
    return raw;
  }

  // ---------- Scanning & Annotation ----------

  function scanTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let node;
    while (node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || parent.classList.contains('money-is-time-processed')) continue;

      const text = node.nodeValue;
      if (!text || !/[€$£¥₹]/.test(text)) continue;

      for (const [, s1, v1, v2, s2] of text.matchAll(priceRegex)) {
        const symbol = s1 || s2;
        const raw = v1 || v2;
        const code = symbolMap[symbol] || (symbol.length === 3 && symbol);
        const value = parseFloat(normalize(raw));
        if (!code || isNaN(value)) continue;

        annotate(parent, value, code);
        parent.classList.add('money-is-time-processed');
        break;
      }
    }
  }

  /* Convert amount → hours, format with units */
  async function annotate(el, amount, code) {
    let rates = await getRates(currency);
    let rate = rates[code] || null;
    if (!rate) {
      const rev = await getRates(code);
      rate = rev[currency] ? 1 / rev[currency] : null;
    }
    if (!rate) return;

    const converted = amount * rate;
    const hourlyRate = (() => {
      if (salaryType === 'daily') return salary / hoursPerDay;
      if (salaryType === 'monthly') return salary / (daysPerMonth * hoursPerDay);
      return salary;
    })();

    const hoursNeeded = converted / hourlyRate;
    const text = formatDuration(hoursNeeded, translations);

    const span = document.createElement('span');
    span.textContent = `🕒 ${text}`;
    span.className = 'money-is-time-badge';
    el.insertAdjacentElement('afterend', span);

    console.log('[MoneyIsTime] Annotated', amount, code, '→', text);
  }

  /* Break hours into y, m, d, h, min and create compact label */
  function formatDuration(hours, t) {
    const totalHMonth = daysPerMonth * hoursPerDay;
    const totalHYear = totalHMonth * 12;
    let left = hours;

    const y = Math.floor(left / totalHYear); left -= y * totalHYear;
    const m = Math.floor(left / totalHMonth); left -= m * totalHMonth;
    const d = Math.floor(left / hoursPerDay); left -= d * hoursPerDay;
    const h = Math.floor(left); left -= h;
    const mins = Math.round(left * 60);

    const units = [
      [y, t.years_unit], [m, t.months_unit],
      [d, t.days_unit], [h, t.hours_unit], [mins, t.minutes_unit]
    ].filter(([n]) => n)
      .map(([n, u]) => `${n}${u.charAt(0).toLowerCase()}`);

    return units.length > 2 ? units.slice(0,2).join(' ') : units.join(' ');
  }
})();
