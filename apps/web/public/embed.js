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

    // 1) Auto-height: match the iframe to the form's real content height, so the
    //    HOST page scrolls the form exactly like any other block on the site.
    if (d.type === 'lumio-embed-height') {
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

    // 5) Jump to a position inside the form (a category tab was tapped). y is in the
    //    form's own coordinates; we scroll the HOST page to it.
    if (d.type === 'lumio-embed-scroll-to') {
      var yy = parseInt(d.y, 10) || 0;
      var rr = hit.el.getBoundingClientRect();
      var py = window.pageYOffset || document.documentElement.scrollTop || 0;
      var to = Math.max(0, py + rr.top + yy - 12);
      try { window.scrollTo({ top: to, behavior: 'smooth' }); }
      catch (err) { window.scrollTo(0, to); }
      return;
    }
  });

  /* -------------------------------------------------------------------------
   * The form has no scrollbar of its own (the iframe is as tall as its content —
   * that is what keeps the page scrolling naturally). So it cannot know what part
   * of itself the visitor is looking at. We tell it, on every host scroll: where
   * the frame sits in the viewport, and how tall the viewport is.
   *
   * With that one number the form can keep its category tabs and its action bar
   * pinned to the screen, and light up the category you are actually reading —
   * exactly like the hosted booking page, without ever trapping the scroll.
   * ---------------------------------------------------------------------- */
  var ticking = false;
  function broadcast() {
    ticking = false;
    var list = L.frames || [];
    for (var i = 0; i < list.length; i++) {
      var el = document.getElementById(list[i].id);
      if (!el || !el.contentWindow) continue;
      var r = el.getBoundingClientRect();
      try {
        el.contentWindow.postMessage({
          type: 'lumio-host-viewport',
          top: Math.round(r.top),
          height: Math.round(window.innerHeight || 0),
        }, list[i].origin || '*');
      } catch (err) { /* cross-origin during load */ }
    }
  }
  function onScroll() {
    if (ticking) return;
    ticking = true;
    (window.requestAnimationFrame || window.setTimeout)(broadcast, 16);
  }
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
  // A slow heartbeat only — enough to catch a lazy-loaded frame or a layout shift.
  // Anything faster fights the rAF updates above and shows up as a stutter.
  window.setInterval(broadcast, 1000);
  broadcast();
})();
