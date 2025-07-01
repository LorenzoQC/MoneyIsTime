(async () => {
    const domain = location.hostname;
    const blacklistCheck = await new Promise(r => chrome.storage.local.get(['blacklist'], r));
    if (Array.isArray(blacklistCheck.blacklist) && blacklistCheck.blacklist.includes(domain)) {
        console.log(`[MoneyIsTime] Skipped on blacklisted domain: ${domain}`);
        return;
    }

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
        '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'C$': 'CAD', 'A$': 'AUD', 'CHF': 'CHF', 'RUB': 'RUB', 'R$': 'BRL', '₺': 'TRY'
    };

    function escapeRegex(s) {
        return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    const currencySymbols = Object.keys(symbolMap).map(escapeRegex).join('|');
    const priceRegex = new RegExp(
        `(${currencySymbols})[\\s\\u00A0\\u202F]*([\\d.,]+)|([\\d.,]+)[\\s\\u00A0\\u202F]*(${currencySymbols})`,
        'gu'
    );


    function normalizePriceString(raw) {
        const dotCount = (raw.match(/\./g) || []).length;
        const commaCount = (raw.match(/,/g) || []).length;

        // Both separators → EU format
        if (dotCount > 0 && commaCount > 0) {
            return raw.replace(/\./g, '').replace(',', '.');
        }

        // Only comma (e.g. "199,99") → decimal
        if (commaCount > 0 && dotCount === 0) {
            return raw.replace(',', '.');
        }

        // Only dot and matches X.XXX (e.g. "22.900") → thousands
        if (dotCount === 1 && /^\d{1,3}\.\d{3}$/.test(raw)) {
            return raw.replace(/\./g, '');
        }

        // Only dot (e.g. "199.99") → US decimal
        if (dotCount > 0 && commaCount === 0) {
            return raw;
        }

        // No separator → assume raw integer
        return raw;
    }

    function getUnitAbbr(unitString) {
        return unitString.charAt(0).toLowerCase();
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

        const totalHoursInMonth = settings.daysPerMonth * settings.hoursPerDay;
        const totalHoursInYear = totalHoursInMonth * 12;

        const y = Math.floor(hrs / totalHoursInYear);
        hrs -= y * totalHoursInYear;
        const m = Math.floor(hrs / totalHoursInMonth);
        hrs -= m * totalHoursInMonth;
        const d = Math.floor(hrs / settings.hoursPerDay);
        hrs -= d * settings.hoursPerDay;
        const h = Math.floor(hrs);
        const min = Math.round((hrs - h) * 60);

        const parts = [];
        if (y) parts.push(`${y} ${translations.years_unit}`);
        if (m) parts.push(`${m} ${translations.months_unit}`);
        if (d) parts.push(`${d} ${translations.days_unit}`);
        if (h) parts.push(`${h} ${translations.hours_unit}`);
        if (min) parts.push(`${min} ${translations.minutes_unit}`);
        
        const yAbbr = getUnitAbbr(translations.years_unit);
        const mAbbr = getUnitAbbr(translations.months_unit);
        const dAbbr = getUnitAbbr(translations.days_unit);
        const hAbbr = getUnitAbbr(translations.hours_unit);
        const minAbbr = getUnitAbbr(translations.minutes_unit);
        
        const isCompact = document.querySelectorAll('.money-is-time-processed').length > 15;
        const span = document.createElement('span');
        span.textContent = isCompact
            ? (y ? `${y}${yAbbr} ${m}${mAbbr}` : m ? `${m}${mAbbr} ${d}${dAbbr}` : d ? `${d}${dAbbr} ${h}${hAbbr}` : h ? `${h}${hAbbr} ${min}${minAbbr}` : `${min}${minAbbr}`)
            : parts.slice(0, 2).join(' ');
        span.style.marginLeft = '4px';
        span.style.backgroundColor = 'rgba(100, 108, 255, 0.12)';
        span.style.color = 'inherit';
        span.style.fontSize = '0.82em';
        span.style.padding = '4px 6px';
        span.style.borderRadius = '6px';
        span.style.lineHeight = '1.2';
        span.style.fontWeight = '500';
        span.style.boxShadow = '0 1px 3px rgba(0, 0, 0, 0.1)';
        span.style.border = '1px solid rgba(100, 108, 255, 0.2)';
        span.style.whiteSpace = 'nowrap';


        el.insertAdjacentElement('afterend', span);
        console.log(`[MoneyIsTime] Annotated ${amount} ${code} → ${parts.join(' ')}`);
    }

    const observer = new MutationObserver(() => scanTextNodes(document.body));
    observer.observe(document.body, { childList: true, subtree: true });

    setTimeout(() => {
        scanTextNodes(document.body);
    }, 120);
})();
