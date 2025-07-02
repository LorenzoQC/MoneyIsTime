/* MoneyIsTime – popup script (optimized 2025‑07‑02) */

(() => {
  // ---------- Default settings ----------
  const defaults = {
    salary: 0,
    salaryType: 'hourly',
    currency: 'EUR',
    hoursPerDay: 8,
    daysPerMonth: 21,
    enabled: true,
    language: 'en',
    blacklist: []
  };

  // ---------- Helpers ----------
  const $ = (id) => document.getElementById(id);
  let translations = {};
  let currentDomain = null;
  let currentBlacklist = [];

  const debounce = (fn, ms = 250) => {
    let t;
    return (...args) => {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(null, args), ms);
    };
  };

  /* ---------------- i18n ---------------- */
  async function loadTranslations() {
    if (Object.keys(translations).length) return translations;
    const res = await fetch(chrome.runtime.getURL('translations.json'));
    translations = await res.json();
    return translations;
  }

  function applyI18n(lang) {
    const t = translations[lang] || translations.en;

    $('header-title').textContent = t.settings_label;
    $('group-salary-title').textContent = t.salary_label;
    $('working-hours-label').textContent = t.working_hours_per_day_label;
    $('working-days-label').textContent = t.working_days_per_month_label;
    $('group-working-title').textContent = t.working_time_group_label;

    // Re‑render salary‑type select maintaining current value
    const sel = $('salary-type');
    const selVal = sel.value;
    sel.innerHTML = `
      <option value="hourly">${t.salary_type_hourly}</option>
      <option value="daily">${t.salary_type_daily}</option>
      <option value="monthly">${t.salary_type_monthly}</option>
    `;
    if (selVal) sel.value = selVal;

    // Update exclude button placeholder if needed
    const btn = $('exclude-site-button');
    if (btn.disabled) btn.textContent = t.cannot_determine_site;
  }

  /* --------- Storage helpers --------- */
  const getOptions = () => new Promise((r) => chrome.storage.local.get(defaults, r));
  const setOptions = (opts) => chrome.storage.local.set(opts);

  /* --------- Domain helpers --------- */
  async function getCurrentTabDomain() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      return new URL(tab.url).hostname;
    } catch {
      return null;
    }
  }

  /* ---- Exclude / Include current site ---- */
  function refreshExcludeButton(domain, blacklist, lang) {
    const btn = $('exclude-site-button');
    if (!domain) {
      btn.disabled = true;
      btn.textContent = translations[lang].cannot_determine_site;
      return;
    }

    const isExcluded = blacklist.includes(domain);
    btn.classList.toggle('exclude', !isExcluded);
    btn.classList.toggle('include', isExcluded);
    btn.disabled = false;

    const key = isExcluded ? 'include_site' : 'exclude_site';
    btn.textContent = `${translations[lang][key]} ${domain}`;
  }

  /* ------------- Save handler ------------- */
  const saveOptions = debounce(() => {
    setOptions({
      salary: parseFloat($('salary').value) || 0,
      salaryType: $('salary-type').value,
      currency: $('currency').value.toUpperCase(),
      hoursPerDay: parseFloat($('hours-per-day').value) || 0,
      daysPerMonth: parseInt($('days-per-month').value, 10) || 0,
      enabled: $('enabled').checked,
      language: $('language').value
    });
  });

  /* --------------- Boot ---------------- */
  document.addEventListener('DOMContentLoaded', async () => {
    await loadTranslations();
    const opts = await getOptions();
    applyI18n(opts.language);

    // Populate form with stored values
    $('salary').value = opts.salary;
    $('salary-type').value = opts.salaryType;
    $('currency').value = opts.currency;
    $('hours-per-day').value = opts.hoursPerDay;
    $('days-per-month').value = opts.daysPerMonth;
    $('enabled').checked = opts.enabled;
    $('language').value = opts.language;
    currentBlacklist = opts.blacklist;

    // Domain‑specific logic
    currentDomain = await getCurrentTabDomain();
    refreshExcludeButton(currentDomain, currentBlacklist, opts.language);

    // ---- Event listeners ----
    $('settings-form').addEventListener('input', saveOptions);

    $('language').addEventListener('change', (e) => {
      applyI18n(e.target.value);
      refreshExcludeButton(currentDomain, currentBlacklist, e.target.value);
      saveOptions(); // persist language change immediately
    });

    $('exclude-site-button').addEventListener('click', () => {
      if (!currentDomain) return;
      const isExcluded = currentBlacklist.includes(currentDomain);
      currentBlacklist = isExcluded
        ? currentBlacklist.filter((d) => d !== currentDomain)
        : [...currentBlacklist, currentDomain];
      chrome.storage.local.set({ blacklist: currentBlacklist }, () => {
        refreshExcludeButton(currentDomain, currentBlacklist, $('language').value);
      });
    });
  });
})();
