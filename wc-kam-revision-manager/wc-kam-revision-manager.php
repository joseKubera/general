<?php
/**
 * Plugin Name: WC KAM Revision Manager
 * Description: Panel de revisión de publicaciones con vista tipo tabla, checklist inline,
 *              asignación de tareas por usuario y sistema de cola configurable.
 * Version:     3.7.0
 * Author:      Kubera
 * Text Domain: wc-kam-rm
 * Requires at least: 5.8
 * Requires PHP: 7.4
 */

defined('ABSPATH') || exit;

define('WCKAMRM_VERSION', '3.7.0');
define('WCKAMRM_PATH',    plugin_dir_path(__FILE__));
define('WCKAMRM_URL',     plugin_dir_url(__FILE__));
define('WCKAMRM_FILE',    __FILE__);

// Includes
require_once WCKAMRM_PATH . 'includes/class-install.php';
require_once WCKAMRM_PATH . 'includes/class-ajax.php';
require_once WCKAMRM_PATH . 'includes/class-admin-page.php';
require_once WCKAMRM_PATH . 'includes/class-rest-api.php';

// Activation hook
register_activation_hook(__FILE__, ['WCKAMRM_Install', 'activate']);

// Boot
add_action('plugins_loaded', function () {
    if (!class_exists('WooCommerce')) return;
    WCKAMRM_Admin_Page::init();
    WCKAMRM_Ajax::init();
    WCKAMRM_Rest_API::init();
});

// Register custom post statuses for product review workflow
add_action('init', function () {
    register_post_status('ready', [
        'label'                     => _x('✅ Ready', 'post status', 'wc-kam-rm'),
        'public'                    => true,
        'show_in_admin_all_list'    => true,
        'show_in_admin_status_list' => true,
        'label_count'               => _n_noop(
            'Ready <span class="count">(%s)</span>',
            'Ready <span class="count">(%s)</span>',
            'wc-kam-rm'
        ),
    ]);
    register_post_status('inprogress', [
        'label'                     => _x('🔄 In Progress', 'post status', 'wc-kam-rm'),
        'public'                    => true,
        'show_in_admin_all_list'    => true,
        'show_in_admin_status_list' => true,
        'label_count'               => _n_noop(
            'In Progress <span class="count">(%s)</span>',
            'In Progress <span class="count">(%s)</span>',
            'wc-kam-rm'
        ),
    ]);
});

// Make custom statuses available in WooCommerce product status dropdown
add_filter('wc_product_statuses', function ($statuses) {
    $statuses['ready']      = '✅ Ready';
    $statuses['inprogress'] = '🔄 In Progress';
    return $statuses;
});

// Include custom statuses in product WP_Query when publish is the default
add_action('pre_get_posts', function ($query) {
    if (!is_admin()) return;
    if ($query->get('post_type') !== 'product') return;
    if ($query->get('post_status') !== 'publish') return;
    $query->set('post_status', ['publish', 'ready', 'inprogress']);
});
