(async () => {
    const settings = await new Promise(r => chrome.storage.local.get(
        ['salary', 'salaryType', 'currency', 'hoursPerDay', 'daysPerMonth', 'enabled', 'language'], r
    ));
    if (!settings.enabled) return;
    console.log(`[MoneyIsTime] Extension active. Settings:`, settings);

    const translations = await new Promise(resolve => {
        chrome.runtime.sendMessage({ type: 'getTranslations' }, res => {
            resolve((res.translations || {})[settings.language] || res.translations?.en || {});
        });
    });

    const rateCache = {};

    async function getRates(base) {
        const now = Date.now();
        if (rateCache[base] && now - rateCache[base].ts < 24 * 3600 * 1000) {
            return rateCache[base].rates;
        }
        console.log(`[MoneyIsTime] Fetching exchange rates for`, base);
        const res = await new Promise(resolve => {
            chrome.runtime.sendMessage({ type: 'getRates', base }, resolve);
        });
        if (!res.rates) {
            console.warn('[MoneyIsTime] Failed to retrieve rates for', base, res);
            return {};
        }
        rateCache[base] = { rates: res.rates, ts: now };
        return res.rates;
    }

    const symbolMap = {
        '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'C$': 'CAD', 'A$': 'AUD', 'CHF': 'CHF', 'RUB': 'RUB'
    };

    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const currencySymbols = Object.keys(symbolMap).map(escapeRegex).join('|');
    //const priceRegex = new RegExp(`(?:(${currencySymbols})[\u00A0\s]*([\d.,]+)|([\d.,]+)[\u00A0\s]*(${currencySymbols}))`, 'gu');
    const priceRegex = new RegExp(
  `(${currencySymbols})[\\s\\u00A0\\u202F]*([\\d.,]+)|([\\d.,]+)[\\s\\u00A0\\u202F]*(${currencySymbols})`,
  'gu'
);


    function normalizePriceString(raw) {
        const dotCount = (raw.match(/\./g) || []).length;
        const commaCount = (raw.match(/,/g) || []).length;
        if (commaCount > 0 && (dotCount === 0 || commaCount > dotCount)) {
            return raw.replace(/\./g, '').replace(',', '.');
        } else {
            return raw.replace(/,/g, '');
        }
    }

    function scanTextNodes(root) {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            const parent = node.parentElement;
            if (!parent || parent.classList.contains('money-is-time-processed')) continue;

            const text = node.nodeValue;
            if (!text || !/[€$£¥₹]/.test(text)) continue;

            const matches = [...text.matchAll(priceRegex)];
            if (matches.length === 0) {
                // Debugging aid:
                console.debug('[MoneyIsTime] No match in text node:', text);
            }

            for (const match of matches) {
                const [full, sym1, val1, val2, sym2] = match;
                const symbol = sym1 || sym2;
                const rawValue = val1 || val2;
                const code = symbolMap[symbol] || (symbol.length === 3 ? symbol : null);
                const val = parseFloat(normalizePriceString(rawValue));
                if (!code || isNaN(val)) continue;

                console.log(`[MoneyIsTime] Found price: ${full} => ${val} ${code}`);
                annotate(parent, val, code);
                parent.classList.add('money-is-time-processed');
                break;
            }
        }
    }

    async function annotate(el, amount, code) {
        const rates = await getRates(settings.currency);
        let rate = rates[code];
        if (!rate) {
            const reverseRates = await getRates(code);
            rate = reverseRates?.[settings.currency] ? 1 / reverseRates[settings.currency] : null;
        }
        if (!rate) {
            console.warn(`[MoneyIsTime] No rate found for ${code} to ${settings.currency}`);
            return;
        }

        const conv = amount * rate;
        let hourly = settings.salary;
        if (settings.salaryType === 'daily') hourly /= settings.hoursPerDay;
        if (settings.salaryType === 'monthly') hourly /= (settings.daysPerMonth * settings.hoursPerDay);
        let hrs = conv / hourly;

        const m = Math.floor(hrs / (settings.daysPerMonth * settings.hoursPerDay));
        hrs -= m * settings.daysPerMonth * settings.hoursPerDay;
        const d = Math.floor(hrs / settings.hoursPerDay);
        hrs -= d * settings.hoursPerDay;
        const h = Math.floor(hrs);
        const min = Math.round((hrs - h) * 60);

        const parts = [];
        if (m) parts.push(`${m} ${translations.months_unit}`);
        if (d) parts.push(`${d} ${translations.days_unit}`);
        if (h) parts.push(`${h} ${translations.hours_unit}`);
        if (min) parts.push(`${min} ${translations.minutes_unit}`);

        const span = document.createElement('span');
        span.textContent = parts.join(' ');
        span.style.marginLeft = '4px';
        span.style.background = '#eef';
        span.style.padding = '2px 4px';
        span.style.borderRadius = '4px';
        span.style.fontSize = '0.85em';

        el.insertAdjacentElement('afterend', span);
        console.log(`[MoneyIsTime] Annotated ${amount} ${code} → ${parts.join(' ')}`);
    }

    const observer = new MutationObserver(() => scanTextNodes(document.body));
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        scanTextNodes(document.body);
    }, 300);
})();
