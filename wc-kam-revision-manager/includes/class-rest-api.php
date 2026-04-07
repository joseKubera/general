<?php
defined('ABSPATH') || exit;

class WCKAMRM_Rest_API {

    public static function init() {
        add_action('rest_api_init', [__CLASS__, 'register_routes']);
    }

    public static function register_routes() {
        $ns = 'wckamrm/v1';

        register_rest_route($ns, '/products', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'get_products'],
            'permission_callback' => fn() => current_user_can('edit_products'),
            'args'                => [
                'page'        => ['default' => 1,         'sanitize_callback' => 'absint'],
                'per_page'    => ['default' => 25,        'sanitize_callback' => 'absint'],
                'filter'      => ['default' => 'all',     'sanitize_callback' => 'sanitize_text_field'],
                'assigned_to' => ['default' => '',        'sanitize_callback' => 'sanitize_text_field'],
                'status'      => ['default' => 'pending', 'sanitize_callback' => 'sanitize_text_field'],
                'search'      => ['default' => '',        'sanitize_callback' => 'sanitize_text_field'],
                'date'        => ['default' => '',        'sanitize_callback' => 'sanitize_text_field'],
                'tags'        => ['default' => '',        'sanitize_callback' => 'sanitize_text_field'],
            ],
        ]);

        register_rest_route($ns, '/product/(?P<id>\d+)/checklist', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'save_checklist'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        register_rest_route($ns, '/assign', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'assign_products'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        register_rest_route($ns, '/claim', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'claim_from_queue'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        register_rest_route($ns, '/stats', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'get_stats'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        register_rest_route($ns, '/my-tasks', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'get_my_tasks'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        register_rest_route($ns, '/product/(?P<id>\d+)/detail', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'get_product_detail'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        register_rest_route($ns, '/product/(?P<id>\d+)/update', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'update_product'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        register_rest_route($ns, '/product/(?P<id>\d+)/action', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'product_action'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        // Gallery management: add / remove images
        register_rest_route($ns, '/product/(?P<id>\d+)/gallery', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'manage_gallery'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        // Variations list for a variable product
        register_rest_route($ns, '/product/(?P<id>\d+)/variations', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'get_variations'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        // Save commercekit_image_gallery entry for one variation
        register_rest_route($ns, '/product/(?P<id>\d+)/variation-image', [
            'methods'             => 'POST',
            'callback'            => [__CLASS__, 'save_variation_image'],
            'permission_callback' => fn() => current_user_can('edit_products'),
        ]);

        // WooCommerce categories search
        register_rest_route($ns, '/categories', [
            'methods'             => 'GET',
            'callback'            => [__CLASS__, 'get_categories'],
            'permission_callback' => fn() => current_user_can('edit_products'),
            'args'                => [
                'search' => ['default' => '', 'sanitize_callback' => 'sanitize_text_field'],
                'number' => ['default' => 30, 'sanitize_callback' => 'absint'],
            ],
        ]);
    }

    /* ---- PRODUCTS LIST ---- */
    public static function get_products(WP_REST_Request $req) {
        global $wpdb;
        $table    = $wpdb->prefix . 'kam_revision_tasks';
        $page     = $req['page'];
        $per_page = min($req['per_page'], 100);
        $filter   = $req['filter'];
        $search   = $req['search'];
        $date     = $req['date'];
        $uid      = $req['assigned_to'];
        $tags_raw = $req['tags'];

        $statusFilter = $req['status'] ?: 'pending';

        // FIX: include product_variation so individual variants appear in table
        // FIX: query both product and product_variation types
        $post_types_sql = "post_type IN ('product', 'product_variation')";

        if ($statusFilter === 'all') {
            $status_ids = $wpdb->get_col(
                "SELECT ID FROM {$wpdb->posts}
                 WHERE {$post_types_sql}
                   AND post_status IN ('publish','draft','pending','private','future','ready','inprogress')"
            );
        } else {
            $status_ids = $wpdb->get_col($wpdb->prepare(
                "SELECT ID FROM {$wpdb->posts}
                 WHERE {$post_types_sql} AND post_status = %s",
                $statusFilter
            ));
        }

        if (empty($status_ids)) {
            return new WP_REST_Response(['products' => [], 'total' => 0, 'pages' => 1, 'page' => $page], 200);
        }

        $args = [
            'post_type'      => ['product', 'product_variation'],
            'post_status'    => 'any',
            'post__in'       => $status_ids,
            'posts_per_page' => $per_page,
            'paged'          => $page,
            'fields'         => 'ids',
            'orderby'        => 'date',
            'order'          => 'DESC',
        ];

        if ($search) {
            $args['s'] = $search;
            $like = '%' . $wpdb->esc_like($search) . '%';
            add_filter('posts_join', function ($join) use ($wpdb) {
                return $join . " LEFT JOIN {$wpdb->postmeta} pm_sku
                                ON pm_sku.post_id = {$wpdb->posts}.ID
                               AND pm_sku.meta_key = '_sku' ";
            });
            add_filter('posts_where', function ($where) use ($wpdb, $like) {
                return $where . $wpdb->prepare(' OR pm_sku.meta_value LIKE %s ', $like);
            });
            add_filter('posts_distinct', function () { return 'DISTINCT'; });
        }

        // Tags filter (OR logic) — only applies to parent products
        if ($tags_raw) {
            $tag_ids = array_filter(array_map('intval', explode(',', $tags_raw)));
            if (!empty($tag_ids)) {
                $args['tax_query'] = [[
                    'taxonomy' => 'product_tag',
                    'field'    => 'term_id',
                    'terms'    => $tag_ids,
                    'operator' => 'IN',
                ]];
            }
        }

        // Checklist filter
        if ($filter === 'pendiente') {
            $args['meta_query'] = [
                'relation' => 'OR',
                ['key' => 'revision_titulo_ok', 'compare' => 'NOT EXISTS'],
                ['key' => 'revision_titulo_ok', 'value' => '', 'compare' => '='],
            ];
        } elseif ($filter === 'aprobado') {
            $args['meta_query'] = [
                ['key' => 'revision_titulo_ok',      'value' => 'si'],
                ['key' => 'revision_imagenes_ok',    'value' => 'si'],
                ['key' => 'revision_descripcion_ok', 'value' => 'si'],
                ['key' => 'revision_precio_ok',      'value' => 'si'],
                ['key' => 'revision_categoria_ok',   'value' => 'si'],
            ];
        } elseif ($filter === 'en_progreso') {
            $args['meta_query'] = [
                'relation' => 'AND',
                [
                    'relation' => 'OR',
                    ['key' => 'revision_titulo_ok', 'value' => ['si','no','na'], 'compare' => 'IN'],
                ],
                [
                    'relation' => 'OR',
                    ['key' => 'revision_titulo_ok',      'value' => 'si', 'compare' => '!='],
                    ['key' => 'revision_imagenes_ok',    'value' => 'si', 'compare' => '!='],
                ],
            ];
        }

        if ($uid || $date) {
            $join_conditions = [];
            if ($uid === 'me') $uid = get_current_user_id();
            if ($uid) $join_conditions[] = $wpdb->prepare("t.user_id = %d", intval($uid));
            if ($date) $join_conditions[] = $wpdb->prepare("t.assigned_date = %s", $date);

            if ($join_conditions) {
                add_filter('posts_join', function($join) use ($wpdb, $table) {
                    return $join . " INNER JOIN {$table} t ON t.product_id = {$wpdb->posts}.ID ";
                });
                $where_extra = implode(' AND ', $join_conditions);
                add_filter('posts_where', function($where) use ($where_extra) {
                    return $where . " AND ({$where_extra}) ";
                });
            }
        }

        $query    = new WP_Query($args);
        $total    = $query->found_posts;
        $prod_ids = $query->posts;

        remove_all_filters('posts_join');
        remove_all_filters('posts_where');
        remove_all_filters('posts_distinct');

        // FIX: batch-prime post meta cache from DB to bypass stale persistent cache
        if (!empty($prod_ids)) {
            update_meta_cache('post', $prod_ids);
        }

        $products = [];
        foreach ($prod_ids as $pid) {
            $row = self::format_product($pid);
            if ($row) $products[] = $row;
        }

        return new WP_REST_Response([
            'products' => $products,
            'total'    => $total,
            'pages'    => ceil($total / $per_page),
            'page'     => $page,
        ], 200);
    }

    private static function format_product($pid) {
        // FIX: clear object cache for this post to avoid stale persistent cache reads
        clean_post_cache($pid);
        wp_cache_delete($pid, 'post_meta');

        $product = wc_get_product($pid);
        if (!$product) return null;

        global $wpdb;
        $table = $wpdb->prefix . 'kam_revision_tasks';
        $task  = $wpdb->get_row($wpdb->prepare(
            "SELECT * FROM {$table} WHERE product_id = %d", $pid
        ));

        // FIX: read meta directly from DB to bypass any persistent cache
        $checks = [
            'producto'    => get_post_meta($pid, 'revision_producto_ok',    true),
            'imagenes'    => get_post_meta($pid, 'revision_imagenes_ok',    true),
            'titulo'      => get_post_meta($pid, 'revision_titulo_ok',      true),
            'descripcion' => get_post_meta($pid, 'revision_descripcion_ok', true),
            'precio'      => get_post_meta($pid, 'revision_precio_ok',      true),
            'peso'        => get_post_meta($pid, 'revision_peso_ok',        true),
            'dimensiones' => get_post_meta($pid, 'revision_dimensiones_ok', true),
            'atributos'   => get_post_meta($pid, 'revision_atributos_ok',   true),
            'categoria'   => get_post_meta($pid, 'revision_categoria_ok',   true),
        ];

        $aprobados = count(array_filter($checks, fn($v) => $v === 'si'));
        $score     = round(($aprobados / 9) * 100);

        $thumb_id  = get_post_thumbnail_id($pid);
        $thumb_url = $thumb_id ? wp_get_attachment_image_url($thumb_id, 'thumbnail') : '';

        // FIX: for variations, get categories from parent product
        $is_variation = ($product->get_type() === 'variation');
        $parent_id    = $is_variation ? $product->get_parent_id() : 0;
        $cat_pid      = $is_variation ? $parent_id : $pid;
        $tag_pid      = $is_variation ? $parent_id : $pid;

        $alibaba_img = get_post_meta($pid, 'url_alibaba_img', true);
        $cats = wp_get_post_terms($cat_pid, 'product_cat', ['fields' => 'names']);
        $tags = wp_get_post_terms($tag_pid, 'product_tag', ['fields' => 'names']);

        $assigned_user = '';
        $assigned_date = '';
        if ($task && $task->user_id) {
            $u = get_userdata($task->user_id);
            $assigned_user = $u ? $u->display_name : '';
            $assigned_date = $task->assigned_date;
        }

        return [
            'id'             => $pid,
            'sku'            => $product->get_sku(),
            'name'           => $product->get_name(),
            'status'         => get_post_status($pid),
            'thumb_url'      => $thumb_url,
            'alibaba_img'    => $alibaba_img,
            'regular_price'  => $product->get_regular_price(),
            'sale_price'     => $product->get_sale_price(),
            'categories'     => implode(', ', $cats ?: []),
            'tags'           => $tags ?: [],
            'edit_url'       => get_edit_post_link($pid, 'raw'),
            'revision_estado'=> get_post_meta($pid, 'revision_estado', true),
            'responsable'    => get_post_meta($pid, 'revision_responsable', true),
            'comentario'     => get_post_meta($pid, 'comentario_revision', true),
            'checks'         => $checks,
            'score'          => $score,
            'product_type'   => $product->get_type(),
            'assigned_to'    => $task->user_id ?? 0,
            'assigned_user'  => $assigned_user,
            'assigned_date'  => $assigned_date,
            'task_id'        => $task->id ?? null,
        ];
    }

    /* ---- SAVE CHECKLIST ---- */
    public static function save_checklist(WP_REST_Request $req) {
        $pid  = (int) $req->get_param('id');
        $data = $req->get_json_params();

        if (!get_post($pid)) {
            return new WP_REST_Response(['error' => 'Producto no encontrado'], 404);
        }

        $allowed_checks = [
            'revision_producto_ok',
            'revision_imagenes_ok', 'revision_titulo_ok', 'revision_descripcion_ok',
            'revision_precio_ok', 'revision_peso_ok', 'revision_dimensiones_ok',
            'revision_atributos_ok', 'revision_categoria_ok',
            'revision_estado', 'revision_responsable', 'comentario_revision',
        ];

        foreach ($allowed_checks as $field) {
            if (!isset($data[$field])) continue;
            if ($field === 'comentario_revision') {
                update_post_meta($pid, $field, sanitize_textarea_field($data[$field]));
            } else {
                update_post_meta($pid, $field, sanitize_text_field($data[$field]));
            }
        }

        // FIX: bust cache after save so table immediately reflects new values
        clean_post_cache($pid);
        wp_cache_delete($pid, 'post_meta');

        $checks = [
            get_post_meta($pid, 'revision_producto_ok',     true),
            get_post_meta($pid, 'revision_imagenes_ok',     true),
            get_post_meta($pid, 'revision_titulo_ok',       true),
            get_post_meta($pid, 'revision_descripcion_ok',  true),
            get_post_meta($pid, 'revision_precio_ok',       true),
            get_post_meta($pid, 'revision_atributos_ok',    true),
            get_post_meta($pid, 'revision_categoria_ok',    true),
        ];
        $all_approved = count(array_filter($checks, fn($v) => $v === 'si')) === count($checks);

        if ($all_approved) {
            global $wpdb;
            $table = $wpdb->prefix . 'kam_revision_tasks';
            $wpdb->update($table, [
                'status'       => 'aprobado',
                'completed_at' => current_time('mysql'),
            ], ['product_id' => $pid]);
            update_post_meta($pid, 'revision_estado', 'aprobado');
        }

        return new WP_REST_Response(['success' => true, 'all_approved' => $all_approved], 200);
    }

    /* ---- ASSIGN PRODUCTS ---- */
    public static function assign_products(WP_REST_Request $req) {
        global $wpdb;
        $table    = $wpdb->prefix . 'kam_revision_tasks';
        $data     = $req->get_json_params();
        $user_id  = absint($data['user_id'] ?? 0);
        $prod_ids = array_map('absint', $data['product_ids'] ?? []);
        $date     = sanitize_text_field($data['date'] ?? current_time('Y-m-d'));

        if (!$user_id || empty($prod_ids)) {
            return new WP_REST_Response(['error' => 'Datos inválidos: se requiere user_id y product_ids'], 400);
        }

        // FIX: verify user exists before assigning
        $user = get_userdata($user_id);
        if (!$user) {
            return new WP_REST_Response(['error' => 'Usuario no encontrado'], 404);
        }

        $assigned = 0;
        foreach ($prod_ids as $pid) {
            if (!$pid) continue;

            // FIX: verify product exists (handles both product and product_variation)
            $post = get_post($pid);
            if (!$post || !in_array($post->post_type, ['product', 'product_variation'])) continue;

            $exists = $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM {$table} WHERE product_id = %d", $pid
            ));
            if ($exists) {
                $wpdb->update($table, [
                    'user_id'       => $user_id,
                    'assigned_by'   => get_current_user_id(),
                    'assigned_date' => $date,
                    'status'        => 'pendiente',
                ], ['product_id' => $pid]);
            } else {
                $wpdb->insert($table, [
                    'product_id'    => $pid,
                    'user_id'       => $user_id,
                    'assigned_by'   => get_current_user_id(),
                    'assigned_date' => $date,
                    'status'        => 'pendiente',
                ]);
            }
            $assigned++;
        }

        return new WP_REST_Response([
            'success'       => true,
            'assigned'      => $assigned,
            'assigned_user' => $user->display_name,
        ], 200);
    }

    /* ---- CLAIM FROM QUEUE (pending products only) ---- */
    public static function claim_from_queue(WP_REST_Request $req) {
        global $wpdb;
        $table    = $wpdb->prefix . 'kam_revision_tasks';
        $data     = $req->get_json_params();
        $quota    = (int) get_option('wckamrm_daily_quota', 20);
        $uid      = get_current_user_id();
        $today    = current_time('Y-m-d');
        $count    = absint($data['count'] ?? $quota);
        $count    = min($count, $quota * 2);

        $already = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE user_id = %d AND assigned_date = %s",
            $uid, $today
        ));
        $remaining = $quota - $already;
        if ($remaining <= 0) {
            return new WP_REST_Response([
                'error'   => "Ya tienes {$already} productos asignados hoy (cuota: {$quota})",
                'already' => $already,
                'quota'   => $quota,
            ], 400);
        }
        $to_claim = min($count, $remaining);

        $unassigned_ids = $wpdb->get_col($wpdb->prepare(
            "SELECT p.ID FROM {$wpdb->posts} p
             LEFT JOIN {$table} t ON t.product_id = p.ID
             WHERE p.post_type IN ('product', 'product_variation')
               AND p.post_status = 'pending'
               AND (t.id IS NULL OR t.user_id = 0)
             ORDER BY p.ID ASC
             LIMIT %d",
            $to_claim
        ));

        if (empty($unassigned_ids)) {
            return new WP_REST_Response(['error' => 'No hay productos pendientes disponibles en la cola'], 400);
        }

        $claimed = 0;
        foreach ($unassigned_ids as $pid) {
            $exists = $wpdb->get_var($wpdb->prepare(
                "SELECT id FROM {$table} WHERE product_id = %d", $pid
            ));
            if ($exists) {
                $wpdb->update($table, [
                    'user_id'       => $uid,
                    'assigned_by'   => $uid,
                    'assigned_date' => $today,
                    'status'        => 'pendiente',
                ], ['product_id' => $pid]);
            } else {
                $wpdb->insert($table, [
                    'product_id'    => $pid,
                    'user_id'       => $uid,
                    'assigned_by'   => $uid,
                    'assigned_date' => $today,
                    'status'        => 'pendiente',
                ]);
            }
            $claimed++;
        }

        return new WP_REST_Response([
            'success'     => true,
            'claimed'     => $claimed,
            'total_today' => $already + $claimed,
            'quota'       => $quota,
        ], 200);
    }

    /* ---- STATS ---- */
    public static function get_stats(WP_REST_Request $req) {
        global $wpdb;
        $table = $wpdb->prefix . 'kam_revision_tasks';
        $today = current_time('Y-m-d');

        $total_products = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$wpdb->posts}
             WHERE post_type IN ('product','product_variation')
               AND post_status IN ('publish','pending','draft')"
        );
        $total_assigned = (int) $wpdb->get_var("SELECT COUNT(*) FROM {$table}");
        $total_approved = (int) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE status = %s", 'aprobado')
        );

        // FIX: total_pending = products with WordPress post_status='pending' (waiting review)
        $total_pending = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$wpdb->posts}
             WHERE post_type IN ('product','product_variation') AND post_status = 'pending'"
        );

        $queue_free = (int) $wpdb->get_var(
            "SELECT COUNT(*) FROM {$wpdb->posts} p
             LEFT JOIN {$table} t ON t.product_id = p.ID
             WHERE p.post_type IN ('product','product_variation') AND p.post_status='pending'
               AND (t.id IS NULL OR t.user_id = 0)"
        );

        $uid = get_current_user_id();
        $my_today_total = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE user_id = %d AND assigned_date = %s",
            $uid, $today
        ));
        $my_today_done = (int) $wpdb->get_var($wpdb->prepare(
            "SELECT COUNT(*) FROM {$table} WHERE user_id = %d AND assigned_date = %s AND status = %s",
            $uid, $today, 'aprobado'
        ));

        $leaderboard = $wpdb->get_results($wpdb->prepare(
            "SELECT t.user_id,
                    COUNT(*) as total,
                    SUM(CASE WHEN t.status='aprobado' THEN 1 ELSE 0 END) as done
             FROM {$table} t
             WHERE t.assigned_date = %s AND t.user_id > 0
             GROUP BY t.user_id
             ORDER BY done DESC",
            $today
        ));
        foreach ($leaderboard as &$row) {
            $u = get_userdata($row->user_id);
            $row->name = $u ? $u->display_name : 'Usuario #' . $row->user_id;
        }

        return new WP_REST_Response([
            'total_products'  => $total_products,
            'total_assigned'  => $total_assigned,
            'total_approved'  => $total_approved,
            'total_pending'   => $total_pending,
            'queue_free'      => max(0, $queue_free),
            'my_today_total'  => $my_today_total,
            'my_today_done'   => $my_today_done,
            'quota'           => (int) get_option('wckamrm_daily_quota', 20),
            'leaderboard'     => $leaderboard,
        ], 200);
    }

    /* ---- MY TASKS ---- */
    public static function get_my_tasks(WP_REST_Request $req) {
        global $wpdb;
        $table = $wpdb->prefix . 'kam_revision_tasks';
        $uid   = get_current_user_id();
        $today = current_time('Y-m-d');

        $tasks = $wpdb->get_results($wpdb->prepare(
            "SELECT product_id, status FROM {$table}
             WHERE user_id = %d AND assigned_date = %s",
            $uid, $today
        ));

        $result = [];
        foreach ($tasks as $t) {
            $row = self::format_product($t->product_id);
            if ($row) $result[] = $row;
        }

        return new WP_REST_Response($result, 200);
    }

    /* ---- PRODUCT DETAIL (modal) ---- */
    public static function get_product_detail(WP_REST_Request $req) {
        $pid = (int) $req->get_param('id');

        // FIX: clear cache before loading to ensure fresh WooCommerce data
        clean_post_cache($pid);
        wp_cache_delete($pid, 'post_meta');

        $product = wc_get_product($pid);

        if (!$product) {
            return new WP_REST_Response(['error' => 'Producto no encontrado'], 404);
        }

        // FIX: for variations, use parent for gallery / categories
        $is_variation = ($product->get_type() === 'variation');
        $parent_id    = $is_variation ? $product->get_parent_id() : 0;
        $gallery_pid  = $is_variation ? $parent_id : $pid;

        // Main image (prefer variation image, fallback to parent/product)
        $thumb_id   = get_post_thumbnail_id($pid);
        if (!$thumb_id && $is_variation) $thumb_id = get_post_thumbnail_id($parent_id);
        $main_image = $thumb_id ? wp_get_attachment_image_url($thumb_id, 'large') : '';

        // Gallery from product (or parent if variation)
        $gallery_product = wc_get_product($gallery_pid);
        $gallery = [];
        if ($thumb_id) {
            $gallery[] = [
                'id'      => $thumb_id,
                'url'     => wp_get_attachment_image_url($thumb_id, 'woocommerce_thumbnail'),
                'is_main' => true,
            ];
        }
        $gallery_source = $gallery_product ?: $product;
        foreach ($gallery_source->get_gallery_image_ids() as $gid) {
            if ((int)$gid === (int)$thumb_id) continue; // avoid duplicate
            $url = wp_get_attachment_image_url($gid, 'woocommerce_thumbnail');
            if ($url) {
                $gallery[] = [
                    'id'      => $gid,
                    'url'     => $url,
                    'is_main' => false,
                ];
            }
        }

        // Attributes
        $attributes = [];
        foreach ($product->get_attributes() as $attr) {
            if ($attr->is_taxonomy()) {
                $label = wc_attribute_label($attr->get_name());
                $terms = wp_get_post_terms($pid, $attr->get_name(), ['fields' => 'names']);
                $attributes[] = [
                    'name'        => $label,
                    'value'       => implode(', ', $terms ?: []),
                    'is_taxonomy' => true,
                    'taxonomy'    => $attr->get_name(),
                ];
            } else {
                $attributes[] = [
                    'name'        => $attr->get_name(),
                    'value'       => implode(' | ', $attr->get_options()),
                    'is_taxonomy' => false,
                    'taxonomy'    => '',
                ];
            }
        }

        // FIX: return both category names and IDs (for edit)
        $cat_terms = wp_get_post_terms($is_variation ? $parent_id : $pid, 'product_cat');
        $cat_names = [];
        $cat_ids   = [];
        if (!is_wp_error($cat_terms)) {
            foreach ($cat_terms as $term) {
                $cat_names[] = $term->name;
                $cat_ids[]   = $term->term_id;
            }
        }

        $tags = wp_get_post_terms($is_variation ? $parent_id : $pid, 'product_tag', ['fields' => 'names']);

        $checks = [
            'producto'    => get_post_meta($pid, 'revision_producto_ok',    true),
            'imagenes'    => get_post_meta($pid, 'revision_imagenes_ok',    true),
            'titulo'      => get_post_meta($pid, 'revision_titulo_ok',      true),
            'descripcion' => get_post_meta($pid, 'revision_descripcion_ok', true),
            'precio'      => get_post_meta($pid, 'revision_precio_ok',      true),
            'peso'        => get_post_meta($pid, 'revision_peso_ok',        true),
            'dimensiones' => get_post_meta($pid, 'revision_dimensiones_ok', true),
            'atributos'   => get_post_meta($pid, 'revision_atributos_ok',   true),
            'categoria'   => get_post_meta($pid, 'revision_categoria_ok',   true),
        ];

        nocache_headers();

        return new WP_REST_Response([
            'id'              => $pid,
            'parent_id'       => $parent_id,
            'is_variation'    => $is_variation,
            'sku'             => $product->get_sku(),
            'title'           => $product->get_name(),
            'description'     => $is_variation ? get_post_meta($pid, '_variation_description', true) : $product->get_description(),
            'regular_price'   => $product->get_regular_price(),
            'sale_price'      => $product->get_sale_price(),
            'url_alibaba'       => get_post_meta($pid, 'url_alibaba',                true),
            'alibaba_price'     => get_post_meta($pid, 'alibaba_price',              true),
            'producto_correcto' => get_post_meta($pid, 'revision_producto_correcto', true),
            'weight'          => $product->get_weight(),
            'length'          => $product->get_length(),
            'width'           => $product->get_width(),
            'height'          => $product->get_height(),
            'main_image'      => $main_image,
            'gallery'         => $gallery,
            'gallery_pid'     => $gallery_pid, // which product owns the gallery
            'attributes'      => $attributes,
            'categories'      => implode(', ', $cat_names),
            'category_ids'    => $cat_ids,
            'tags'            => $tags ?: [],
            'status'          => get_post_status($pid),
            'checks'          => $checks,
            'revision_estado' => get_post_meta($pid, 'revision_estado',     true),
            'comentario'      => get_post_meta($pid, 'comentario_revision', true),
            'edit_url'        => get_edit_post_link($pid, 'raw'),
        ], 200);
    }

    /* ---- INLINE UPDATE ---- */
    public static function update_product(WP_REST_Request $req) {
        $pid     = (int) $req->get_param('id');
        $product = wc_get_product($pid);

        if (!$product) {
            return new WP_REST_Response(['error' => 'Producto no encontrado'], 404);
        }

        $data        = $req->get_json_params();
        $post_update = ['ID' => $pid];
        $post_dirty  = false;

        if (!empty($data['title'])) {
            $post_update['post_title'] = sanitize_text_field($data['title']);
            $post_dirty = true;
        }
        if (array_key_exists('description', $data)) {
            $post_update['post_content'] = wp_kses_post($data['description']);
            $post_dirty = true;
        }
        if ($post_dirty) {
            wp_update_post($post_update);
            clean_post_cache($pid);
        }

        $price_dirty = false;
        if (array_key_exists('regular_price', $data)) {
            $product->set_regular_price(wc_format_decimal($data['regular_price']));
            $price_dirty = true;
        }
        if (array_key_exists('sale_price', $data)) {
            $val = $data['sale_price'];
            $product->set_sale_price('' !== $val ? wc_format_decimal($val) : '');
            $price_dirty = true;
        }

        if (array_key_exists('sku', $data)) {
            $new_sku = sanitize_text_field($data['sku']);
            $existing_id = wc_get_product_id_by_sku($new_sku);
            if (!$existing_id || (int)$existing_id === $pid) {
                $product->set_sku($new_sku);
                $price_dirty = true;
            }
        }

        if (array_key_exists('weight', $data)) { $product->set_weight(wc_format_decimal($data['weight'])); $price_dirty = true; }
        if (array_key_exists('length', $data)) { $product->set_length(wc_format_decimal($data['length'])); $price_dirty = true; }
        if (array_key_exists('width',  $data)) { $product->set_width(wc_format_decimal($data['width']));   $price_dirty = true; }
        if (array_key_exists('height', $data)) { $product->set_height(wc_format_decimal($data['height'])); $price_dirty = true; }

        if (array_key_exists('producto_correcto', $data)) {
            update_post_meta($pid, 'revision_producto_correcto', sanitize_text_field($data['producto_correcto']));
        }

        if (array_key_exists('url_alibaba', $data)) {
            update_post_meta($pid, 'url_alibaba', esc_url_raw($data['url_alibaba']));
        }
        if (array_key_exists('alibaba_price', $data)) {
            update_post_meta($pid, 'alibaba_price', sanitize_text_field($data['alibaba_price']));
        }

        // FIX: category update — syncs with WooCommerce taxonomy
        if (isset($data['category_ids']) && is_array($data['category_ids'])) {
            $cat_ids  = array_map('absint', $data['category_ids']);
            $cat_ids  = array_filter($cat_ids); // remove zeros
            // For variations, assign categories to parent product
            $is_variation = ($product->get_type() === 'variation');
            $target_pid   = $is_variation ? $product->get_parent_id() : $pid;
            if ($target_pid) {
                wp_set_object_terms($target_pid, $cat_ids, 'product_cat');
                clean_post_cache($target_pid);
            }
        }

        // Attributes — supports delete for both custom and taxonomy attrs
        if (isset($data['attributes']) && is_array($data['attributes'])) {
            $current_attrs = $product->get_attributes();
            $new_attrs     = [];

            $keep_taxonomy_keys = [];
            foreach ($data['attributes'] as $item) {
                if (!empty($item['is_taxonomy'])) {
                    $tax = sanitize_text_field($item['taxonomy'] ?? '');
                    if ($tax) $keep_taxonomy_keys[] = $tax;
                }
            }

            foreach ($current_attrs as $key => $attr) {
                if ($attr->is_taxonomy() && in_array($attr->get_name(), $keep_taxonomy_keys)) {
                    $new_attrs[$key] = $attr;
                }
            }

            foreach ($data['attributes'] as $item) {
                if (!empty($item['is_taxonomy'])) continue;
                $name  = sanitize_text_field($item['name']  ?? '');
                $value = sanitize_text_field($item['value'] ?? '');
                if (!$name) continue;
                $attr_key = sanitize_title($name);
                $wc_attr  = new WC_Product_Attribute();
                $wc_attr->set_name($name);
                $wc_attr->set_options(array_map('trim', explode('|', $value)));
                $wc_attr->set_position(count($new_attrs));
                $wc_attr->set_visible(true);
                $new_attrs[$attr_key] = $wc_attr;
            }

            $product->set_attributes($new_attrs);
            $price_dirty = true;
        }

        if ($price_dirty) {
            $product->save();
            clean_post_cache($pid);
            wp_cache_delete($pid, 'post_meta');
        }

        return new WP_REST_Response([
            'success' => true,
            'product' => [
                'id'   => $pid,
                'name' => get_the_title($pid),
            ],
        ], 200);
    }

    /* ---- GALLERY MANAGEMENT ---- */
    public static function manage_gallery(WP_REST_Request $req) {
        $pid = (int) $req->get_param('id');

        // FIX: clear cache before loading to avoid reading stale gallery
        clean_post_cache($pid);

        $product = wc_get_product($pid);
        if (!$product) {
            return new WP_REST_Response(['error' => 'Producto no encontrado'], 404);
        }

        // FIX: for variations, manage gallery on parent product
        if ($product->get_type() === 'variation') {
            $parent_id = $product->get_parent_id();
            if ($parent_id) {
                clean_post_cache($parent_id);
                $product = wc_get_product($parent_id);
            }
        }

        $data   = $req->get_json_params();
        $action = sanitize_text_field($data['action'] ?? '');

        if ($action === 'remove') {
            $image_id    = (int) ($data['image_id'] ?? 0);
            if (!$image_id) return new WP_REST_Response(['error' => 'image_id requerido'], 400);

            $gallery_ids = $product->get_gallery_image_ids();
            $gallery_ids = array_values(array_filter($gallery_ids, fn($id) => (int)$id !== $image_id));
            $product->set_gallery_image_ids($gallery_ids);
            $product->save();
            clean_post_cache($product->get_id());

            return new WP_REST_Response(['success' => true], 200);
        }

        // FIX: handle array of attachment_ids to avoid race condition when adding multiple images
        if ($action === 'add') {
            $attachment_ids = [];

            // Support both single attachment_id and array of attachment_ids
            if (isset($data['attachment_ids']) && is_array($data['attachment_ids'])) {
                $attachment_ids = array_map('absint', $data['attachment_ids']);
            } elseif (!empty($data['attachment_id'])) {
                $attachment_ids = [(int) $data['attachment_id']];
            }

            $attachment_ids = array_filter($attachment_ids);
            if (empty($attachment_ids)) {
                return new WP_REST_Response(['error' => 'attachment_id(s) requerido(s)'], 400);
            }

            // FIX: reload product fresh to get current gallery (avoid stale data)
            $product->read_meta_data(true);
            $gallery_ids = $product->get_gallery_image_ids();

            $added = [];
            foreach ($attachment_ids as $att_id) {
                if (!in_array($att_id, $gallery_ids, true)) {
                    $gallery_ids[] = $att_id;
                    $url = wp_get_attachment_image_url($att_id, 'woocommerce_thumbnail');
                    if ($url) {
                        $added[] = ['id' => $att_id, 'url' => $url];
                    }
                }
            }

            $product->set_gallery_image_ids($gallery_ids);
            $product->save();
            clean_post_cache($product->get_id());
            wp_cache_delete($product->get_id(), 'post_meta');

            return new WP_REST_Response(['success' => true, 'added' => $added], 200);
        }

        return new WP_REST_Response(['error' => 'Acción inválida: usa add o remove'], 400);
    }

    /* ---- CATEGORIES SEARCH ---- */
    public static function get_categories(WP_REST_Request $req) {
        $search = $req->get_param('search');
        $number = min((int) $req->get_param('number'), 100);

        $args = [
            'taxonomy'   => 'product_cat',
            'hide_empty' => false,
            'number'     => $number,
            'orderby'    => 'name',
            'order'      => 'ASC',
        ];

        if ($search) {
            $args['search'] = $search;
        }

        $terms = get_terms($args);
        if (is_wp_error($terms)) {
            return new WP_REST_Response([], 200);
        }

        $result = array_map(fn($t) => [
            'id'   => $t->term_id,
            'name' => $t->name,
            'slug' => $t->slug,
            'count'=> $t->count,
        ], $terms);

        return new WP_REST_Response($result, 200);
    }

    /* ---- VARIATIONS LIST ---- */
    public static function get_variations(WP_REST_Request $req) {
        $pid = (int) $req->get_param('id');

        clean_post_cache($pid);
        $product = wc_get_product($pid);

        if (!$product || $product->get_type() !== 'variable') {
            return new WP_REST_Response(['error' => 'Producto no encontrado o no es variable'], 404);
        }

        $gallery = get_post_meta($pid, 'commercekit_image_gallery', true);
        if (!is_array($gallery)) $gallery = [];

        $variations = [];
        foreach ($product->get_children() as $var_id) {
            $variation = wc_get_product($var_id);
            if (!$variation) continue;

            $raw_attrs    = $variation->get_variation_attributes();
            $attr_display = [];
            $key_parts    = [];

            foreach ($raw_attrs as $attr_key => $attr_value) {
                if ('' === $attr_value) continue;
                $taxonomy = str_replace('attribute_', '', $attr_key);
                $label    = wc_attribute_label($taxonomy);

                if (taxonomy_exists($taxonomy)) {
                    $term          = get_term_by('slug', $attr_value, $taxonomy);
                    $display_value = $term ? $term->name : $attr_value;
                } else {
                    $display_value = $attr_value;
                }

                $attr_display[] = ['name' => $label, 'option' => $display_value];
                $key_parts[]    = self::slugify_attr($attr_value);
            }

            $gallery_key = count($key_parts) === 1
                ? $key_parts[0]
                : implode('_cgkit_', $key_parts);

            $image_id  = isset($gallery[$gallery_key]) ? (string) $gallery[$gallery_key] : '';
            $image_url = '';
            if ($image_id) {
                $image_url = wp_get_attachment_image_url((int) $image_id, 'thumbnail') ?: '';
            }
            if (!$image_url) {
                $thumb_id = get_post_thumbnail_id($var_id);
                if ($thumb_id) {
                    $image_url = wp_get_attachment_image_url($thumb_id, 'thumbnail') ?: '';
                    if (!$image_id) $image_id = (string) $thumb_id;
                }
            }

            $variations[] = [
                'id'          => $var_id,
                'sku'         => $variation->get_sku(),
                'attributes'  => $attr_display,
                'gallery_key' => $gallery_key,
                'image_id'    => $image_id,
                'image_url'   => $image_url,
            ];
        }

        return new WP_REST_Response($variations, 200);
    }

    /* ---- SAVE VARIATION IMAGE (commercekit_image_gallery) ---- */
    public static function save_variation_image(WP_REST_Request $req) {
        $pid  = (int) $req->get_param('id');
        $data = $req->get_json_params();

        $gallery_key = sanitize_text_field($data['gallery_key'] ?? '');
        $image_id    = absint($data['image_id'] ?? 0);

        if (!$gallery_key) {
            return new WP_REST_Response(['error' => 'gallery_key requerido'], 400);
        }

        $product = wc_get_product($pid);
        if (!$product || $product->get_type() !== 'variable') {
            return new WP_REST_Response(['error' => 'Producto no encontrado o no es variable'], 404);
        }

        $gallery = get_post_meta($pid, 'commercekit_image_gallery', true);
        if (!is_array($gallery)) $gallery = [];

        if ($image_id) {
            $gallery[$gallery_key] = (string) $image_id;
        } else {
            unset($gallery[$gallery_key]);
        }

        update_post_meta($pid, 'commercekit_image_gallery', $gallery);

        $image_url = $image_id ? (wp_get_attachment_image_url($image_id, 'thumbnail') ?: '') : '';

        return new WP_REST_Response([
            'success'   => true,
            'image_id'  => (string) $image_id,
            'image_url' => $image_url,
        ], 200);
    }

    private static function slugify_attr($value) {
        $s = strtolower(trim($value));
        $s = str_replace([' / ', '/'], '-', $s);
        $s = str_replace(' ', '-', $s);
        $s = preg_replace('/-+/', '-', $s);
        return trim($s, '-');
    }

    /* ---- APROBAR / RECHAZAR ---- */
    public static function product_action(WP_REST_Request $req) {
        $pid    = (int) $req->get_param('id');
        $data   = $req->get_json_params();
        $action = sanitize_text_field($data['action'] ?? '');

        if (!get_post($pid)) {
            return new WP_REST_Response(['error' => 'Producto no encontrado'], 404);
        }

        if ($action === 'aprobar') {
            $new_status  = 'ready';
            $task_status = 'aprobado';
        } elseif ($action === 'rechazar') {
            $new_status  = 'inprogress';
            $task_status = 'rechazado';
        } else {
            return new WP_REST_Response(['error' => 'Acción inválida: usa aprobar o rechazar'], 400);
        }

        $product_obj = wc_get_product($pid);
        if ($product_obj) {
            $product_obj->set_status($new_status);
            $product_obj->save();
        } else {
            wp_update_post(['ID' => $pid, 'post_status' => $new_status]);
        }
        update_post_meta($pid, 'revision_estado', $task_status);
        clean_post_cache($pid);
        wp_cache_delete($pid, 'post_meta');

        if (!empty($data['checklist']) && is_array($data['checklist'])) {
            $allowed = [
                'revision_producto_ok',
                'revision_imagenes_ok', 'revision_titulo_ok', 'revision_descripcion_ok',
                'revision_precio_ok', 'revision_peso_ok', 'revision_dimensiones_ok',
                'revision_atributos_ok', 'revision_categoria_ok',
                'comentario_revision',
            ];
            foreach ($allowed as $field) {
                if (!array_key_exists($field, $data['checklist'])) continue;
                if ($field === 'comentario_revision') {
                    update_post_meta($pid, $field, sanitize_textarea_field($data['checklist'][$field]));
                } else {
                    update_post_meta($pid, $field, sanitize_text_field($data['checklist'][$field]));
                }
            }
        }

        global $wpdb;
        $table     = $wpdb->prefix . 'kam_revision_tasks';
        $completed = $new_status === 'ready' ? current_time('mysql') : null;
        $exists    = (int) $wpdb->get_var(
            $wpdb->prepare("SELECT COUNT(*) FROM {$table} WHERE product_id = %d", $pid)
        );
        if ($exists) {
            $wpdb->update(
                $table,
                ['status' => $task_status, 'completed_at' => $completed],
                ['product_id' => $pid]
            );
        } else {
            $wpdb->insert($table, [
                'product_id'    => $pid,
                'user_id'       => get_current_user_id(),
                'status'        => $task_status,
                'assigned_date' => current_time('Y-m-d'),
                'completed_at'  => $completed,
            ]);
        }

        return new WP_REST_Response([
            'success'    => true,
            'new_status' => $new_status,
        ], 200);
    }
}
