<?php
/**
 * Plugin Name:       Lumio Booking
 * Plugin URI:        https://lumio.example.com
 * Description:        Add your salon's Lumio booking form to WordPress. Easiest way: embed the hosted booking page with [lumio_booking]. Advanced: a native form that proxies the Lumio API with a secure key.
 * Version:           0.2.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Lumio
 * License:           GPL-2.0-or-later
 * Text Domain:       lumio-booking
 *
 * SECURITY MODEL
 * --------------
 * Nothing is hard-coded. The salon enters its own values on the settings page:
 *  - Booking site URL + salon slug  -> used by the [lumio_booking] embed.
 *  - (Advanced) API base URL + API key -> used by the native [lumio_booking_form].
 * The API key is stored in WordPress options and used ONLY server-side: the
 * browser calls this plugin's own REST proxy (same-origin) and PHP forwards the
 * request to the Lumio backend with the X-Lumio-Api-Key header. Visitors never
 * see the key.
 */

if (!defined('ABSPATH')) {
    exit; // No direct access.
}

define('LUMIO_BOOKING_OPT_SITE_URL', 'lumio_booking_site_url'); // hosted web base, e.g. https://lumio-web-xxxx.onrender.com
define('LUMIO_BOOKING_OPT_SLUG', 'lumio_booking_slug');         // salon slug, e.g. salon-a
define('LUMIO_BOOKING_OPT_API_URL', 'lumio_booking_api_url');   // (advanced) API base, e.g. https://lumio-api-xxxx.onrender.com/api
define('LUMIO_BOOKING_OPT_API_KEY', 'lumio_booking_api_key');   // (advanced) tenant API key

/* ===========================================================================
 * Settings page (Settings -> Lumio Booking)
 * ======================================================================== */

add_action('admin_menu', function () {
    add_options_page('Lumio Booking', 'Lumio Booking', 'manage_options', 'lumio-booking', 'lumio_booking_render_settings_page');
});

add_action('admin_init', function () {
    register_setting('lumio_booking_settings', LUMIO_BOOKING_OPT_SITE_URL, [
        'type' => 'string', 'sanitize_callback' => 'esc_url_raw', 'default' => '',
    ]);
    register_setting('lumio_booking_settings', LUMIO_BOOKING_OPT_SLUG, [
        'type' => 'string', 'sanitize_callback' => 'sanitize_title', 'default' => '',
    ]);
    register_setting('lumio_booking_settings', LUMIO_BOOKING_OPT_API_URL, [
        'type' => 'string', 'sanitize_callback' => 'esc_url_raw', 'default' => '',
    ]);
    register_setting('lumio_booking_settings', LUMIO_BOOKING_OPT_API_KEY, [
        'type' => 'string', 'sanitize_callback' => 'sanitize_text_field', 'default' => '',
    ]);
});

function lumio_booking_render_settings_page()
{
    if (!current_user_can('manage_options')) {
        return;
    }
    $site_url = get_option(LUMIO_BOOKING_OPT_SITE_URL, '');
    $slug     = get_option(LUMIO_BOOKING_OPT_SLUG, '');
    $api_url  = get_option(LUMIO_BOOKING_OPT_API_URL, '');
    $api_key  = get_option(LUMIO_BOOKING_OPT_API_KEY, '');
    $masked   = $api_key ? (substr($api_key, 0, 10) . str_repeat('•', 6) . substr($api_key, -4)) : '';
    $preview  = ($site_url && $slug) ? rtrim($site_url, '/') . '/book/' . $slug : '';
    ?>
    <div class="wrap">
        <h1>Lumio Booking</h1>
        <p>Connect this site to your salon's Lumio account, then add the shortcode <code>[lumio_booking]</code> to any page.</p>

        <form method="post" action="options.php">
            <?php settings_fields('lumio_booking_settings'); ?>

            <h2 class="title">Booking embed (recommended)</h2>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="lumio_site_url">Booking site URL</label></th>
                    <td>
                        <input name="<?php echo esc_attr(LUMIO_BOOKING_OPT_SITE_URL); ?>" id="lumio_site_url"
                               type="url" class="regular-text" value="<?php echo esc_attr($site_url); ?>"
                               placeholder="https://lumio-web-1xqk.onrender.com" />
                        <p class="description">Your Lumio web address (no trailing slash).</p>
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="lumio_slug">Salon slug</label></th>
                    <td>
                        <input name="<?php echo esc_attr(LUMIO_BOOKING_OPT_SLUG); ?>" id="lumio_slug"
                               type="text" class="regular-text" value="<?php echo esc_attr($slug); ?>"
                               placeholder="salon-a" />
                        <p class="description">The salon identifier from your Lumio account (e.g. <code>luxnailspa</code>).</p>
                    </td>
                </tr>
                <?php if ($preview) : ?>
                <tr>
                    <th scope="row">Your booking link</th>
                    <td><a href="<?php echo esc_url($preview); ?>" target="_blank"><?php echo esc_html($preview); ?></a></td>
                </tr>
                <?php endif; ?>
            </table>

            <h2 class="title">Advanced — native form (optional)</h2>
            <p class="description">Only needed if you use the <code>[lumio_booking_form]</code> shortcode instead of the embed.</p>
            <table class="form-table" role="presentation">
                <tr>
                    <th scope="row"><label for="lumio_api_url">API base URL</label></th>
                    <td>
                        <input name="<?php echo esc_attr(LUMIO_BOOKING_OPT_API_URL); ?>" id="lumio_api_url"
                               type="url" class="regular-text" value="<?php echo esc_attr($api_url); ?>"
                               placeholder="https://lumio-api-uqm6.onrender.com/api" />
                    </td>
                </tr>
                <tr>
                    <th scope="row"><label for="lumio_api_key">API / license key</label></th>
                    <td>
                        <input name="<?php echo esc_attr(LUMIO_BOOKING_OPT_API_KEY); ?>" id="lumio_api_key"
                               type="text" class="regular-text" value="<?php echo esc_attr($api_key); ?>"
                               placeholder="lumio_sk_..." autocomplete="off" />
                        <?php if ($masked) : ?><p class="description">Current key: <code><?php echo esc_html($masked); ?></code></p><?php endif; ?>
                        <p class="description">Create it in your Lumio dashboard (Salon Admin &rarr; Integrations). Stored server-side, never shown to visitors.</p>
                    </td>
                </tr>
            </table>

            <?php submit_button('Save settings'); ?>
        </form>

        <hr />
        <h2>How to display the booking form</h2>
        <p><strong>Recommended (full booking wizard):</strong> add this shortcode to any page or post:</p>
        <p><code>[lumio_booking]</code></p>
        <p>Optional attributes: <code>[lumio_booking slug="luxnailspa" height="780"]</code></p>
        <p style="margin-top:16px;"><strong>Advanced (native form via API key):</strong></p>
        <p><code>[lumio_booking_form]</code></p>
    </div>
    <?php
}

/* ===========================================================================
 * Shortcode: [lumio_booking]  — embeds the hosted booking wizard (recommended)
 * ======================================================================== */

add_shortcode('lumio_booking', function ($atts) {
    $atts = shortcode_atts([
        'slug'   => '',
        'url'    => '',
        'height' => '780',
    ], $atts, 'lumio_booking');

    $site = $atts['url'] !== '' ? $atts['url'] : get_option(LUMIO_BOOKING_OPT_SITE_URL, '');
    $slug = $atts['slug'] !== '' ? $atts['slug'] : get_option(LUMIO_BOOKING_OPT_SLUG, '');
    $site = rtrim((string) $site, '/');
    $slug = trim((string) $slug);

    if (!$site || !$slug) {
        if (current_user_can('manage_options')) {
            return '<p><em>Lumio Booking is not configured yet. Set the Booking site URL and Salon slug in Settings &rarr; Lumio Booking.</em></p>';
        }
        return '';
    }

    $src    = esc_url($site . '/book/' . rawurlencode($slug));
    $height = max(400, intval($atts['height']));

    return '<div class="lumio-booking-embed" style="width:100%;max-width:960px;margin:0 auto;">'
        . '<iframe src="' . $src . '" loading="lazy" title="Book an appointment" '
        . 'style="width:100%;min-height:' . $height . 'px;border:0;border-radius:16px;overflow:hidden;background:transparent;" '
        . 'allow="payment"></iframe></div>';
});

/* ===========================================================================
 * Server-side REST proxy for the native form (keeps the API key secret)
 *   GET  /wp-json/lumio/v1/services
 *   GET  /wp-json/lumio/v1/staff
 *   POST /wp-json/lumio/v1/bookings
 * ======================================================================== */

add_action('rest_api_init', function () {
    register_rest_route('lumio/v1', '/services', [
        'methods' => 'GET', 'callback' => 'lumio_booking_proxy_services', 'permission_callback' => '__return_true',
    ]);
    register_rest_route('lumio/v1', '/staff', [
        'methods' => 'GET', 'callback' => 'lumio_booking_proxy_staff', 'permission_callback' => '__return_true',
    ]);
    register_rest_route('lumio/v1', '/bookings', [
        'methods' => 'POST', 'callback' => 'lumio_booking_proxy_create_booking', 'permission_callback' => '__return_true',
    ]);
});

function lumio_booking_backend_base()
{
    return rtrim(get_option(LUMIO_BOOKING_OPT_API_URL, ''), '/');
}

function lumio_booking_api_key()
{
    return trim(get_option(LUMIO_BOOKING_OPT_API_KEY, ''));
}

function lumio_booking_proxy_get($path)
{
    $base = lumio_booking_backend_base();
    $key  = lumio_booking_api_key();
    if (!$base || !$key) {
        return new WP_REST_Response(['message' => 'Lumio Booking API is not configured yet.'], 503);
    }
    $resp = wp_remote_get($base . $path, [
        'timeout' => 15,
        'headers' => ['X-Lumio-Api-Key' => $key, 'Accept' => 'application/json'],
    ]);
    return lumio_booking_relay($resp);
}

function lumio_booking_proxy_services()
{
    return lumio_booking_proxy_get('/public/services');
}

function lumio_booking_proxy_staff()
{
    return lumio_booking_proxy_get('/public/staff');
}

function lumio_booking_proxy_create_booking(WP_REST_Request $request)
{
    $base = lumio_booking_backend_base();
    $key  = lumio_booking_api_key();
    if (!$base || !$key) {
        return new WP_REST_Response(['message' => 'Lumio Booking API is not configured yet.'], 503);
    }
    $body = $request->get_json_params();
    $payload = [
        'serviceId'         => isset($body['serviceId']) ? sanitize_text_field($body['serviceId']) : '',
        'startTime'         => isset($body['startTime']) ? sanitize_text_field($body['startTime']) : '',
        'preferredStaffId'  => isset($body['preferredStaffId']) ? sanitize_text_field($body['preferredStaffId']) : null,
        'customerFirstName' => isset($body['customerFirstName']) ? sanitize_text_field($body['customerFirstName']) : '',
        'customerLastName'  => isset($body['customerLastName']) ? sanitize_text_field($body['customerLastName']) : null,
        'customerEmail'     => isset($body['customerEmail']) ? sanitize_email($body['customerEmail']) : null,
        'customerPhone'     => isset($body['customerPhone']) ? sanitize_text_field($body['customerPhone']) : null,
        'notes'             => isset($body['notes']) ? sanitize_textarea_field($body['notes']) : null,
    ];
    $payload = array_filter($payload, function ($v) {
        return $v !== null && $v !== '';
    });

    $resp = wp_remote_post($base . '/public/bookings', [
        'timeout' => 15,
        'headers' => [
            'X-Lumio-Api-Key' => $key,
            'Content-Type'    => 'application/json',
            'Accept'          => 'application/json',
        ],
        'body' => wp_json_encode($payload),
    ]);
    return lumio_booking_relay($resp);
}

function lumio_booking_relay($resp)
{
    if (is_wp_error($resp)) {
        return new WP_REST_Response(['message' => 'Could not reach the Lumio backend.'], 502);
    }
    $code = wp_remote_retrieve_response_code($resp);
    $data = json_decode(wp_remote_retrieve_body($resp), true);
    return new WP_REST_Response($data, $code ? $code : 500);
}

/* ===========================================================================
 * Shortcode: [lumio_booking_form] — native form (advanced, uses API key proxy)
 * ======================================================================== */

add_shortcode('lumio_booking_form', function () {
    $rest = esc_url_raw(rest_url('lumio/v1'));
    ob_start();
    ?>
    <div class="lumio-booking-widget" style="max-width:520px;margin:0 auto;font-family:system-ui,sans-serif;">
        <form class="lumio-booking-form" style="display:grid;gap:12px;">
            <label>Service
                <select name="serviceId" required style="width:100%;padding:8px;"></select>
            </label>
            <label>Preferred technician (optional)
                <select name="preferredStaffId" style="width:100%;padding:8px;">
                    <option value="">No preference</option>
                </select>
            </label>
            <label>Date &amp; time
                <input type="datetime-local" name="startTime" required style="width:100%;padding:8px;" />
            </label>
            <label>Your name
                <input type="text" name="customerFirstName" required style="width:100%;padding:8px;" />
            </label>
            <label>Email (optional)
                <input type="email" name="customerEmail" style="width:100%;padding:8px;" />
            </label>
            <label>Phone (optional)
                <input type="text" name="customerPhone" style="width:100%;padding:8px;" />
            </label>
            <button type="submit" style="padding:10px;background:#6366f1;color:#fff;border:none;border-radius:6px;cursor:pointer;">
                Book appointment
            </button>
            <p class="lumio-booking-message" style="margin:0;"></p>
        </form>
    </div>
    <script>
    (function () {
        var REST = <?php echo wp_json_encode($rest); ?>;
        var form = document.currentScript.previousElementSibling.querySelector('.lumio-booking-form');
        var msg = form.querySelector('.lumio-booking-message');
        var serviceSel = form.querySelector('[name=serviceId]');
        var staffSel = form.querySelector('[name=preferredStaffId]');

        fetch(REST + '/services').then(function (r) { return r.json(); }).then(function (services) {
            (services || []).forEach(function (s) {
                var o = document.createElement('option');
                o.value = s.id; o.textContent = s.name + ' (' + s.durationMinutes + ' min)';
                serviceSel.appendChild(o);
            });
        });
        fetch(REST + '/staff').then(function (r) { return r.json(); }).then(function (staff) {
            (staff || []).forEach(function (m) {
                var o = document.createElement('option');
                o.value = m.id; o.textContent = (m.firstName || '') + ' ' + (m.lastName || '');
                staffSel.appendChild(o);
            });
        });

        form.addEventListener('submit', function (e) {
            e.preventDefault();
            msg.textContent = 'Booking...'; msg.style.color = '#555';
            var data = {
                serviceId: serviceSel.value,
                preferredStaffId: staffSel.value || undefined,
                startTime: new Date(form.startTime.value).toISOString(),
                customerFirstName: form.customerFirstName.value,
                customerEmail: form.customerEmail.value || undefined,
                customerPhone: form.customerPhone.value || undefined
            };
            fetch(REST + '/bookings', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data)
            }).then(function (r) {
                return r.json().then(function (body) { return { ok: r.ok, body: body }; });
            }).then(function (res) {
                if (res.ok) {
                    msg.style.color = '#16a34a';
                    msg.textContent = 'Booking received! We will confirm shortly.';
                    form.reset();
                } else {
                    msg.style.color = '#dc2626';
                    msg.textContent = (res.body && res.body.message) ? res.body.message : 'Could not create booking.';
                }
            }).catch(function () {
                msg.style.color = '#dc2626';
                msg.textContent = 'Network error. Please try again.';
            });
        });
    })();
    </script>
    <?php
    return ob_get_clean();
});
