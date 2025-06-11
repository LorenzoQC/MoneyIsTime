chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'getRates') {
        fetch(`https://open.er-api.com/v6/latest/${message.base}`)
            .then(res => res.json())
            .then(data => sendResponse({ rates: data.rates }))
            .catch(err => sendResponse({ error: err.message }));
        return true;
    }
    
    if (message.type === 'getTranslations') {
        fetch(chrome.runtime.getURL('translations.json'))
            .then(res => res.json())
            .then(data => sendResponse({ translations: data }))
            .catch(err => sendResponse({ error: err.message }));
        return true;
    }
});
