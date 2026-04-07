<?php
defined('ABSPATH') || exit;

class WCKAMRM_Install {

    public static function activate() {
        self::create_tables();
        self::set_defaults();
    }

    public static function create_tables() {
        global $wpdb;
        $charset = $wpdb->get_charset_collate();
        $table   = $wpdb->prefix . 'kam_revision_tasks';

        $sql = "CREATE TABLE IF NOT EXISTS {$table} (
            id            BIGINT(20) UNSIGNED NOT NULL AUTO_INCREMENT,
            product_id    BIGINT(20) UNSIGNED NOT NULL,
            user_id       BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
            assigned_by   BIGINT(20) UNSIGNED NOT NULL DEFAULT 0,
            assigned_date DATE         NULL,
            status        VARCHAR(20)  NOT NULL DEFAULT 'pendiente',
            completed_at  DATETIME     NULL,
            created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY   (id),
            UNIQUE KEY    product_id (product_id),
            KEY           user_id (user_id),
            KEY           status (status),
            KEY           assigned_date (assigned_date)
        ) {$charset};";

        require_once ABSPATH . 'wp-admin/includes/upgrade.php';
        dbDelta($sql);
    }

    public static function set_defaults() {
        if (!get_option('wckamrm_daily_quota')) {
            update_option('wckamrm_daily_quota', 20);
        }
        if (!get_option('wckamrm_checklist_fields')) {
            update_option('wckamrm_checklist_fields', [
                'revision_titulo_ok',
                'revision_imagenes_ok',
                'revision_descripcion_ok',
                'revision_precio_ok',
                'revision_categoria_ok',
            ]);
        }
    }
}
