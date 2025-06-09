(async () => {
    const settings = await new Promise(r => chrome.storage.local.get(
        ['salary', 'salaryType', 'currency', 'hoursPerDay', 'daysPerMonth', 'enabled', 'language'], r
    ));
    if (!settings.enabled) return;
    console.log('[MoneyIsTime] Extension active. Settings:', settings);

    const translations = {
        en: { months_unit: "months", days_unit: "days", hours_unit: "hours" },
        it: { months_unit: "mesi", days_unit: "giorni", hours_unit: "ore" },
        fr: { months_unit: "mois", days_unit: "jours", hours_unit: "heures" }
    }[settings.language] || translations.en;

    const symbolMap = {
        '$': 'USD', '€': 'EUR', '£': 'GBP', '¥': 'JPY', '₹': 'INR', 'C$': 'CAD', 'A$': 'AUD', 'CHF': 'CHF', 'RUB': 'RUB'
    };

    function parseNumber(str) {
        if (str.includes(',') && str.includes('.')) {
            return str.indexOf(',') > str.indexOf('.')
                ? parseFloat(str.replace('.', '').replace(',', '.'))
                : parseFloat(str.replace(/,/g, ''));
        }
        if (str.includes(',') && !str.includes('.')) {
            return parseFloat(str.replace(',', '.'));
        }
        return parseFloat(str);
    }

    /*
    function parseNode(node) {
        const text = node.textContent;
        const currencySymbols = Object.keys(symbolMap)
            .map(sym => sym.replace(/[.*+?^${}()|[]\]/g, '\$&'))
            .join('|');
        const regex = new RegExp(`(${currencySymbols}) \s?([\d.,] +)`, 'u');
        const m = text.match(regex);
        if (!m) return;
        const sym = m[1];
        const val = parseNumber(m[2]);
        const code = symbolMap[sym] || (sym.length === 3 ? sym : null);
        if (!code) return;
        console.log(`[MoneyIsTime] Found price: ${text.trim()} => ${val} ${code}`);
        annotate(node.parentElement, val, code);
    }
    */
    function parseNode(node) {
        const text = node.textContent;
        const currencySymbols = Object.keys(symbolMap)
            .map(sym => sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|');
        const regex = new RegExp(`(${currencySymbols})\\s?([\\d.,]+)`, 'u');
        const m = text.match(regex);
        if (!m) return;
        const sym = m[1];
        const val = parseNumber(m[2]);
        const code = symbolMap[sym] || (sym.length === 3 ? sym : null);
        if (!code) return;
        console.log(`[MoneyIsTime] Found price: ${text.trim()} => ${val} ${code}`);
        annotate(node.parentElement, val, code);
    }

    const rateCache = {};
    let ratesPromise;

    async function getRates(base) {
        if (rateCache[base]) return rateCache[base];
        if (!ratesPromise) {
            console.log('[MoneyIsTime] Fetching exchange rates for', base);
            ratesPromise = new Promise(resolve => {
                chrome.runtime.sendMessage({ type: 'getRates', base }, res => {
                    if (!res.rates) {
                        console.warn('[MoneyIsTime] Failed to retrieve rates for', base, res);
                        resolve({});
                    } else {
                        rateCache[base] = res.rates;
                        resolve(res.rates);
                    }
                });
            });
        }
        return ratesPromise;
    }

    async function annotate(el, amount, code) {
        if (el.dataset.workTime) return;
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
        hrs = Math.round(hrs * 100) / 100;

        const parts = [];
        if (m) parts.push(`${m} ${translations.months_unit}`);
        if (d) parts.push(`${d} ${translations.days_unit}`);
        if (hrs) parts.push(`${hrs} ${translations.hours_unit}`);

        const span = document.createElement('span');
        span.textContent = parts.join(' ');
        span.style.marginLeft = '4px';
        span.style.background = '#eef';
        span.style.padding = '2px 4px';
        span.style.borderRadius = '4px';

        el.appendChild(span);
        el.dataset.workTime = 'true';
        console.log(`[MoneyIsTime] Annotated ${amount} ${code} → ${parts.join(' ')}`);
    }

    const observer = new MutationObserver(() => walk(document.body));
    function walk(root) {
        const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let n;
        while (n = tw.nextNode()) parseNode(n);
    }
    observer.observe(document.body, { childList: true, subtree: true });
    walk(document.body);
})();