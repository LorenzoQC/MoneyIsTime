chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'getRates') {
        fetch(`https://open.er-api.com/v6/latest/${message.base}`)
            .then(res => res.json())
            .then(data => sendResponse({ rates: data.rates }))
            .catch(err => sendResponse({ error: err.message }));
        return true; // keep message channel open
    }
});
