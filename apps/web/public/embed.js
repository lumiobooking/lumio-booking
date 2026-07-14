/*!
 * Lumio Booking — embed helper.
 *
 * The WordPress plugin loads this file from lumiobooking.com instead of shipping
 * the logic inline, so any future embed fix ships with the app and salons never
 * have to update the plugin again.
 *
 * The plugin registers each iframe in window.LumioEmbed.frames = [{id, origin}].
 * Messages are matched by contentWindow (safe with several widgets on one page)
 * and by origin.
 */
(function () {
  var L = (window.LumioEmbed = window.LumioEmbed || { frames: [] });
  if (L.ready) return; // already wired (e.g. script included twice)
  L.ready = 1;

  function sizeApp(el, cfg) {
    var vh = window.innerHeight || 800;
    var h = Math.max(cfg.min, Math.min(cfg.max, Math.round(vh * cfg.ratio)));
    el.style.height = h + 'px';
    el.style.minHeight = '0px';
  }

  function frameFor(source) {
    var list = L.frames || [];
    for (var i = 0; i < list.length; i++) {
      var el = document.getElementById(list[i].id);
      if (el && el.contentWindow === source) return { el: el, origin: list[i].origin };
    }
    return null;
  }

  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || typeof d !== 'object' || !d.type) return;

    var hit = frameFor(e.source);
    if (!hit) return;                                   // not one of our widgets
    if (hit.origin && e.origin !== hit.origin) return;  // wrong origin

    // 0) App mode: the widget asks for a FIXED viewport-sized frame and scrolls its
    //    own menu inside it — that is the only way the sticky header, the sticky
    //    category tabs and the "tabs follow the scroll" behaviour can work inside an
    //    iframe (an iframe sized to its content never scrolls, so nothing can stick).
    if (d.type === 'lumio-embed-app') {
      var cfg = {
        min: parseInt(d.min, 10) || 520,
        max: parseInt(d.max, 10) || 900,
        ratio: parseFloat(d.ratio) || 0.86,
      };
      hit.el.__lumioApp = cfg;
      sizeApp(hit.el, cfg);
      if (!L.resizeWired) {
        L.resizeWired = 1;
        window.addEventListener('resize', function () {
          var list = L.frames || [];
          for (var i = 0; i < list.length; i++) {
            var el = document.getElementById(list[i].id);
            if (el && el.__lumioApp) sizeApp(el, el.__lumioApp);
          }
        });
      }
      return;
    }

    // 1) Auto-height (classic mode): match the iframe to the form's content height.
    if (d.type === 'lumio-embed-height') {
      if (hit.el.__lumioApp) return; // app mode owns the height
      var h = parseInt(d.height, 10);
      if (h && h > 120) {
        hit.el.style.height = h + 'px';
        hit.el.style.minHeight = '0px';
      }
      return;
    }

    // 2) Scroll chaining: the form's inner list hit its top/bottom and the visitor
    //    kept swiping, so keep scrolling the host page (an iframe cannot chain the
    //    scroll out by itself, iOS especially).
    if (d.type === 'lumio-embed-scroll') {
      var dy = parseInt(d.dy, 10);
      if (dy) window.scrollBy(0, dy);
      return;
    }

    // 3) Reveal the form's action bar (Back/Continue). The form asks for this the
    //    moment a choice enables Continue, so the visitor never has to hunt for it at
    //    the bottom of a long service list. y/h are the bar's position inside the
    //    iframe; we scroll the host page just enough to bring it on screen.
    if (d.type === 'lumio-embed-reveal') {
      if (hit.el.__lumioApp) return; // the action bar is always visible in app mode
      var y = parseInt(d.y, 10) || 0;
      var bh = parseInt(d.h, 10) || 0;
      var r = hit.el.getBoundingClientRect();
      var vh = window.innerHeight || 0;
      var pageY = window.pageYOffset || document.documentElement.scrollTop || 0;
      var barTop = pageY + r.top + y;      // action bar, in page coordinates
      var barBot = barTop + bh;
      var target = null;
      if (barBot + 24 > pageY + vh) {
        target = barBot + 24 - vh;         // bar is below the fold -> come up to it
      } else if (barTop - 24 < pageY) {
        target = Math.max(0, barTop - 90); // bar is ABOVE the fold (the form just got
      }                                    // shorter) -> come back down to it
      if (target !== null && Math.abs(target - pageY) > 4) {
        try { window.scrollTo({ top: target, behavior: 'smooth' }); }
        catch (err) { window.scrollTo(0, target); }
      }
      return;
    }

    // 4) Bring the widget into view (used when a step changes and the form is
    //    partly off-screen).
    if (d.type === 'lumio-embed-scroll-into-view') {
      try { hit.el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
      catch (err) { hit.el.scrollIntoView(); }
      return;
    }
  });
})();
