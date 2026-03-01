chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'removeCookies') {
        chrome.cookies.getAll({ domain: 'xkfw.xjtu.edu.cn' }, (cookies) => {
            console.log(cookies);
            cookies.forEach(cookie => {
                let url = `http${cookie.secure ? 's' : ''}://${cookie.domain}${cookie.path}`;
                chrome.cookies.remove({
                    url: url,
                    name: cookie.name
                }, (removed) => {
                    if (removed) {
                        console.log(`Successfully removed cookie: ${cookie.name}`);
                    } else {
                        console.log(`Failed to remove cookie: ${cookie.name}`);
                    }
                });
            });
        });
    }
});