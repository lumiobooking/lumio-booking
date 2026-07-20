<?php
/**
 * Plugin Name:       Lumio Booking
 * Plugin URI:        https://lumiobooking.com
 * Description:        Embed your salon's Lumio booking form on WordPress AND manage everything (dashboard, calendar, bookings) right inside wp-admin. Configure the booking URL + salon slug under Lumio Booking → Settings. Any "Book now" button then opens the form FULL SCREEN in one tap (phone + desktop); [lumio_booking] still embeds it inline.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Update URI:        https://lumiobooking.com/wp-update/lumio-booking
 * Author:            Lumio
 * License:           GPL-2.0-or-later
 * Text Domain:       lumio-booking
 */

if (!defined('ABSPATH')) {
    exit; // No direct access.
}

/* Everything is guarded so a duplicate/leftover copy can never cause a
 * "Cannot redeclare function" fatal error on activation. The first copy to
 * load wins; any other copy quietly no-ops. */
if (!function_exists('lumio_booking_base')) {

    if (!defined('LUMIO_BOOKING_OPT_SITE_URL')) {
        define('LUMIO_BOOKING_OPT_SITE_URL', 'lumio_booking_site_url'); // hosted web base
    }
    if (!defined('LUMIO_BOOKING_OPT_SLUG')) {
        define('LUMIO_BOOKING_OPT_SLUG', 'lumio_booking_slug');         // salon slug
    }

    /** Base URL of the hosted Lumio app (defaults to the public domain). */
    function lumio_booking_base()
    {
        $u = get_option(LUMIO_BOOKING_OPT_SITE_URL, '');
        return $u ? rtrim($u, '/') : 'https://lumiobooking.com';
    }

    /* ---- Admin menu: salon-admin dashboard embedded inside wp-admin ---- */
    add_action('admin_menu', function () {
        add_menu_page('Lumio Booking', 'Lumio Booking', 'manage_options', 'lumio-booking', 'lumio_booking_page_dashboard', 'dashicons-calendar-alt', 26);
        add_submenu_page('lumio-booking', 'Dashboard', 'Dashboard', 'manage_options', 'lumio-booking', 'lumio_booking_page_dashboard');
        add_submenu_page('lumio-booking', 'Calendar', 'Calendar', 'manage_options', 'lumio-booking-calendar', 'lumio_booking_page_calendar');
        add_submenu_page('lumio-booking', 'Bookings', 'Bookings', 'manage_options', 'lumio-booking-bookings', 'lumio_booking_page_bookings');
        add_submenu_page('lumio-booking', 'Settings', 'Settings', 'manage_options', 'lumio-booking-settings', 'lumio_booking_render_settings_page');
    });

    /** Render one embedded salon-admin page (an iframe into the hosted app). */
    function lumio_booking_embed($path, $title)
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $src = esc_url(lumio_booking_base() . $path);
        echo '<div class="wrap">';
        echo '<h1>' . esc_html($title) . '</h1>';
        echo '<p style="color:#646970;margin:4px 0 12px">Your salon overview. If prompted, sign in with your Lumio salon admin account.</p>';
        echo '<iframe src="' . $src . '" title="' . esc_attr($title) . '" allow="payment; clipboard-write" ';
        echo 'style="width:100%;height:calc(100vh - 170px);min-height:600px;border:1px solid #c3c4c7;border-radius:10px;background:#0b1120;"></iframe>';
        echo '</div>';
    }

    function lumio_booking_page_dashboard() { lumio_booking_embed('/salon', 'Lumio Dashboard'); }
    function lumio_booking_page_calendar()  { lumio_booking_embed('/salon/calendar', 'Calendar'); }
    function lumio_booking_page_bookings()  { lumio_booking_embed('/salon/bookings', 'Bookings'); }

    /* ---- Settings: URL + slug for the customer [lumio_booking] shortcode ---- */
    add_action('admin_init', function () {
        register_setting('lumio_booking_settings', LUMIO_BOOKING_OPT_SITE_URL, array(
            'type' => 'string', 'sanitize_callback' => 'esc_url_raw', 'default' => '',
        ));
        register_setting('lumio_booking_settings', LUMIO_BOOKING_OPT_SLUG, array(
            'type' => 'string', 'sanitize_callback' => 'sanitize_title', 'default' => '',
        ));
    });

    function lumio_booking_render_settings_page()
    {
        if (!current_user_can('manage_options')) {
            return;
        }
        $site_url = get_option(LUMIO_BOOKING_OPT_SITE_URL, '');
        $slug     = get_option(LUMIO_BOOKING_OPT_SLUG, '');
        $preview  = $slug ? lumio_booking_base() . '/book/' . $slug : '';
        $opt_url  = esc_attr(LUMIO_BOOKING_OPT_SITE_URL);
        $opt_slug = esc_attr(LUMIO_BOOKING_OPT_SLUG);

        echo '<div class="wrap">';
        echo '<h1>Lumio Booking — Settings</h1>';
        echo '<p>Connect this site to your salon, then add the shortcode <code>[lumio_booking]</code> to any page.</p>';
        echo '<form method="post" action="options.php">';
        settings_fields('lumio_booking_settings');
        echo '<table class="form-table" role="presentation">';
        echo '<tr><th scope="row"><label for="lumio_site_url">Booking site URL</label></th><td>';
        echo '<input name="' . $opt_url . '" id="lumio_site_url" type="url" class="regular-text" value="' . esc_attr($site_url) . '" placeholder="https://lumiobooking.com" />';
        echo '<p class="description">Leave blank to use https://lumiobooking.com.</p></td></tr>';
        echo '<tr><th scope="row"><label for="lumio_slug">Salon slug</label></th><td>';
        echo '<input name="' . $opt_slug . '" id="lumio_slug" type="text" class="regular-text" value="' . esc_attr($slug) . '" placeholder="lux-nail-spa" />';
        echo '<p class="description">The part after <code>/book/</code> in your booking link.</p></td></tr>';
        if ($preview) {
            echo '<tr><th scope="row">Your booking link</th><td><a href="' . esc_url($preview) . '" target="_blank" rel="noopener">' . esc_html($preview) . '</a></td></tr>';
        }
        echo '</table>';
        submit_button('Save settings');
        echo '</form>';
        echo '<hr /><h2>Show the booking form to customers</h2>';
        echo '<p><strong>Recommended — one tap, full screen.</strong> Any of these opens the booking form full screen instantly, on phones and computers:</p>';
        echo '<ol>';
        echo '<li>Add the shortcode <code>[lumio_booking_button]</code> (optional: <code>[lumio_booking_button text="Book Now" align="center"]</code>).</li>';
        echo '<li>Or point any existing button/link on your site to your booking link above — it is detected automatically.</li>';
        echo '<li>Or add the CSS class <code>lumio-book</code> to any button you already have.</li>';
        echo '</ol>';
        echo '<p><code>[lumio_booking]</code> also works: the page holding it opens the form full screen automatically, so a menu link to that page is a single tap. Embedding it inside a longer page instead? Use <code>[lumio_booking autoopen="0"]</code> to keep it inline.</p>';
        echo '<p>To manage appointments use <strong>Lumio Booking → Dashboard / Calendar / Bookings</strong> on the left.</p>';
        echo '</div>';
    }

    /* ---- Customer shortcode: [lumio_booking] ---- */
    function lumio_booking_shortcode($atts)
    {
        // 'height' is only the INITIAL height; the iframe auto-resizes to the
        // form's real content height (via a postMessage the hosted form sends),
        // so there is never empty space below it.
        $atts = shortcode_atts(array('slug' => '', 'url' => '', 'height' => '560', 'autoopen' => '1'), $atts, 'lumio_booking');
        $site = ($atts['url'] !== '') ? rtrim($atts['url'], '/') : lumio_booking_base();
        $slug = ($atts['slug'] !== '') ? $atts['slug'] : get_option(LUMIO_BOOKING_OPT_SLUG, '');
        $slug = trim((string) $slug);
        if (!$slug) {
            return current_user_can('manage_options') ? '<p><em>Lumio Booking: set your Salon slug under Lumio Booking &rarr; Settings.</em></p>' : '';
        }
        // The page holding this shortcode IS the booking page, so open the form
        // FULL SCREEN the moment it loads: the visitor's tap on the salon's
        // "Booking" menu item is then the ONLY tap needed. A button is left behind
        // so they can reopen it after closing (and it still works without JS).
        // Salons embedding the form inside a longer page opt out with autoopen="0".
        if ($atts['autoopen'] !== '0') {
            $launch = $site . '/book/' . rawurlencode($slug) . '?full=1';
            return '<script>window.__lumioAutoOpen=1;</script>' . lumio_booking_button_html($launch, 'Book Now', 'center');
        }

        $src    = esc_url($site . '/book/' . rawurlencode($slug));
        $height = max(320, intval($atts['height']));

        // Origin of the booking site, for a safe postMessage check.
        $scheme = parse_url($site, PHP_URL_SCHEME);
        $host   = parse_url($site, PHP_URL_HOST);
        $origin = ($scheme && $host) ? $scheme . '://' . $host : '';
        $fid    = 'lumio-booking-' . wp_rand(1000, 99999);

        $html  = '<div class="lumio-booking-embed" style="width:100%;max-width:1200px;margin:0 auto;">';
        $html .= '<iframe id="' . esc_attr($fid) . '" src="' . $src . '" loading="lazy" title="Book an appointment" allow="payment" ';
        $html .= 'style="width:100%;min-height:' . $height . 'px;border:0;border-radius:16px;overflow:hidden;background:transparent;display:block;"></iframe>';
        $html .= '</div>';
        // Auto-resize: match the iframe to the form's reported content height.
        // Auto-resize + scroll-chaining now live in a script hosted on the booking site, so
        // every future embed fix ships with the app and this plugin NEVER needs updating
        // again. The inline part only registers this iframe and loads that script, plus a
        // small fallback that keeps auto-height working if the script cannot be fetched.
        $html .= '<script>(function(){'
            . 'var L=window.LumioEmbed=window.LumioEmbed||{frames:[]};'
            . 'L.frames.push({id:' . wp_json_encode($fid) . ',origin:' . wp_json_encode($origin) . '});'
            . 'if(L.boot){return;}L.boot=1;'
            . 'var s=document.createElement("script");s.src=' . wp_json_encode($site . '/embed.js?v=4') . ';s.async=true;document.head.appendChild(s);'
            . 'setTimeout(function(){if(L.ready){return;}'
            . 'window.addEventListener("message",function(e){var d=e.data;if(!d||d.type!=="lumio-embed-height"){return;}'
            . 'for(var i=0;i<L.frames.length;i++){var fr=L.frames[i];if(fr.origin&&e.origin!==fr.origin){continue;}'
            . 'var f=document.getElementById(fr.id);if(!f){continue;}var h=parseInt(d.height,10);'
            . 'if(h&&h>120){f.style.height=h+"px";f.style.minHeight="0px";}}});},3000);'
            . '})();</script>';
        return $html;
    }
    /* ---- One-tap FULL-SCREEN booking overlay ------------------------------
     * Problem this solves: an inline iframe has no viewport of its own, so on a
     * phone the form used to show a teaser card that the visitor had to tap a
     * SECOND time before the real form appeared. Now any "Book now" button opens
     * the form full screen on the first tap, on phone and desktop alike.
     *
     * A button counts as a trigger when it has class `lumio-book`, the attribute
     * `data-lumio-book`, or simply links to the salon's /book/<slug> URL.
     * The overlay is pre-loaded while the page is idle, so it opens instantly. */

    /** Booking URL that renders full screen (the app skips the teaser card). */
    function lumio_booking_launch_url()
    {
        $slug = trim((string) get_option(LUMIO_BOOKING_OPT_SLUG, ''));
        if (!$slug) {
            return '';
        }
        return lumio_booking_base() . '/book/' . rawurlencode($slug) . '?full=1';
    }

    add_action('wp_footer', function () {
        $url = lumio_booking_launch_url();
        if (!$url) {
            return;
        }
        $slug  = trim((string) get_option(LUMIO_BOOKING_OPT_SLUG, ''));
        $match = '/book/' . rawurlencode($slug);
        echo '<script>(function(){'
            . 'if(window.__lumioLaunch){return;}window.__lumioLaunch=1;'
            . 'var U=' . wp_json_encode($url) . ',M=' . wp_json_encode($match) . ';'
            . 'var wrap=null,frame=null,isOpen=false,savedY=0,pushed=false;'
            . 'function build(){if(wrap){return;}'
            . 'wrap=document.createElement("div");wrap.setAttribute("aria-hidden","true");'
            . 'wrap.style.cssText="position:fixed;top:0;left:0;right:0;bottom:0;z-index:2147483000;background:#fff;display:none;";'
            . 'frame=document.createElement("iframe");frame.title="Book an appointment";'
            . 'frame.setAttribute("allow","payment");'
            . 'frame.style.cssText="width:100%;height:100%;border:0;display:block;";frame.src=U;'
            . 'var x=document.createElement("button");x.type="button";x.setAttribute("aria-label","Close");x.innerHTML="&times;";'
            . 'x.style.cssText="position:absolute;top:calc(8px + env(safe-area-inset-top));right:calc(8px + env(safe-area-inset-right));'
            . 'width:40px;height:40px;border-radius:20px;border:0;background:rgba(15,23,42,.72);color:#fff;'
            . 'font:600 26px/1 system-ui,-apple-system,sans-serif;cursor:pointer;z-index:2;";'
            . 'x.addEventListener("click",function(){closeOverlay();});'
            . 'wrap.appendChild(frame);wrap.appendChild(x);document.body.appendChild(wrap);}'
            . 'function openOverlay(noHist){build();if(isOpen){return;}isOpen=true;'
            . 'savedY=window.pageYOffset||document.documentElement.scrollTop||0;'
            . 'wrap.style.display="block";wrap.removeAttribute("aria-hidden");'
            . 'document.body.style.position="fixed";document.body.style.top=(-savedY)+"px";'
            . 'document.body.style.left="0";document.body.style.right="0";'
            . 'document.body.style.width="100%";document.body.style.overflow="hidden";'
            . 'if(!noHist){try{history.pushState({lumioBook:1},"");pushed=true;}catch(e){}}}'
            . 'function closeOverlay(fromPop){if(!isOpen){return;}isOpen=false;'
            . 'wrap.style.display="none";wrap.setAttribute("aria-hidden","true");'
            . 'document.body.style.position="";document.body.style.top="";document.body.style.left="";'
            . 'document.body.style.right="";document.body.style.width="";document.body.style.overflow="";'
            . 'window.scrollTo(0,savedY);'
            . 'if(!fromPop&&pushed){pushed=false;try{history.back();}catch(e){}}}'
            . 'function hit(el){if(!el||!el.getAttribute){return false;}'
            . 'if(el.classList&&el.classList.contains("lumio-book")){return true;}'
            . 'if(el.hasAttribute("data-lumio-book")){return true;}'
            . 'var h=el.getAttribute("href");return !!(h&&h.indexOf(M)!==-1);}'
            . 'document.addEventListener("click",function(ev){var el=ev.target;'
            . 'while(el&&el!==document.body){if(hit(el)){ev.preventDefault();ev.stopPropagation();openOverlay();return;}'
            . 'el=el.parentElement;}},true);'
            . 'document.addEventListener("keydown",function(e){if(e.key==="Escape"){closeOverlay();}});'
            . 'window.addEventListener("popstate",function(){if(isOpen){closeOverlay(true);}});'
            . 'window.addEventListener("message",function(e){var d=e.data;'
            . 'if(d&&typeof d==="object"&&(d.type==="lumio-embed-collapse"||d.type==="lumio-booking-close")){closeOverlay();}});'
            . 'function pre(){if(document.querySelector(".lumio-book,[data-lumio-book],a[href*=\'"+M+"\']")){build();}}'
            . 'if(window.requestIdleCallback){requestIdleCallback(pre,{timeout:3000});}else{setTimeout(pre,1500);}'
            // Booking page: show the form straight away (no history entry, so the
            // Back button on a phone returns to the previous page as expected.
            . 'if(window.__lumioAutoOpen){openOverlay(true);}'
            . '})();</script>';
    });

    /** A "Book now" button that opens the full-screen overlay (real link = works without JS). */
    function lumio_booking_button_html($url, $text = 'Book Now', $align = 'left', $color = '#4f46e5')
    {
        $align = in_array($align, array('left', 'center', 'right'), true) ? $align : 'left';
        $style = 'display:inline-block;padding:14px 28px;border-radius:999px;background:' . esc_attr($color)
               . ';color:#fff;font-weight:700;font-size:16px;text-decoration:none;line-height:1;';
        return '<div style="text-align:' . esc_attr($align) . '"><a class="lumio-book" href="' . esc_url($url) . '" style="' . $style . '">'
             . esc_html($text) . '</a></div>';
    }

    /* ---- Customer shortcode: [lumio_booking_button] ---- */
    function lumio_booking_button_shortcode($atts)
    {
        $atts = shortcode_atts(array('text' => 'Book Now', 'align' => 'left', 'color' => '#4f46e5'), $atts, 'lumio_booking_button');
        $url = lumio_booking_launch_url();
        if (!$url) {
            return current_user_can('manage_options') ? '<p><em>Lumio Booking: set your Salon slug under Lumio Booking &rarr; Settings.</em></p>' : '';
        }
        return lumio_booking_button_html($url, $atts['text'], $atts['align'], $atts['color']);
    }
    add_shortcode('lumio_booking_button', 'lumio_booking_button_shortcode');

    /* ---- Self-update ------------------------------------------------------
     * Salons never re-upload this plugin again. WordPress asks the manifest on
     * lumiobooking.com for the latest build, shows it in wp-admin and installs
     * it automatically. The hook name is derived from the "Update URI" header
     * above, so it fires ONLY for this plugin and can never disturb the update
     * checks of any other plugin on the site. */
    if (!defined('LUMIO_BOOKING_UPDATE_URL')) {
        define('LUMIO_BOOKING_UPDATE_URL', 'https://lumiobooking.com/wp-update/lumio-booking.json');
    }

    /** Latest published build info, cached so we never hammer the server. */
    function lumio_booking_remote_manifest()
    {
        $cached = get_transient('lumio_booking_manifest');
        if ($cached !== false) {
            return is_array($cached) ? $cached : array();
        }
        $res = wp_remote_get(LUMIO_BOOKING_UPDATE_URL, array(
            'timeout' => 8,
            'headers' => array('Accept' => 'application/json'),
        ));
        if (is_wp_error($res) || (int) wp_remote_retrieve_response_code($res) !== 200) {
            // Back off for a while so an outage cannot slow down wp-admin.
            set_transient('lumio_booking_manifest', array(), 3 * HOUR_IN_SECONDS);
            return array();
        }
        $data = json_decode(wp_remote_retrieve_body($res), true);
        $data = is_array($data) ? $data : array();
        set_transient('lumio_booking_manifest', $data, 6 * HOUR_IN_SECONDS);
        return $data;
    }

    add_filter('update_plugins_lumiobooking.com', function ($update, $plugin_data, $plugin_file) {
        $m = lumio_booking_remote_manifest();
        if (empty($m['version']) || empty($m['download_url'])) {
            return $update;
        }
        $current = isset($plugin_data['Version']) ? $plugin_data['Version'] : '0';
        if (version_compare($m['version'], $current, '<=')) {
            return $update; // already up to date
        }
        return array(
            'id'           => 'lumiobooking.com/lumio-booking',
            'slug'         => 'lumio-booking',
            'plugin'       => $plugin_file,
            'version'      => $m['version'],
            'url'          => isset($m['homepage']) ? $m['homepage'] : 'https://lumiobooking.com',
            'package'      => $m['download_url'],
            'tested'       => isset($m['tested']) ? $m['tested'] : '',
            'requires_php' => isset($m['requires_php']) ? $m['requires_php'] : '7.4',
        );
    }, 10, 3);

    /* Install those updates without anyone clicking anything. */
    add_filter('auto_update_plugin', function ($update, $item) {
        if (isset($item->slug) && $item->slug === 'lumio-booking') {
            return true;
        }
        return $update;
    }, 10, 2);

    add_shortcode('lumio_booking', 'lumio_booking_shortcode');
}
