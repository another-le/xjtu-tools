// 雨课堂需要在页面主上下文中覆盖可见性 API。
(function preventRainClassroomPausing() {
    if (!location.hostname.includes('yuketang')) return;

    Object.defineProperty(document, 'hidden', {
        get: () => false
    });
    Object.defineProperty(document, 'visibilityState', {
        get: () => 'visible'
    });

    document.hasFocus = () => true;

    const stop = e => e.stopImmediatePropagation();
    document.addEventListener('visibilitychange', stop, true);
    window.addEventListener('blur', stop, true);

    let isTabHidden = false;
    let userPaused = false;

    document.addEventListener('visibilitychange', () => {
        isTabHidden = document.hidden;
    });

    document.addEventListener('play', (e) => {
        if (e.target.tagName === 'VIDEO') userPaused = false;
    }, true);

    document.addEventListener('pause', (e) => {
        if (e.target.tagName === 'VIDEO') userPaused = true;
    }, true);

    document.addEventListener('click', (e) => {
        const target = e.target.closest('button, [role="button"]');
        if (target && (target.textContent.includes('暂停') || target.className.includes('pause'))) {
            userPaused = true;
        }
    }, true);

    setInterval(() => {
        if (!isTabHidden || userPaused) return;
        document.querySelectorAll('video').forEach(video => {
            if (video.paused) video.play().catch(() => { });
        });
    }, 1000);
})();
