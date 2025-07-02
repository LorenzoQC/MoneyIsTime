/* MoneyIsTime – content script (optimized 2025‑07‑02)
   Functionality unchanged; structure is more modular and performant. */

(() => {
  /* ---------- Config & constants ---------- */
  const SETTINGS_KEYS = [
    'salary', 'salaryType', 'currency',
    'hoursPerDay', 'daysPerMonth', 'enabled', 'language'
  ];
  const SYMBOL_TO_CODE = {
    '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR',
    'C$': 'CAD', 'A$': 'AUD', 'CHF': 'CHF', 'RUB': 'RUB',
    'R$': 'BRL', '₺': 'TRY'
  };

  /* Pre‑compiles a regex that matches both currency symbols and ISO codes (3 letters) */
  const SYMBOLS_PART = Object.keys(SYMBOL_TO_CODE)
    .map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  const ISO_PART = '[A-Z]{3}';
  const PRICE_PATTERN =
    `(${SYMBOLS_PART}|${ISO_PART})[\s\u00A0\u202F]*([\d.,]+)|` +
    `([\d.,]+)[\s\u00A0\u202F]*(${SYMBOLS_PART}|${ISO_PART})`;
  const PRICE_REGEX = new RegExp(PRICE_PATTERN, 'gu');

  const DAY_MS = 86_400_000;
  const RATES_TTL_MS = 24 * DAY_MS; // cache currency rates for 24 h

  /* ---------- State ---------- */
  const processedNodes = new WeakSet();
  const rateCache = new Map(); // key: base currency, value: {ts:number, rates:object}

  /* ---------- Utility ---------- */
  const escapeHtml = s => s.replace(/[&<>"']/g, m =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // Normalises a locale‑formatted number string to JS‑parsable format
  const normalizeNumber = raw => {
    const dot = (raw.match(/\./g) || []).length;
    const com = (raw.match(/,/g) || []).length;
    if (dot && com) return raw.replace(/\./g, '').replace(',', '.');   // 1.234,56 → 1234.56
    if (com && !dot) return raw.replace(',', '.');                     // 199,99 → 199.99
    if (dot === 1 && /^\d{1,3}\.\d{3}$/.test(raw))
      return raw.replace(/\./g, '');                                  // 12.345 → 12345
    return raw;                                                        // 199.99  /  19999
  };

  const unitAbbr = u => u.charAt(0).toLowerCase();

  /* Converts user salary to an hourly wage (number) */
  function toHourly({ salary, salaryType, hoursPerDay, daysPerMonth }) {
    if (salaryType === 'daily') return salary / hoursPerDay;
    if (salaryType === 'monthly') return salary / (daysPerMonth * hoursPerDay);
    return salary; // already hourly
  }

  /* Splits a number of hours into Y, M, D, H, Min components */
  function splitWorkTime(totalHours, { hoursPerDay, daysPerMonth }) {
    const hMonth = hoursPerDay * daysPerMonth;
    const hYear = hMonth * 12;

    const y = Math.floor(totalHours / hYear); totalHours -= y * hYear;
    const m = Math.floor(totalHours / hMonth); totalHours -= m * hMonth;
    const d = Math.floor(totalHours / hoursPerDay);
    totalHours -= d * hoursPerDay;
    const h = Math.floor(totalHours);
    const min = Math.round((totalHours - h) * 60);

    return { y, m, d, h, min };
  }

  /* Returns the final badge string (compact or extended) */
  function formatWorkTime(parts, t, compact) {
    const { years_unit, months_unit, days_unit, hours_unit, minutes_unit } = t;
    const map = [
      [parts.y, years_unit],
      [parts.m, months_unit],
      [parts.d, days_unit],
      [parts.h, hours_unit],
      [parts.min, minutes_unit]
    ].filter(([n]) => n);

    if (!map.length) map.push([0, minutes_unit]); // fallback to 0 minutes

    if (compact) {
      const [a, b] = map;
      return map.length === 1
        ? `${a[0]}${unitAbbr(a[1])}`
        : `${a[0]}${unitAbbr(a[1])} ${b[0]}${unitAbbr(b[1])}`;
    }
    return map.slice(0, 2).map(([n, u]) => `${n} ${u}`).join(' ');
  }

  /* ---------- Storage helpers ---------- */
  function getStorage(keys) {
    return new Promise(res => chrome.storage.local.get(keys, res));
  }

  /* ---------- Currency exchange with cache & memoisation ---------- */
  async function getRates(base) {
    const cached = rateCache.get(base);
    if (cached && (Date.now() - cached.ts) < RATES_TTL_MS) return cached.rates;

    /* Memoisation for concurrent requests */
    if (cached?.promise) return cached.promise;

    const promise = new Promise(resolve => {
      chrome.runtime.sendMessage({ type: 'getRates', base }, msg => {
        if (!msg?.rates) {
          console.warn('[MoneyIsTime] Exchange API error:', msg?.error);
          rateCache.delete(base);
          return resolve({});
        }
        rateCache.set(base, { ts: Date.now(), rates: msg.rates });
        resolve(msg.rates);
      });
    });
    rateCache.set(base, { ts: 0, promise }); // mark request as in‑flight
    return promise;
  }

  /* ---------- Annotate price → work time ---------- */
  async function annotate(node, amount, code, settings, t) {
    /* 1. Get exchange rate */
    const ratesBase = await getRates(settings.currency);
    let rate = ratesBase[code];
    if (!rate) {
      const reverse = await getRates(code);
      rate = reverse?.[settings.currency] ? 1 / reverse[settings.currency] : null;
    }
    if (!rate) return console.warn(`[MoneyIsTime] No FX ${code}→${settings.currency}`);

    /* 2. Compute work time */
    const converted = amount * rate;
    const hourly = toHourly(settings);
    const totalHours = converted / hourly;
    const parts = splitWorkTime(totalHours, settings);

    /* 3. Build badge */
    const badge = document.createElement('span');
    badge.textContent = `🕒 ${formatWorkTime(parts, t, processedNodes.size > 15)}`;

    const dark = matchMedia('(prefers-color-scheme: dark)').matches;
    Object.assign(badge.style, {
      backgroundColor: dark ? 'rgba(100,108,255,.2)' : 'rgba(100,108,255,.12)',
      border: dark ? '1px solid rgba(100,108,255,.4)' : '1px solid rgba(100,108,255,.2)',
      marginLeft: '4px', fontSize: '0.82em', padding: '4px 6px',
      borderRadius: '6px', lineHeight: '1.2', fontWeight: '500',
      whiteSpace: 'nowrap', color: 'inherit', boxShadow: '0 1px 3px rgba(0,0,0,.1)'
    });

    node.insertAdjacentElement('afterend', badge);
  }

  /* ---------- Scan text nodes ---------- */
  function scan(root, settings, t) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const parent = n.parentElement;
      if (!parent || processedNodes.has(parent)) continue;

      const txt = n.nodeValue;
      if (!txt || (!/[$€£¥₹]|[A-Z]{3}/.test(txt))) continue;

      for (const m of txt.matchAll(PRICE_REGEX)) {
        const [, s1, v1, v2, s2] = m;
        const symbolOrIso = s1 || s2;
        const numRaw = v1 || v2;
        const iso = SYMBOL_TO_CODE[symbolOrIso] || (symbolOrIso.length === 3 ? symbolOrIso : null);
        if (!iso) continue;

        const value = parseFloat(normalizeNumber(numRaw));
        if (Number.isNaN(value)) continue;

        processedNodes.add(parent);
        annotate(parent, value, iso, settings, t);
        break; // annotate only once per node
      }
    }
  }

  /* ---------- Main entry ---------- */
  (async () => {
    const domain = location.hostname;
    const { blacklist = [] } = await getStorage(['blacklist']);
    if (blacklist.includes(domain)) return console.log(`[MoneyIsTime] Blacklisted ${domain}`);

    const settings = await getStorage(SETTINGS_KEYS);
    if (!settings.enabled) return;

    const { translations } = await new Promise(res =>
      chrome.runtime.sendMessage({ type: 'getTranslations' }, res));
    const t = translations?.[settings.language] ?? translations?.en ?? {};
    if (!Object.keys(t).length) return console.warn('[MoneyIsTime] No translations');

    /* Initial scan; small delay for page builders */
    setTimeout(() => scan(document.body, settings, t), 120);

    /* MutationObserver with debounce */
    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      (window.requestIdleCallback || setTimeout)(() => {
        scan(document.body, settings, t);
        scheduled = false;
      }, 300);
    };
    new MutationObserver(schedule)
      .observe(document.body, { childList: true, subtree: true });
  })();
})();
