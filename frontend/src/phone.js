// A phone (or any window narrower than the kiosk could ever be) gets PhoneApp, a
// plain scrolling Settings page, instead of the scaled 1920x1080 canvas. Decided
// once at boot. `?phone` forces it and `?kiosk` forbids it, for testing on a desktop.
export const IS_PHONE = (() => {
  try {
    const q = new URLSearchParams(window.location.search);
    if (q.has('kiosk')) return false;
    if (q.has('phone')) return true;
    return window.matchMedia('(max-width: 720px)').matches;
  } catch {
    return false;
  }
})();
