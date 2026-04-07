<?php defined('ABSPATH') || exit; ?>
<div class="wrap">
    <h1>⚙️ Configuración Revisión KAM</h1>
    <form method="post">
        <?php wp_nonce_field('wckamrm_settings'); ?>
        <table class="form-table">
            <tr>
                <th><label for="daily_quota">Cuota diaria por usuario</label></th>
                <td>
                    <input type="number" id="daily_quota" name="daily_quota"
                           value="<?php echo esc_attr($quota); ?>"
                           min="1" max="500" class="small-text" />
                    <p class="description">
                        Número máximo de productos que cada KAM puede tomar de la cola por día.
                    </p>
                </td>
            </tr>
        </table>
        <p class="submit">
            <input type="submit" name="wckamrm_save_settings"
                   class="button-primary" value="Guardar cambios" />
        </p>
    </form>
    <p><a href="<?php echo admin_url('admin.php?page=kam-revision-manager'); ?>">
        ← Volver al panel de revisión
    </a></p>
</div>
