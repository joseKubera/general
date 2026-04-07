<?php defined('ABSPATH') || exit; ?>

<div id="wckamrm-app" class="wckamrm-wrap">

    <!-- HEADER -->
    <div class="rm-header">
        <div class="rm-header-left">
            <h1 class="rm-title">🔍 Revisión de Publicaciones</h1>
            <span class="rm-subtitle">Panel KAM · Kubera</span>
        </div>
        <div class="rm-header-right">
            <?php if (current_user_can('manage_woocommerce')): ?>
            <button class="rm-btn rm-btn-outline" id="btn-open-assign-modal">
                👥 Asignar Lote
            </button>
            <?php endif; ?>
            <button class="rm-btn rm-btn-primary" id="btn-claim-queue">
                ⚡ Tomar de la Cola
            </button>
            <a href="<?php echo admin_url('admin.php?page=kam-revision-settings'); ?>"
               class="rm-btn rm-btn-ghost" title="Configuración">⚙️</a>
        </div>
    </div>

    <!-- STATS BAR -->
    <div class="rm-stats-bar" id="stats-bar">
        <div class="rm-stat-card">
            <span class="rm-stat-num" id="stat-total">—</span>
            <span class="rm-stat-label">Total productos</span>
        </div>
        <div class="rm-stat-card rm-stat-accent">
            <span class="rm-stat-num" id="stat-approved">—</span>
            <span class="rm-stat-label">Aprobados</span>
        </div>
        <div class="rm-stat-card rm-stat-pending">
            <span class="rm-stat-num" id="stat-pending">—</span>
            <span class="rm-stat-label">Pendientes</span>
        </div>
        <div class="rm-stat-card">
            <span class="rm-stat-num" id="stat-queue">—</span>
            <span class="rm-stat-label">En cola libre</span>
        </div>
        <div class="rm-stat-card rm-stat-today">
            <span class="rm-stat-num">
                <span id="stat-my-done">—</span>/<span id="stat-my-total">—</span>
            </span>
            <span class="rm-stat-label">Mis tareas hoy</span>
            <div class="rm-mini-progress">
                <div class="rm-mini-progress-bar" id="my-progress-bar"></div>
            </div>
        </div>
        <div class="rm-stat-card">
            <div class="rm-leaderboard" id="leaderboard"></div>
            <span class="rm-stat-label">Equipo hoy</span>
        </div>
    </div>

    <!-- FILTERS ROW -->
    <div class="rm-filters">
        <div class="rm-filter-group">
            <input type="text" id="filter-search" class="rm-input rm-search"
                   placeholder="🔍 Buscar por nombre o SKU..." />
        </div>
        <div class="rm-filter-group">
            <select id="filter-status" class="rm-select">
                <option value="pending" selected>⏳ Pendientes</option>
                <option value="all">Todos los estados</option>
                <option value="publish">Publicado</option>
                <option value="draft">Borrador</option>
                <option value="ready">✅ Ready</option>
                <option value="inprogress">🔄 In Progress</option>
            </select>
        </div>
        <div class="rm-filter-group">
            <select id="filter-checklist" class="rm-select">
                <option value="all">Todos los checks</option>
                <option value="pendiente">⏳ Sin revisar</option>
                <option value="en_progreso">🔄 En progreso</option>
                <option value="aprobado">✅ Completos</option>
            </select>
        </div>
        <div class="rm-filter-group">
            <select id="filter-assigned" class="rm-select">
                <option value="">👤 Todos los usuarios</option>
                <option value="me">Mis productos</option>
                <!-- populated by JS -->
            </select>
        </div>
        <div class="rm-filter-group">
            <input type="date" id="filter-date" class="rm-input rm-date-input"
                   title="Filtrar por fecha de asignación" />
        </div>
        <div class="rm-filter-group">
            <select id="filter-perpage" class="rm-select">
                <option value="25">25 por página</option>
                <option value="50">50 por página</option>
                <option value="100">100 por página</option>
            </select>
        </div>
        <div class="rm-filter-group">
            <select id="filter-tags" class="rm-select rm-tags-select" multiple size="1"
                    title="Filtrar por etiquetas (Ctrl+click para varias)">
                <!-- populated by JS -->
            </select>
        </div>
        <button class="rm-btn rm-btn-ghost" id="btn-reset-filters">✖ Limpiar</button>
    </div>

    <!-- TABLE -->
    <div class="rm-table-wrapper">
        <table class="rm-table" id="products-table">
            <colgroup>
                <col class="col-check">
                <col class="col-img">
                <col class="col-info">
                <col class="col-precio">
                <col class="col-tipo">
                <col class="col-check-prod">
                <col class="col-check-imgs">
                <col class="col-check-titulo">
                <col class="col-score">
                <col class="col-tags">
                <col class="col-asignado">
                <col class="col-estado">
                <col class="col-actions">
            </colgroup>
            <thead>
                <tr>
                    <th class="col-check">
                        <input type="checkbox" id="select-all" title="Seleccionar todo">
                    </th>
                    <th class="col-img">Foto</th>
                    <th class="col-info">Producto</th>
                    <th class="col-precio">Precio</th>
                    <th class="col-tipo">Tipo</th>
                    <th class="col-check-prod">Es El Producto</th>
                    <th class="col-check-imgs">Imágenes</th>
                    <th class="col-check-titulo">Título</th>
                    <th class="col-score">Score</th>
                    <th class="col-tags">Tags</th>
                    <th class="col-asignado">Asignado a</th>
                    <th class="col-estado">Estado</th>
                    <th class="col-actions">Acciones</th>
                </tr>
                <tr class="thead-sub">
                    <th colspan="5"></th>
                    <th colspan="3" class="checklist-sub-header">✅ Checks</th>
                    <th colspan="5"></th>
                </tr>
            </thead>
            <tbody id="products-tbody">
                <tr class="rm-loading-row">
                    <td colspan="13">
                        <div class="rm-loader">
                            <div class="rm-spinner"></div>
                            <span>Cargando productos...</span>
                        </div>
                    </td>
                </tr>
            </tbody>
        </table>
    </div>

    <!-- PAGINATION -->
    <div class="rm-pagination" id="pagination">
        <div class="rm-pagination-info" id="pagination-info"></div>
        <div class="rm-pagination-controls" id="pagination-controls"></div>
    </div>

    <!-- BULK ACTION BAR (aparece al seleccionar) -->
    <div class="rm-bulk-bar" id="bulk-bar" style="display:none;">
        <span id="bulk-count">0 seleccionados</span>
        <?php if (current_user_can('manage_woocommerce')): ?>
        <div class="rm-bulk-assign">
            <select id="bulk-assign-user" class="rm-select rm-select-sm">
                <option value="">Asignar a usuario...</option>
            </select>
            <input type="date" id="bulk-assign-date" class="rm-input rm-input-sm" />
            <button class="rm-btn rm-btn-primary rm-btn-sm" id="btn-bulk-assign">
                Asignar seleccionados
            </button>
        </div>
        <?php endif; ?>
        <button class="rm-btn rm-btn-ghost rm-btn-sm" id="btn-deselect">Cancelar</button>
    </div>

    <!-- MODAL: Asignar Lote (Admin) -->
    <div class="rm-modal-overlay" id="assign-modal" style="display:none;">
        <div class="rm-modal">
            <div class="rm-modal-header">
                <h3>👥 Asignar Lote de Productos</h3>
                <button class="rm-modal-close" id="btn-close-modal">✕</button>
            </div>
            <div class="rm-modal-body">
                <div class="rm-form-row">
                    <label>Usuario</label>
                    <select id="modal-assign-user" class="rm-select">
                        <option value="">Seleccionar usuario...</option>
                    </select>
                </div>
                <div class="rm-form-row">
                    <label>Fecha</label>
                    <input type="date" id="modal-assign-date" class="rm-input" />
                </div>
                <div class="rm-form-row">
                    <label>Cantidad de productos</label>
                    <input type="number" id="modal-assign-qty" class="rm-input"
                           value="20" min="1" max="200" />
                    <span class="rm-hint">Se tomarán productos sin asignar de la cola</span>
                </div>
                <div class="rm-form-row">
                    <label>Filtrar desde</label>
                    <select id="modal-assign-filter" class="rm-select">
                        <option value="unassigned">Solo sin asignar</option>
                        <option value="all">Cualquier producto</option>
                    </select>
                </div>
            </div>
            <div class="rm-modal-footer">
                <button class="rm-btn rm-btn-ghost" id="btn-modal-cancel">Cancelar</button>
                <button class="rm-btn rm-btn-primary" id="btn-modal-confirm">
                    Asignar Lote
                </button>
            </div>
        </div>
    </div>

    <!-- TOAST -->
    <div class="rm-toast" id="rm-toast"></div>

</div><!-- /#wckamrm-app -->
