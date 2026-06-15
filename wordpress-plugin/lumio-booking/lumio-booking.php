<?php
/**
 * Plugin Name:       Lumio Booking
 * Plugin URI:        https://lumio.example.com
 * Description:        Embed your salon's Lumio booking page on WordPress. Configure the booking URL + salon slug in Settings → Lumio Booking, then add the [lumio_booking] shortcode to any page.
 * Version:           0.3.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            Lumio
 * License:           GPL-2.0-or-later
 * Text Domain:       lumio-booking
 */

if (!defined('ABSPATH')) {
    exit; // No direct access.
}

define('LUMIO_BOOKING_OPT_SITE_URL', 'lumio_booking_site_url'); // hosted web base, e.g. https://lumio-web-xxxx.onrender.com
define('LUMIO_BOOKING_OPT_SLUG', 'lumio_booking_slug');         // salon slug, e.g. salon-a

/* ===========================================================================
 * Settings page (Settings -> Lumio Booking)
 * ======================================================================== */

add_action('admin_menu', function () {
    add_options_page('Lumio Booking', 'Lumio Booking', 'manage_options', 'lumio-booking', 'lumio_booking_render_settings_page');
});

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
    $preview  = ($site_url && $slug) ? rtrim($site_url, '/') . '/book/' . $slug : '';

    $opt_url  = esc_attr(LUMIO_BOOKING_OPT_SITE_URL);
    $opt_slug = esc_attr(LUMIO_BOOKING_OPT_SLUG);

    echo '<div class="wrap">';
    echo '<h1>Lumio Booking</h1>';
    echo '<p>Connect this site to your salon\'s Lumio account, then add the shortcode <code>[lumio_booking]</code> to any page.</p>';

    echo '<form method="post" action="options.php">';
    settings_fields('lumio_booking_settings');

    echo '<table class="form-table" role="presentation">';

    echo '<tr><th scope="row"><label for="lumio_site_url">Booking site URL</label></th><td>';
    echo '<input name="' . $opt_url . '" id="lumio_site_url" type="url" class="regular-text" value="' . esc_attr($site_url) . '" placeholder="https://lumio-web-1xqk.onrender.com" />';
    echo '<p class="description">Your Lumio web address (no trailing slash).</p>';
    echo '</td></tr>';

    echo '<tr><th scope="row"><label for="lumio_slug">Salon slug</label></th><td>';
    echo '<input name="' . $opt_slug . '" id="lumio_slug" type="text" class="regular-text" value="' . esc_attr($slug) . '" placeholder="salon-a" />';
    echo '<p class="description">The salon identifier from your Lumio account (e.g. <code>luxnailspa</code>).</p>';
    echo '</td></tr>';

    if ($preview) {
        echo '<tr><th scope="row">Your booking link</th><td><a href="' . esc_url($preview) . '" target="_blank" rel="noopener">' . esc_html($preview) . '</a></td></tr>';
    }

    echo '</table>';
    submit_button('Save settings');
    echo '</form>';

    echo '<hr />';
    echo '<h2>How to display the booking form</h2>';
    echo '<p>Add this shortcode to any page or post:</p>';
    echo '<p><code>[lumio_booking]</code></p>';
    echo '<p>Optional attributes: <code>[lumio_booking slug="luxnailspa" height="820"]</code></p>';
    echo '</div>';
}

/* ===========================================================================
 * Shortcode: [lumio_booking] — embeds the hosted booking wizard
 * ======================================================================== */

function lumio_booking_shortcode($atts)
{
    $atts = shortcode_atts(array(
        'slug'   => '',
        'url'    => '',
        'height' => '820',
    ), $atts, 'lumio_booking');

    $site = ($atts['url'] !== '') ? $atts['url'] : get_option(LUMIO_BOOKING_OPT_SITE_URL, '');
    $slug = ($atts['slug'] !== '') ? $atts['slug'] : get_option(LUMIO_BOOKING_OPT_SLUG, '');
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

    $html  = '<div class="lumio-booking-embed" style="width:100%;max-width:980px;margin:0 auto;">';
    $html .= '<iframe src="' . $src . '" loading="lazy" title="Book an appointment" allow="payment" ';
    $html .= 'style="width:100%;min-height:' . $height . 'px;border:0;border-radius:16px;overflow:hidden;background:transparent;"></iframe>';
    $html .= '</div>';

    return $html;
}
add_shortcode('lumio_booking', 'lumio_booking_shortcode');
