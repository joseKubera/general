<?php
defined('ABSPATH') || exit;

class WCKAMRM_Admin_Page {

    public static function init() {
        add_action('admin_menu',            [__CLASS__, 'register_menu']);
        add_action('admin_enqueue_scripts', [__CLASS__, 'enqueue_assets']);
    }

    public static function register_menu() {
        add_submenu_page(
            'woocommerce',
            '🔍 Revisión de Publicaciones',
            '🔍 Revisión',
            'edit_products',
            'kam-revision-manager',
            [__CLASS__, 'render_page']
        );

        // Settings submenu — admin only
        add_submenu_page(
            'woocommerce',
            'Configuración Revisión KAM',
            null, // hidden
            'manage_woocommerce',
            'kam-revision-settings',
            [__CLASS__, 'render_settings']
        );
    }

    public static function enqueue_assets($hook) {
        if (strpos($hook, 'kam-revision') === false) return;

        wp_enqueue_style(
            'wckamrm-style',
            WCKAMRM_URL . 'assets/revision-manager.css',
            [],
            WCKAMRM_VERSION
        );

        wp_enqueue_media(); // Required for gallery image picker

        wp_enqueue_script(
            'wckamrm-app',
            WCKAMRM_URL . 'assets/revision-manager.js',
            ['jquery'],
            WCKAMRM_VERSION,
            true
        );

        wp_localize_script('wckamrm-app', 'WCKAMRM', [
            'ajax_url'    => admin_url('admin-ajax.php'),
            'rest_url'    => rest_url('wckamrm/v1/'),
            'nonce'       => wp_create_nonce('wckamrm_nonce'),
            'rest_nonce'  => wp_create_nonce('wp_rest'),
            'current_user'=> get_current_user_id(),
            'is_admin'    => current_user_can('manage_woocommerce') ? 1 : 0,
            'daily_quota' => (int) get_option('wckamrm_daily_quota', 20),
            'users'       => self::get_kam_users(),
            'tags'        => self::get_product_tags(),
            'i18n'        => [
                'saving'     => 'Guardando...',
                'saved'      => '✅ Guardado',
                'error'      => '❌ Error',
                'confirm_assign' => '¿Asignar estos productos?',
            ],
        ]);
    }

    public static function get_product_tags() {
        $terms = get_terms(['taxonomy' => 'product_tag', 'hide_empty' => false, 'number' => 200]);
        if (is_wp_error($terms)) return [];
        return array_map(fn($t) => ['id' => $t->term_id, 'name' => $t->name], $terms);
    }

    public static function get_kam_users() {
        $users = get_users(['role__in' => ['editor', 'shop_manager', 'administrator']]);
        return array_map(fn($u) => [
            'id'   => $u->ID,
            'name' => $u->display_name,
        ], $users);
    }

    public static function render_page() {
        if (!current_user_can('edit_products')) {
            wp_die('No tienes permisos para acceder a esta página.');
        }
        include WCKAMRM_PATH . 'templates/page-revision-manager.php';
    }

    public static function render_settings() {
        if (!current_user_can('manage_woocommerce')) {
            wp_die('No tienes permisos.');
        }

        if (isset($_POST['wckamrm_save_settings']) && check_admin_referer('wckamrm_settings')) {
            update_option('wckamrm_daily_quota', absint($_POST['daily_quota'] ?? 20));
        }

        $quota = (int) get_option('wckamrm_daily_quota', 20);
        include WCKAMRM_PATH . 'templates/page-settings.php';
    }
}
