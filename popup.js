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

async function loadTranslations() {
    const res = await fetch(chrome.runtime.getURL('translations.json'));
    translations = await res.json();
}

function applyI18n(lang) {
    const t = translations[lang] || translations.en;

    document.getElementById('header-title').textContent = t.settings_label;
    document.getElementById('group-salary-title').textContent = t.salary_label;

    const salaryType = document.getElementById('salary-type');
    salaryType.innerHTML = `
        <option value="hourly">${t.salary_type_hourly}</option>
        <option value="daily">${t.salary_type_daily}</option>
        <option value="monthly">${t.salary_type_monthly}</option>
    `;

    document.getElementById('working-hours-label').textContent = t.working_hours_per_day_label;
    document.getElementById('working-days-label').textContent = t.working_days_per_month_label;
    document.getElementById('group-working-title').textContent = t.working_time_group_label;
}

function loadOptions() {
    chrome.storage.local.get(defaults, opts => {
        document.getElementById('salary').value = opts.salary;
        document.getElementById('salary-type').value = opts.salaryType;
        document.getElementById('currency').value = opts.currency;
        document.getElementById('hours-per-day').value = opts.hoursPerDay;
        document.getElementById('days-per-month').value = opts.daysPerMonth;
        document.getElementById('enabled').checked = opts.enabled;
        document.getElementById('language').value = opts.language;
        applyI18n(opts.language);
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

document.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations();
    loadOptions();
    document.getElementById('settings-form').addEventListener('change', saveOptions);
    document.getElementById('language').addEventListener('change', e => applyI18n(e.target.value));
});