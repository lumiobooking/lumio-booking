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

    // 1) Auto-height: match the iframe to the form's real content height.
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
      var pageY = window.pageYOffset || document.documentElement.scrollTop || 0;
      var target = pageY + r.top + y + bh + 24 - (window.innerHeight || 0);
      if (target > pageY) {
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
