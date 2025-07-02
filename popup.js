const defaults = {
    salary: 0,
    salaryType: 'hourly',
    currency: 'EUR',
    hoursPerDay: 8,
    daysPerMonth: 21,
    enabled: true,
    language: 'en'
};

let translations;
let currentDomain = null;
let currentBlacklist = [];

async function loadTranslations() {
    const res = await fetch(chrome.runtime.getURL('translations.json'));
    translations = await res.json();
}

function applyI18n(lang) {
    const t = translations[lang] || translations.en;

    document.getElementById('header-title').textContent = t.settings_label;
    document.getElementById('group-salary-title').textContent = t.salary_label;

    const salaryType = document.getElementById('salary-type');
    const current = salaryType.value;
    salaryType.innerHTML = `
        <option value="hourly">${t.salary_type_hourly}</option>
        <option value="daily">${t.salary_type_daily}</option>
        <option value="monthly">${t.salary_type_monthly}</option>
    `;
    if (current) salaryType.value = current;

    document.getElementById('working-hours-label').textContent = t.working_hours_per_day_label;
    document.getElementById('working-days-label').textContent = t.working_days_per_month_label;
    document.getElementById('group-working-title').textContent = t.working_time_group_label;

    const excludeButton = document.getElementById('exclude-site-button');
    if (excludeButton.disabled) {
        excludeButton.textContent = t.cannot_determine_site;
    }
}

function setExcludeButton(domain, blacklist, lang) {
    const excludeButton = document.getElementById('exclude-site-button');
    const isExcluded = blacklist.includes(domain);
    excludeButton.classList.toggle('exclude', !isExcluded);
    excludeButton.classList.toggle('include', isExcluded);
    excludeButton.disabled = false;
    excludeButton.textContent = `${translations[lang][isExcluded ? 'include_site' : 'exclude_site']} ${domain}`;
}

function loadOptions() {
    chrome.storage.local.get(defaults, opts => {
        applyI18n(opts.language);

        document.getElementById('salary').value = opts.salary;
        document.getElementById('salary-type').value = opts.salaryType;
        document.getElementById('currency').value = opts.currency;
        document.getElementById('hours-per-day').value = opts.hoursPerDay;
        document.getElementById('days-per-month').value = opts.daysPerMonth;
        document.getElementById('enabled').checked = opts.enabled;
        document.getElementById('language').value = opts.language;
    });
}

function saveOptions(e) {
    e.preventDefault();
    const opts = {
        salary: parseFloat(document.getElementById('salary').value),
        salaryType: document.getElementById('salary-type').value,
        currency: document.getElementById('currency').value.toUpperCase(),
        hoursPerDay: parseFloat(document.getElementById('hours-per-day').value),
        daysPerMonth: parseInt(document.getElementById('days-per-month').value, 10),
        enabled: document.getElementById('enabled').checked,
        language: document.getElementById('language').value
    };
    chrome.storage.local.set(opts);
}

async function getCurrentTabDomain() {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            try {
                const url = new URL(tabs[0].url);
                resolve(url.hostname);
            } catch {
                resolve(null);
            }
        });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations();

    chrome.storage.local.get(defaults, async opts => {
        applyI18n(opts.language);

        document.getElementById('salary').value = opts.salary;
        document.getElementById('salary-type').value = opts.salaryType;
        document.getElementById('currency').value = opts.currency;
        document.getElementById('hours-per-day').value = opts.hoursPerDay;
        document.getElementById('days-per-month').value = opts.daysPerMonth;
        document.getElementById('enabled').checked = opts.enabled;
        document.getElementById('language').value = opts.language;

        const excludeButton = document.getElementById('exclude-site-button');

        const domain = await getCurrentTabDomain();
        if (!domain) {
            excludeButton.disabled = true;
            excludeButton.textContent = translations[opts.language].cannot_determine_site;
        } else {
            excludeButton.dataset.domain = domain;
            chrome.storage.local.get({ blacklist: [] }, ({ blacklist }) => {
                currentDomain = domain;
                currentBlacklist = blacklist;
                setExcludeButton(domain, blacklist, opts.language);
            });
        }

        excludeButton.addEventListener('click', () => {
            const domain = excludeButton.dataset.domain;
            chrome.storage.local.get({ blacklist: [] }, ({ blacklist }) => {
                const isExcluded = blacklist.includes(domain);
                const newList = isExcluded
                    ? blacklist.filter(d => d !== domain)
                    : [...blacklist, domain];
                chrome.storage.local.set({ blacklist: newList }, () => {
                    currentBlacklist = newList;
                    setExcludeButton(domain, newList, document.getElementById('language').value);
                });
            });
        });
    });

    document.getElementById('settings-form').addEventListener('change', saveOptions);
    document.getElementById('language').addEventListener('change', e => {
        const salaryTypeSelect = document.getElementById('salary-type');
        const currentSalaryType = salaryTypeSelect.value;
        applyI18n(e.target.value);
        salaryTypeSelect.value = currentSalaryType;
        if (currentDomain && currentBlacklist) {
            setExcludeButton(currentDomain, currentBlacklist, e.target.value);
        }
    });
});
