/* =================================================================
   WC KAM REVISION MANAGER — App JS  v3.7.0
   ================================================================= */
(function ($) {
    'use strict';

    /* ---- STATE ---- */
    const state = {
        page:        1,
        perPage:     25,
        total:       0,
        pages:       0,
        filter:      'all',
        assigned_to: '',
        status:      'pending',
        search:      '',
        date:        '',
        tags:        [],
        selectedIds: new Set(),
        savingQueue: {},
        products:    [],
    };

    const REST  = WCKAMRM.rest_url;
    const NONCE = WCKAMRM.rest_nonce;

    function restHeaders() {
        return { 'X-WP-Nonce': NONCE, 'Content-Type': 'application/json' };
    }

    /* ---- MODAL STATE ---- */
    const modal = {
        ids:          [],
        index:        -1,
        product:      null,
        saveTimers:   {},
        commentTimer: null,
        open:         false,
    };

    /* ================================================================
       INIT
    ================================================================= */
    $(function () {
        populateUserDropdowns();
        populateTagsFilter();
        setDefaultDate();
        bindEvents();
        initModal();
        bindKeyboard();
        loadStats();
        loadProducts();
    });

    function populateUserDropdowns() {
        const opts = WCKAMRM.users.map(u =>
            `<option value="${u.id}">${escHtml(u.name)}</option>`
        ).join('');
        $('#filter-assigned').append(opts);
        $('#bulk-assign-user').append(opts);
        $('#modal-assign-user').append(opts);
    }

    function populateTagsFilter() {
        const tags = WCKAMRM.tags || [];
        if (!tags.length) { $('#filter-tags').closest('.rm-filter-group').hide(); return; }
        const opts = tags.map(t =>
            `<option value="${t.id}">${escHtml(t.name)}</option>`
        ).join('');
        $('#filter-tags').html('<option value="" disabled>🏷 Etiquetas…</option>' + opts);
    }

    function setDefaultDate() {
        const today = new Date().toISOString().split('T')[0];
        $('#bulk-assign-date').val(today);
        $('#modal-assign-date').val(today);
    }

    /* ================================================================
       EVENTS
    ================================================================= */
    function bindEvents() {
        let searchTimer;
        $('#filter-search').on('input', function () {
            clearTimeout(searchTimer);
            searchTimer = setTimeout(() => { state.search = this.value; state.page = 1; loadProducts(); }, 350);
        });
        $('#filter-status').on('change',    function () { state.status = this.value; state.page = 1; loadProducts(); });
        $('#filter-checklist').on('change', function () { state.filter = this.value; state.page = 1; loadProducts(); });
        $('#filter-assigned').on('change',  function () { state.assigned_to = this.value; state.page = 1; loadProducts(); });
        $('#filter-date').on('change',      function () { state.date = this.value; state.page = 1; loadProducts(); });
        $('#filter-perpage').on('change',   function () { state.perPage = parseInt(this.value); state.page = 1; loadProducts(); });

        $('#filter-tags').on('change', function () {
            state.tags = Array.from(this.selectedOptions).map(o => o.value).filter(Boolean);
            state.page = 1;
            loadProducts();
        });

        $('#btn-reset-filters').on('click', resetFilters);

        $('#select-all').on('change', function () {
            const checked = this.checked;
            state.products.forEach(p => {
                if (checked) state.selectedIds.add(p.id);
                else         state.selectedIds.delete(p.id);
            });
            updateBulkBar();
            renderTable(state.products);
        });

        $('#btn-claim-queue').on('click', claimFromQueue);

        $('#btn-open-assign-modal').on('click', () => $('#assign-modal').show());
        $('#btn-close-modal, #btn-modal-cancel').on('click', () => $('#assign-modal').hide());
        $('#btn-modal-confirm').on('click', bulkAssignFromModal);

        $('#btn-bulk-assign').on('click', bulkAssignSelected);
        $('#btn-deselect').on('click', () => {
            state.selectedIds.clear();
            updateBulkBar();
            renderTable(state.products);
        });

        // Table delegation
        $('#products-tbody').on('change', '.rm-check-select',  onCheckChange);
        $('#products-tbody').on('change', '.rm-estado-select', onEstadoChange);
        $('#products-tbody').on('change', '.row-checkbox',     onRowCheckbox);

        // Inline assignment: click on assigned chip
        $('#products-tbody').on('click', '.rm-assigned-chip', function (e) {
            e.stopPropagation();
            const $td   = $(this).closest('td');
            const pid   = parseInt($td.data('pid'));
            const today = new Date().toISOString().split('T')[0];
            const opts  = WCKAMRM.users.map(u =>
                `<option value="${u.id}">${escHtml(u.name)}</option>`
            ).join('');
            const $sel = $(`<select class="rm-inline-assign rm-select rm-select-sm">
                <option value="">— Sin asignar —</option>${opts}
            </select>`);
            $td.html($sel);
            $sel.focus();

            // FIX: flag to avoid double loadProducts() on blur after change
            let assignHandled = false;

            $sel.on('change', function () {
                const userId = parseInt(this.value);
                if (!userId) { assignHandled = true; loadProducts(); return; }
                assignHandled = true;
                fetch(REST + 'assign', {
                    method: 'POST', headers: restHeaders(),
                    body: JSON.stringify({ user_id: userId, product_ids: [pid], date: today }),
                })
                .then(r => r.json())
                .then(res => {
                    if (res.success) {
                        showToast('👤 Asignado a ' + escHtml(res.assigned_user || ''), 'success');
                        loadProducts();
                    } else {
                        showToast(res.error || 'Error al asignar', 'error');
                        loadProducts();
                    }
                })
                .catch(() => { showToast('Error de conexión', 'error'); loadProducts(); });
            });
            $sel.on('blur', function () {
                // FIX: only reload if change handler did not already handle it
                if (!assignHandled) setTimeout(() => loadProducts(), 200);
            });
        });

        // Expand/collapse variations for variable products
        $('#products-tbody').on('click', '.rm-expand-toggle', function (e) {
            e.stopPropagation();
            const pid  = parseInt($(this).data('pid'));
            const $btn = $(this);
            toggleVariations(pid, $btn);
        });

        // Row click → open review modal
        $('#products-tbody').on('click', 'tr[data-pid]', function (e) {
            if ($(e.target).closest('select, input, a, button').length) return;
            openReviewModal(parseInt($(this).data('pid')));
        });
    }

    function resetFilters() {
        state.search = ''; state.status = 'pending'; state.filter = 'all';
        state.assigned_to = ''; state.date = ''; state.page = 1; state.tags = [];
        $('#filter-search').val('');
        $('#filter-status').val('pending');
        $('#filter-checklist').val('all');
        $('#filter-assigned').val('');
        $('#filter-date').val('');
        $('#filter-tags').val([]);
        loadProducts();
    }

    /* ================================================================
       LOAD STATS
    ================================================================= */
    function loadStats() {
        fetch(REST + 'stats', { headers: restHeaders() })
            .then(r => r.json())
            .then(data => {
                $('#stat-total').text(fmt(data.total_products));
                $('#stat-approved').text(fmt(data.total_approved));
                $('#stat-pending').text(fmt(data.total_pending || 0));
                $('#stat-queue').text(fmt(data.queue_free));
                $('#stat-my-done').text(data.my_today_done);
                $('#stat-my-total').text(data.my_today_total || data.quota);

                const pct = data.my_today_total
                    ? Math.round((data.my_today_done / data.my_today_total) * 100) : 0;
                $('#my-progress-bar').css('width', pct + '%');

                const lb = data.leaderboard || [];
                if (lb.length === 0) {
                    $('#leaderboard').html('<span style="color:var(--rm-text-dim);font-size:11px;">Sin actividad hoy</span>');
                    return;
                }
                const html = lb.slice(0, 4).map(row => {
                    const isMe = parseInt(row.user_id) === WCKAMRM.current_user;
                    return `<div class="rm-lb-row ${isMe ? 'rm-lb-me' : ''}">
                        <span>${escHtml(row.name.split(' ')[0])}</span>
                        <span class="rm-lb-done">${row.done}/${row.total}</span>
                    </div>`;
                }).join('');
                $('#leaderboard').html(html);
            });
    }

    /* ================================================================
       LOAD PRODUCTS
    ================================================================= */
    function loadProducts() {
        const tbody = $('#products-tbody');
        tbody.html('<tr class="rm-loading-row"><td colspan="13"><div class="rm-loader"><div class="rm-spinner"></div><span>Cargando...</span></div></td></tr>');

        const params = new URLSearchParams({
            page:        state.page,
            per_page:    state.perPage,
            filter:      state.filter,
            status:      state.status,
            search:      state.search,
            assigned_to: state.assigned_to,
            date:        state.date,
            tags:        state.tags.join(','),
        });

        fetch(`${REST}products?${params}`, { headers: restHeaders() })
            .then(r => r.json())
            .then(data => {
                state.products = data.products || [];
                state.total    = data.total    || 0;
                state.pages    = data.pages    || 1;
                renderTable(state.products);
                renderPagination();
            })
            .catch(() => {
                tbody.html('<tr class="rm-empty-row"><td colspan="13">❌ Error al cargar productos</td></tr>');
            });
    }

    /* ================================================================
       RENDER TABLE
    ================================================================= */
    function renderTable(products) {
        const tbody = $('#products-tbody');
        if (!products.length) {
            tbody.html('<tr class="rm-empty-row"><td colspan="13">🔍 No se encontraron productos con esos filtros</td></tr>');
            return;
        }
        tbody.html(products.map(p => buildRow(p)).join(''));
        tbody.find('.rm-check-select').each(function () { applyCheckClass($(this)); });
    }

    function buildRow(p) {
        const isSelected = state.selectedIds.has(p.id);
        const isApproved = p.score === 100;
        const rowClass   = isApproved ? 'rm-row-approved' : (isSelected ? 'rm-row-selected' : '');

        const thumb = p.thumb_url
            ? `<img src="${escHtml(p.thumb_url)}" class="rm-thumb" alt="" loading="lazy">`
            : `<div class="rm-thumb-placeholder">📦</div>`;

        const statusMap = {
            publish:    { cls: 'rm-status-publish',  lbl: '● Publicado'    },
            draft:      { cls: 'rm-status-draft',    lbl: '○ Borrador'     },
            pending:    { cls: 'rm-status-pending',  lbl: '⏳ Pendiente'   },
            ready:      { cls: 'rm-status-publish',  lbl: '✅ Ready'       },
            inprogress: { cls: 'rm-status-draft',    lbl: '🔄 In Progress' },
        };
        const st = statusMap[p.status] || { cls: 'rm-status-draft', lbl: p.status };

        // Product type — separate Tipo column
        const typeMap = {
            variable:  '<span class="rm-type-badge rm-type-var">Padre</span>',
            variation: '<span class="rm-type-badge rm-type-var">Variante</span>',
            grouped:   '<span class="rm-type-badge rm-type-var">GRP</span>',
            simple:    '<span class="rm-type-badge rm-type-simple">Solo</span>',
        };
        const tipoBadge = typeMap[p.product_type] || '<span class="rm-type-badge rm-type-simple">Solo</span>';

        let priceHtml = '';
        if (p.sale_price) {
            priceHtml = `<span class="rm-price rm-price-original">$${escHtml(p.regular_price)}</span>
                         <span class="rm-price rm-price-sale">$${escHtml(p.sale_price)}</span>`;
        } else {
            priceHtml = `<span class="rm-price">$${escHtml(p.regular_price || '—')}</span>`;
        }

        // 3 inline checklist columns: Es El Producto + Imágenes + Título
        const checkFields = [
            { key: 'producto', val: p.checks.producto },
            { key: 'imagenes', val: p.checks.imagenes },
            { key: 'titulo',   val: p.checks.titulo   },
        ];
        const checkHtml = checkFields.map(f =>
            `<td><select class="rm-check-select val-${f.val||''}" data-pid="${p.id}" data-field="revision_${f.key}_ok">
                <option value=""   ${!f.val        ? 'selected':''}>—</option>
                <option value="si" ${f.val==='si'  ? 'selected':''}>✅</option>
                <option value="no" ${f.val==='no'  ? 'selected':''}>❌</option>
                <option value="na" ${f.val==='na'  ? 'selected':''}>➖</option>
            </select></td>`
        ).join('');

        const scoreClass = p.score === 100 ? 'rm-score-ok' : p.score >= 60 ? 'rm-score-mid' : p.score > 0 ? 'rm-score-low' : 'rm-score-0';
        const scoreBadge = `<span class="rm-score-badge ${scoreClass}">${p.score}%</span>`;

        const isMe = p.assigned_to === WCKAMRM.current_user;
        const assignedHtml = p.assigned_user
            ? `<span class="rm-assigned-chip ${isMe ? 'chip-me' : ''}" title="Click para reasignar">${isMe ? '👤 Yo' : escHtml(p.assigned_user)}</span>`
            : `<span class="rm-assigned-chip chip-none" title="Click para asignar">— libre —</span>`;

        const estadoOpts = [
            { v: '',          l: '— N/R —'    },
            { v: 'aprobado',  l: '✅ Aprobado' },
            { v: 'rechazado', l: '❌ Rechazado'},
        ].map(e =>
            `<option value="${e.v}" ${p.revision_estado === e.v ? 'selected' : ''}>${e.l}</option>`
        ).join('');

        const tagsHtml = (p.tags && p.tags.length)
            ? p.tags.slice(0, 4).map(t => `<span class="rm-tag-chip">${escHtml(t)}</span>`).join('')
            : '<span class="rm-no-tags">—</span>';

        const isVariable   = p.product_type === 'variable';
        const expandToggle = isVariable
            ? `<button class="rm-expand-toggle" data-pid="${p.id}" title="Ver variantes">▶</button>`
            : '';

        const mainRow = `<tr data-pid="${p.id}" class="${rowClass}${isVariable ? ' rm-row-variable' : ''}">
            <td class="col-check"><input type="checkbox" class="row-checkbox" data-pid="${p.id}" ${isSelected ? 'checked':''}></td>
            <td class="col-img">${thumb}</td>
            <td class="col-info">
                ${expandToggle}
                <span class="rm-prod-name" title="${escHtml(p.name)}">${escHtml(p.name)}</span>
                <span class="rm-prod-sku">${escHtml(p.sku || '—')}</span>
                <span class="rm-prod-status ${st.cls}">${st.lbl}</span>
            </td>
            <td class="col-precio">${priceHtml}</td>
            <td class="col-tipo">${tipoBadge}</td>
            ${checkHtml}
            <td class="col-score">${scoreBadge}</td>
            <td class="col-tags">${tagsHtml}</td>
            <td class="col-asignado" data-pid="${p.id}">${assignedHtml}</td>
            <td class="col-estado">
                <select class="rm-estado-select" data-pid="${p.id}">${estadoOpts}</select>
            </td>
            <td class="col-actions">
                <a href="${escHtml(p.edit_url)}" target="_blank" class="rm-action-edit" title="Editar en WC">✏️</a>
            </td>
        </tr>`;

        const subRow = isVariable
            ? `<tr class="rm-variations-row" id="rm-var-row-${p.id}" style="display:none;">
                <td colspan="13">
                    <div class="rm-var-container" id="rm-var-container-${p.id}"></div>
                </td>
              </tr>`
            : '';

        return mainRow + subRow;
    }

    /* ================================================================
       INLINE CHECK CHANGE
    ================================================================= */
    function onCheckChange() {
        const $sel  = $(this);
        const pid   = parseInt($sel.data('pid'));
        const field = $sel.data('field');
        const value = $sel.val();

        applyCheckClass($sel);
        clearTimeout(state.savingQueue[pid]);
        showSavingDot(pid);

        state.savingQueue[pid] = setTimeout(() => {
            const row     = $(`tr[data-pid="${pid}"]`);
            const payload = {};
            row.find('.rm-check-select').each(function () {
                payload[$(this).data('field')] = $(this).val();
            });
            payload[field] = value;

            saveChecklist(pid, payload, () => {
                hideSavingDot(pid);
                reloadRowScore(pid, payload);
            });
        }, 600);
    }

    function onEstadoChange() {
        const pid   = parseInt($(this).data('pid'));
        const value = $(this).val();
        clearTimeout(state.savingQueue['estado_' + pid]);
        state.savingQueue['estado_' + pid] = setTimeout(() => {
            saveChecklist(pid, { revision_estado: value }, () => {
                showToast('Estado guardado', 'success');
            });
        }, 500);
    }

    function applyCheckClass($sel) {
        $sel.removeClass('val- val-si val-no val-na').addClass('val-' + ($sel.val() || ''));
    }

    // Score based on 3 visible table checks
    function reloadRowScore(pid, payload) {
        const checks   = ['revision_producto_ok', 'revision_imagenes_ok', 'revision_titulo_ok'];
        const approved = checks.filter(k => payload[k] === 'si').length;
        const score    = Math.round((approved / checks.length) * 100);
        const cls      = score === 100 ? 'rm-score-ok' : score >= 60 ? 'rm-score-mid' : score > 0 ? 'rm-score-low' : 'rm-score-0';
        $(`tr[data-pid="${pid}"] .rm-score-badge`).attr('class', `rm-score-badge ${cls}`).text(score + '%');

        if (score === 100) {
            $(`tr[data-pid="${pid}"]`).addClass('rm-row-approved');
            showToast('✅ Checks completados', 'success');
            loadStats();
        }
    }

    function showSavingDot(pid) {
        const nameEl = $(`tr[data-pid="${pid}"] .rm-prod-name`);
        if (!nameEl.find('.rm-saving-dot').length) nameEl.append('<span class="rm-saving-dot"></span>');
    }
    function hideSavingDot(pid) {
        $(`tr[data-pid="${pid}"] .rm-saving-dot`).remove();
    }

    /* ================================================================
       VARIATIONS EXPAND / COLLAPSE
    ================================================================= */
    function toggleVariations(pid, $btn) {
        const $row = $('#rm-var-row-' + pid);
        const open = $row.is(':visible');

        if (open) {
            $row.hide();
            $btn.text('▶').removeClass('expanded');
            return;
        }

        $btn.text('▼').addClass('expanded');
        $row.show();

        const $container = $('#rm-var-container-' + pid);
        // Only fetch once; if already populated skip
        if ($container.data('loaded')) return;

        $container.html('<div class="rm-var-loading"><div class="rm-spinner rm-spinner-sm"></div> Cargando variantes…</div>');

        fetch(`${REST}product/${pid}/variations`, { headers: restHeaders() })
            .then(r => r.json())
            .then(vars => {
                $container.data('loaded', true);
                renderVariations(pid, vars, $container);
            })
            .catch(() => {
                $container.html('<span class="rm-var-error">❌ Error al cargar variantes</span>');
            });
    }

    function renderVariations(pid, variations, $container) {
        if (!variations || !variations.length) {
            $container.html('<span class="rm-var-empty">Sin variantes registradas</span>');
            return;
        }

        const sections = variations.map(v => {
            // Build section title from attribute values (e.g. "AZUL MARINO · 29 GALLERY")
            const titleParts = (v.attributes || []).map(a => a.option.toUpperCase());
            const title      = titleParts.join(' · ') + ' GALLERY';

            const imgHtml = v.image_url
                ? `<img src="${escHtml(v.image_url)}" class="rm-var-gal-img" alt="" data-img-id="${escHtml(v.image_id)}">`
                : '';

            const skuLabel = v.sku ? `<span class="rm-var-gal-sku">${escHtml(v.sku)}</span>` : '';

            return `<div class="rm-var-gallery-section" data-var-id="${v.id}" data-parent-id="${pid}" data-gallery-key="${escHtml(v.gallery_key)}">
                <div class="rm-var-gal-header">
                    <span class="rm-var-gal-title">${escHtml(title)}</span>
                    ${skuLabel}
                    <button class="rm-var-gal-delete" data-parent-id="${pid}" data-gallery-key="${escHtml(v.gallery_key)}" title="Quitar imagen">Delete</button>
                </div>
                <div class="rm-var-gal-body">
                    <div class="rm-var-gal-thumbs" id="rm-var-gal-thumbs-${v.id}">
                        ${imgHtml}
                    </div>
                    <button class="rm-var-gal-add" data-var-id="${v.id}" data-parent-id="${pid}" data-gallery-key="${escHtml(v.gallery_key)}" title="Elegir imagen">
                        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                        <span>Add images</span>
                    </button>
                </div>
            </div>`;
        }).join('');

        $container.html(`<div class="rm-var-galleries">${sections}</div>`);

        // ---- Media picker: Add image ----
        $container.find('.rm-var-gal-add').on('click', function (e) {
            e.stopPropagation();
            const $btn       = $(this);
            const parentId   = parseInt($btn.data('parent-id'));
            const galleryKey = $btn.data('gallery-key');
            const varId      = $btn.data('var-id');
            const $thumbs    = $(`#rm-var-gal-thumbs-${varId}`);

            if (typeof wp === 'undefined' || !wp.media) {
                showToast('Media library no disponible', 'error');
                return;
            }

            const frame = wp.media({
                title:    'Seleccionar imagen para variante',
                button:   { text: 'Usar esta imagen' },
                multiple: false,
                library:  { type: 'image' },
            });

            frame.on('select', function () {
                const att    = frame.state().get('selection').first().toJSON();
                const imgId  = att.id;
                const imgUrl = (att.sizes && att.sizes.thumbnail)
                    ? att.sizes.thumbnail.url : att.url;

                fetch(`${REST}product/${parentId}/variation-image`, {
                    method: 'POST', headers: restHeaders(),
                    body: JSON.stringify({ gallery_key: galleryKey, image_id: imgId }),
                })
                .then(r => r.json())
                .then(res => {
                    if (res.success) {
                        $thumbs.html(`<img src="${escHtml(res.image_url || imgUrl)}" class="rm-var-gal-img" alt="" data-img-id="${imgId}">`);
                        showToast('✅ Imagen guardada', 'success');
                    } else {
                        showToast(res.error || 'Error al guardar imagen', 'error');
                    }
                })
                .catch(() => showToast('Error de conexión', 'error'));
            });

            frame.open();
        });

        // ---- Delete: clear image from gallery key ----
        $container.find('.rm-var-gal-delete').on('click', function (e) {
            e.stopPropagation();
            if (!confirm('¿Quitar la imagen de esta variante?')) return;
            const $btn       = $(this);
            const parentId   = parseInt($btn.data('parent-id'));
            const galleryKey = $btn.data('gallery-key');
            const $section   = $btn.closest('.rm-var-gallery-section');
            const varId      = $section.data('var-id');

            fetch(`${REST}product/${parentId}/variation-image`, {
                method: 'POST', headers: restHeaders(),
                body: JSON.stringify({ gallery_key: galleryKey, image_id: 0 }),
            })
            .then(r => r.json())
            .then(res => {
                if (res.success) {
                    $(`#rm-var-gal-thumbs-${varId}`).empty();
                    showToast('Imagen eliminada', 'success');
                } else {
                    showToast(res.error || 'Error al eliminar', 'error');
                }
            })
            .catch(() => showToast('Error de conexión', 'error'));
        });
    }

    /* ================================================================
       SAVE CHECKLIST (REST)
    ================================================================= */
    function saveChecklist(pid, data, callback) {
        fetch(`${REST}product/${pid}/checklist`, {
            method: 'POST', headers: restHeaders(), body: JSON.stringify(data),
        })
        .then(r => r.json())
        .then(res => { if (res.success && callback) callback(res); })
        .catch(() => showToast('Error al guardar', 'error'));
    }

    /* ================================================================
       ROW CHECKBOX
    ================================================================= */
    function onRowCheckbox() {
        const pid = parseInt($(this).data('pid'));
        if (this.checked) state.selectedIds.add(pid);
        else              state.selectedIds.delete(pid);
        updateBulkBar();
        $(`tr[data-pid="${pid}"]`).toggleClass('rm-row-selected', this.checked);
    }

    function updateBulkBar() {
        const count = state.selectedIds.size;
        if (count === 0) {
            $('#bulk-bar').hide();
            $('#select-all').prop('checked', false);
        } else {
            $('#bulk-bar').show();
            $('#bulk-count').text(`${count} seleccionado${count > 1 ? 's' : ''}`);
        }
    }

    /* ================================================================
       CLAIM FROM QUEUE
    ================================================================= */
    function claimFromQueue() {
        const quota = WCKAMRM.daily_quota;
        if (!confirm(`¿Tomar hasta ${quota} productos pendientes de la cola para revisar hoy?`)) return;

        $('#btn-claim-queue').text('Tomando...').prop('disabled', true);

        fetch(REST + 'claim', {
            method: 'POST', headers: restHeaders(),
            body: JSON.stringify({ count: quota }),
        })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                showToast(`⚡ ${res.claimed} productos asignados (${res.total_today} hoy)`, 'success');
                loadStats();
                state.assigned_to = 'me';
                $('#filter-assigned').val('me');
                state.page = 1;
                loadProducts();
            } else {
                showToast(res.error || 'No hay productos disponibles', 'error');
            }
        })
        .catch(() => showToast('Error de conexión', 'error'))
        .finally(() => {
            $('#btn-claim-queue').text('⚡ Tomar de la Cola').prop('disabled', false);
        });
    }

    /* ================================================================
       BULK ASSIGN FROM MODAL — only pending products
    ================================================================= */
    function bulkAssignFromModal() {
        const userId = parseInt($('#modal-assign-user').val());
        const date   = $('#modal-assign-date').val();
        const qty    = parseInt($('#modal-assign-qty').val()) || 20;

        if (!userId) { showToast('Selecciona un usuario', 'error'); return; }

        const params = new URLSearchParams({ page: 1, per_page: qty, filter: 'all', status: 'pending', assigned_to: '' });

        fetch(`${REST}products?${params}`, { headers: restHeaders() })
            .then(r => r.json())
            .then(data => {
                const ids = (data.products || []).map(p => p.id);
                if (!ids.length) { showToast('No hay productos pendientes para asignar', 'error'); return Promise.reject(); }

                return fetch(REST + 'assign', {
                    method: 'POST', headers: restHeaders(),
                    body: JSON.stringify({ user_id: userId, product_ids: ids, date }),
                });
            })
            .then(r => r && r.json())
            .then(res => {
                if (res && res.success) {
                    showToast(`👥 ${res.assigned} productos asignados`, 'success');
                    $('#assign-modal').hide();
                    loadStats();
                    loadProducts();
                }
            })
            .catch(() => {});
    }

    /* ================================================================
       BULK ASSIGN SELECTED
    ================================================================= */
    function bulkAssignSelected() {
        const userId = parseInt($('#bulk-assign-user').val());
        const date   = $('#bulk-assign-date').val();
        const ids    = [...state.selectedIds];

        if (!userId) { showToast('Selecciona un usuario', 'error'); return; }
        if (!ids.length) { showToast('Selecciona productos primero', 'error'); return; }

        fetch(REST + 'assign', {
            method: 'POST', headers: restHeaders(),
            body: JSON.stringify({ user_id: userId, product_ids: ids, date }),
        })
        .then(r => r.json())
        .then(res => {
            if (res.success) {
                showToast(`👥 ${res.assigned} productos asignados`, 'success');
                state.selectedIds.clear();
                updateBulkBar();
                loadProducts();
                loadStats();
            }
        })
        .catch(() => showToast('Error al asignar', 'error'));
    }

    /* ================================================================
       PAGINATION
    ================================================================= */
    function renderPagination() {
        const { page, pages, total, perPage } = state;
        const start = ((page - 1) * perPage) + 1;
        const end   = Math.min(page * perPage, total);

        $('#pagination-info').text(`${fmt(start)}–${fmt(end)} de ${fmt(total)} productos`);

        let btns = `<button class="rm-page-btn" ${page <= 1 ? 'disabled' : ''} data-p="${page-1}">‹</button>`;
        pagRange(page, pages).forEach(p => {
            btns += p === '…'
                ? `<span style="padding:0 4px;color:var(--rm-text-dim)">…</span>`
                : `<button class="rm-page-btn ${p === page ? 'active' : ''}" data-p="${p}">${p}</button>`;
        });
        btns += `<button class="rm-page-btn" ${page >= pages ? 'disabled' : ''} data-p="${page+1}">›</button>`;

        const $ctrl = $('#pagination-controls').html(btns);
        $ctrl.off('click').on('click', '.rm-page-btn:not(:disabled)', function () {
            state.page = parseInt($(this).data('p'));
            loadProducts();
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    function pagRange(current, total) {
        if (total <= 7) return Array.from({length: total}, (_, i) => i + 1);
        const pages = [1];
        if (current > 3) pages.push('…');
        for (let p = Math.max(2, current-1); p <= Math.min(total-1, current+1); p++) pages.push(p);
        if (current < total-2) pages.push('…');
        pages.push(total);
        return pages;
    }

    /* ================================================================
       HELPERS
    ================================================================= */
    function showToast(msg, type = 'info') {
        const $t = $('#rm-toast');
        $t.removeClass('toast-success toast-error toast-info show')
          .addClass(`toast-${type}`).text(msg);
        setTimeout(() => $t.addClass('show'), 10);
        setTimeout(() => $t.removeClass('show'), 3000);
    }
    function fmt(n) { return Number(n).toLocaleString('es-MX'); }
    function escHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;').replace(/</g, '&lt;')
            .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    /* ================================================================
       REVIEW MODAL — INIT
       Button order: [✏️ Editar] [❌ RECHAZAR] [✅ APROBAR]
    ================================================================= */
    function initModal() {
        if ($('#rm-review-overlay').length) return;
        $('body').append(
            '<div id="rm-review-overlay" class="rm-review-overlay" style="display:none;">' +
            '<div class="rm-review-modal">' +
            '<button class="rm-review-close" id="rm-review-close" title="Cerrar (Esc)">✕</button>' +
            '<div class="rm-review-left" id="rm-review-left">' +
            '<div class="rm-review-left-loading"><div class="rm-spinner"></div></div>' +
            '</div>' +
            '<div class="rm-review-right">' +
            '<div class="rm-rpanel">' +
            '<div class="rm-rpanel-header">' +
            '<span class="rm-rpanel-id" id="rm-panel-id"></span>' +
            '<span class="rm-rpanel-sku" id="rm-panel-sku"></span>' +
            '</div>' +
            '<div class="rm-checklist" id="rm-checklist"></div>' +
            '<div class="rm-rfield" style="margin-top:4px;">' +
            '<label class="rm-rlabel">Comentario de revisión</label>' +
            '<textarea id="rm-field-comment" class="rm-rtextarea-sm" rows="3" placeholder="Notas..."></textarea>' +
            '</div>' +
            '<div class="rm-score-section">' +
            '<div class="rm-score-bar-track"><div class="rm-score-bar-fill" id="rm-score-bar"></div></div>' +
            '<span class="rm-score-pct" id="rm-score-pct">0%</span>' +
            '</div>' +
            '<div class="rm-rnav">' +
            '<button class="rm-btn rm-btn-ghost rm-btn-sm" id="rm-nav-prev" title="Anterior (←)">← Ant.</button>' +
            '<span class="rm-rnav-pos" id="rm-rnav-pos">— / —</span>' +
            '<button class="rm-btn rm-btn-ghost rm-btn-sm" id="rm-nav-next" title="Siguiente (→)">Sig. →</button>' +
            '</div>' +
            // Order: Edit | Rechazar | Aprobar
            '<div class="rm-raction-btns">' +
            '<a class="rm-btn-editar-wc" id="rm-btn-editar-wc" target="_blank" title="Editar en WooCommerce">✏️</a>' +
            '<button class="rm-btn-rechazar" id="rm-btn-rechazar" title="Rechazar (R)">❌ RECHAZAR</button>' +
            '<button class="rm-btn-aprobar"  id="rm-btn-aprobar"  title="Aprobar (A)">✅ APROBAR</button>' +
            '</div>' +
            '</div></div></div></div>'
        );
        bindModalStaticEvents();
    }

    function bindModalStaticEvents() {
        $(document).on('click', '#rm-review-close', closeReviewModal);
        $(document).on('click', '#rm-review-overlay', function (e) {
            if (e.target === this && !$('.media-modal:visible').length) closeReviewModal();
        });

        $(document).on('click', '#rm-nav-prev', function () { navigateModal(-1); });
        $(document).on('click', '#rm-nav-next', function () { navigateModal(1); });

        $(document).on('click', '#rm-btn-aprobar', function () {
            if (modal.product) doProductAction(modal.product.id, 'aprobar');
        });
        $(document).on('click', '#rm-btn-rechazar', function () {
            if (modal.product) doProductAction(modal.product.id, 'rechazar');
        });

        // Checklist buttons
        $(document).on('click', '#rm-checklist .rm-cbtn', function () {
            if (!modal.product) return;
            var $item  = $(this).closest('.rm-check-item');
            var field  = $item.data('field');
            var val    = $(this).data('val');

            $item.find('.rm-cbtn').removeClass('active-ok active-no active-na');
            $(this).addClass('active-' + val);

            var bCls = val === 'si' ? 'badge-ok' : val === 'no' ? 'badge-no' : 'badge-na';
            var bLbl = val === 'si' ? 'OK'       : val === 'no' ? 'NO'      : 'N/A';
            $item.find('.rm-check-badge').attr('class', 'rm-check-badge ' + bCls).text(bLbl);

            var key = field.replace('revision_', '').replace('_ok', '');
            modal.product.checks[key] = val;
            updateModalScore(modal.product.checks);
            saveChecklistItem(modal.product.id, field, val);
        });

        // Gallery thumbnail click
        $(document).on('click', '.rm-gallery-thumb', function () {
            $('#rm-main-img').attr('src', $(this).data('src'));
            $('.rm-gallery-thumb').removeClass('active');
            $(this).addClass('active');
        });

        // Gallery delete
        $(document).on('click', '.rm-gallery-del', function (e) {
            e.stopPropagation();
            e.preventDefault();
            if (!modal.product) return;
            if (!confirm('¿Eliminar esta imagen de la galería?')) return;
            var pid     = modal.product.id;
            var imageId = parseInt($(this).data('id'));
            var $wrap   = $(this).closest('.rm-gallery-item');

            fetch(REST + 'product/' + pid + '/gallery', {
                method: 'POST', headers: restHeaders(),
                body: JSON.stringify({ action: 'remove', image_id: imageId }),
            })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res.success) { $wrap.remove(); showToast('Imagen eliminada', 'success'); }
                else showToast(res.error || 'Error al eliminar', 'error');
            })
            .catch(function () { showToast('Error de conexión', 'error'); });
        });

        // Gallery add is bound directly in populateModal() for reliability

        // Comment auto-save (800ms)
        $(document).on('input', '#rm-field-comment', function () {
            if (!modal.product) return;
            clearTimeout(modal.commentTimer);
            var val = $(this).val(), pid = modal.product.id;
            modal.commentTimer = setTimeout(function () {
                saveChecklistItem(pid, 'comentario_revision', val);
            }, 800);
        });

        // Title character counter
        $(document).on('input', '#rm-field-title', function () {
            $('#rm-title-counter').text(this.value.length + ' car.');
        });

        // Inline field auto-save (800ms debounce)
        var fieldCfg = {
            'rm-field-title':         { key: 'title',          ind: 'rm-save-title'         },
            'rm-field-desc':          { key: 'description',    ind: 'rm-save-desc'           },
            'rm-field-regular':       { key: 'regular_price',  ind: 'rm-save-regular'        },
            'rm-field-sale':          { key: 'sale_price',     ind: 'rm-save-sale'           },
            'rm-field-alibaba-url':   { key: 'url_alibaba',    ind: 'rm-save-alibaba-url'    },
            'rm-field-alibaba-price': { key: 'alibaba_price',  ind: 'rm-save-alibaba-price'  },
            'rm-field-weight':            { key: 'weight',             ind: 'rm-save-weight'             },
            'rm-field-producto-correcto': { key: 'producto_correcto',   ind: 'rm-save-producto-correcto'  },
        };
        // Dimensions save (length/width/height as a group)
        $(document).on('input', '#rm-field-length, #rm-field-width, #rm-field-height', function () {
            if (!modal.product) return;
            clearTimeout(modal.saveTimers['dims']);
            $('#rm-save-dims').text('Guardando...').removeClass('saved');
            var pid = modal.product.id;
            modal.saveTimers['dims'] = setTimeout(function () {
                fetch(REST + 'product/' + pid + '/update', {
                    method: 'POST', headers: restHeaders(),
                    body: JSON.stringify({
                        length: $('#rm-field-length').val(),
                        width:  $('#rm-field-width').val(),
                        height: $('#rm-field-height').val(),
                    }),
                })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (res.success) {
                        $('#rm-save-dims').text('✓').addClass('saved');
                        setTimeout(function () { $('#rm-save-dims').text(''); }, 2000);
                    } else { $('#rm-save-dims').text('❌'); }
                })
                .catch(function () { $('#rm-save-dims').text('❌'); });
            }, 800);
        });

        $(document).on('input',
            '#rm-field-title, #rm-field-desc, #rm-field-regular, #rm-field-sale, ' +
            '#rm-field-alibaba-url, #rm-field-alibaba-price, #rm-field-weight, #rm-field-producto-correcto',
            function () {
                if (!modal.product) return;
                var cfg = fieldCfg[this.id];
                if (!cfg) return;
                clearTimeout(modal.saveTimers[this.id]);
                $('#' + cfg.ind).text('Guardando...').removeClass('saved');
                var pid = modal.product.id, val = $(this).val(), fid = this.id, fkey = cfg.key, ind = cfg.ind;
                modal.saveTimers[fid] = setTimeout(function () {
                    var payload = {};
                    payload[fkey] = val;
                    fetch(REST + 'product/' + pid + '/update', {
                        method: 'POST', headers: restHeaders(), body: JSON.stringify(payload),
                    })
                    .then(function (r) { return r.json(); })
                    .then(function (res) {
                        if (res.success) {
                            $('#' + ind).text('✓').addClass('saved');
                            setTimeout(function () { $('#' + ind).text(''); }, 2000);
                            if (fkey === 'title' && res.product) {
                                $('tr[data-pid="' + pid + '"] .rm-prod-name').text(res.product.name || '');
                                if (modal.product && modal.product.id === pid) {
                                    modal.product.title = res.product.name || val;
                                }
                            }
                            if (fkey === 'sku' && res.product) {
                                $('tr[data-pid="' + pid + '"] .rm-prod-sku').text(val);
                                $('#rm-panel-sku').text('SKU: ' + val);
                            }
                        } else {
                            $('#' + ind).text('❌');
                        }
                    })
                    .catch(function () { $('#' + ind).text('❌'); });
                }, 800);
            }
        );

        // Attribute delete is bound directly in populateModal() for reliability

        // ---- CATEGORY SEARCH & EDIT ----
        var catSearchTimer = null;

        // Category search input
        $(document).on('input', '#rm-cats-search', function () {
            var q = $(this).val().trim();
            clearTimeout(catSearchTimer);
            if (!q) { $('#rm-cats-dropdown').hide().empty(); return; }
            catSearchTimer = setTimeout(function () {
                fetch(REST + 'categories?search=' + encodeURIComponent(q) + '&number=15', { headers: restHeaders() })
                    .then(function (r) { return r.json(); })
                    .then(function (cats) {
                        var selectedIds = getSelectedCategoryIds();
                        var html = cats.map(function (c) {
                            var already = selectedIds.indexOf(c.id) !== -1;
                            return '<div class="rm-cats-opt' + (already ? ' rm-cats-opt-used' : '') + '" data-id="' + c.id + '" data-name="' + escHtml(c.name) + '">' +
                                escHtml(c.name) + (already ? ' ✓' : '') + '</div>';
                        }).join('');
                        if (!html) html = '<div class="rm-cats-opt rm-cats-opt-empty">Sin resultados</div>';
                        $('#rm-cats-dropdown').html(html).show();
                    });
            }, 300);
        });

        // Click on category search result → add tag
        $(document).on('click', '.rm-cats-opt:not(.rm-cats-opt-used):not(.rm-cats-opt-empty)', function () {
            if (!modal.product) return;
            var id   = parseInt($(this).data('id'));
            var name = $(this).data('name');
            // Check not already added
            if ($('#rm-cats-selected .rm-cat-tag[data-id="' + id + '"]').length) return;
            // Remove "sin categoría" placeholder if present
            $('#rm-cats-selected .rm-no-tags').remove();
            $('#rm-cats-selected').append(
                '<span class="rm-cat-tag" data-id="' + id + '">' + escHtml(name) +
                '<button class="rm-cat-del" data-id="' + id + '" title="Quitar">×</button></span>'
            );
            $('#rm-cats-search').val('');
            $('#rm-cats-dropdown').hide().empty();
            saveCategoriesForModal(modal.product.id);
        });

        // Click × on category tag → remove
        $(document).on('click', '.rm-cat-del', function (e) {
            e.stopPropagation();
            if (!modal.product) return;
            $(this).closest('.rm-cat-tag').remove();
            if (!$('#rm-cats-selected .rm-cat-tag').length) {
                $('#rm-cats-selected').html('<span class="rm-no-tags">— Sin categoría —</span>');
            }
            saveCategoriesForModal(modal.product.id);
        });

        // Hide category dropdown on click outside
        $(document).on('click', function (e) {
            if (!$(e.target).closest('#rm-cats-search, #rm-cats-dropdown').length) {
                $('#rm-cats-dropdown').hide();
            }
        });

        // Custom attribute edit (800ms)
        $(document).on('input', '.rm-attr-value-input', function () {
            if (!modal.product) return;
            clearTimeout(modal.saveTimers['attrs']);
            var pid = modal.product.id;
            modal.saveTimers['attrs'] = setTimeout(function () {
                var attrs = [];
                $('#rm-attrs-list .rm-attr-row').each(function () {
                    attrs.push({ name: $(this).data('name'), value: $(this).find('.rm-attr-value-input').val() });
                });
                fetch(REST + 'product/' + pid + '/update', {
                    method: 'POST', headers: restHeaders(), body: JSON.stringify({ attributes: attrs }),
                })
                .then(function (r) { return r.json(); })
                .then(function (res) { if (res.success) showToast('Atributos guardados', 'success'); });
            }, 800);
        });
    }

    /* ================================================================
       OPEN / CLOSE
    ================================================================= */
    function openReviewModal(pid) {
        modal.ids   = state.products.map(function (p) { return p.id; });
        modal.index = modal.ids.indexOf(pid);
        modal.open  = true;
        fetchAndShowProduct(pid);
        $('#rm-review-overlay').css('display', 'flex');
        $('body').css('overflow', 'hidden');
    }

    function closeReviewModal() {
        modal.open = false;
        $('#rm-review-overlay').css('display', 'none');
        $('body').css('overflow', '');
        Object.keys(modal.saveTimers).forEach(function (k) { clearTimeout(modal.saveTimers[k]); });
        modal.saveTimers = {};
        clearTimeout(modal.commentTimer);

        // Sync the table row so inline checks/score/estado reflect modal edits
        if (modal.product) {
            syncTableRow(modal.product);
        }
    }

    function syncTableRow(p) {
        var pid  = p.id;
        var $row = $('tr[data-pid="' + pid + '"]');
        if (!$row.length) return;

        var fieldMap = {
            'revision_producto_ok': p.checks ? (p.checks.producto || '') : '',
            'revision_imagenes_ok': p.checks ? (p.checks.imagenes || '') : '',
            'revision_titulo_ok':   p.checks ? (p.checks.titulo   || '') : '',
        };
        Object.keys(fieldMap).forEach(function (field) {
            var val  = fieldMap[field];
            var $sel = $row.find('.rm-check-select[data-field="' + field + '"]');
            $sel.val(val);
            $sel.removeClass('val- val-si val-no val-na').addClass('val-' + val);
        });

        // Recalculate score from the 3 visible checks
        reloadRowScore(pid, {
            revision_producto_ok: fieldMap['revision_producto_ok'],
            revision_imagenes_ok: fieldMap['revision_imagenes_ok'],
            revision_titulo_ok:   fieldMap['revision_titulo_ok'],
        });

        // Sync estado select
        if (p.revision_estado !== undefined) {
            $row.find('.rm-estado-select').val(p.revision_estado || '');
        }
    }

    /* ================================================================
       FETCH & RENDER PRODUCT
    ================================================================= */
    function fetchAndShowProduct(pid) {
        $('#rm-review-left').html(
            '<div class="rm-review-left-loading"><div class="rm-spinner"></div><span>Cargando...</span></div>'
        );
        $('#rm-review-right .rm-rpanel').css('opacity', '.4');
        fetch(REST + 'product/' + pid + '/detail?_ts=' + Date.now(), { headers: restHeaders(), cache: 'no-store' })
            .then(function (r) { return r.json(); })
            .then(function (product) { modal.product = product; populateModal(product); })
            .catch(function () {
                $('#rm-review-left').html('<div class="rm-review-left-loading">❌ Error al cargar el producto</div>');
            });
    }

    /* ================================================================
       CATEGORY TAGS HELPER
    ================================================================= */
    function buildCategoryTags(catIds, catNames) {
        if (!catIds || !catIds.length) return '<span class="rm-no-tags">— Sin categoría —</span>';
        var names = (catNames || '').split(', ').filter(Boolean);
        return catIds.map(function (id, i) {
            return '<span class="rm-cat-tag" data-id="' + id + '">' +
                escHtml(names[i] || 'Cat #' + id) +
                '<button class="rm-cat-del" data-id="' + id + '" title="Quitar">×</button></span>';
        }).join('');
    }

    function getSelectedCategoryIds() {
        var ids = [];
        $('#rm-cats-selected .rm-cat-tag').each(function () {
            ids.push(parseInt($(this).data('id')));
        });
        return ids;
    }

    function saveCategoriesForModal(pid) {
        var ids = getSelectedCategoryIds();
        $('#rm-save-cats').text('Guardando...').removeClass('saved');
        fetch(REST + 'product/' + pid + '/update', {
            method: 'POST', headers: restHeaders(),
            body: JSON.stringify({ category_ids: ids }),
        })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.success) {
                $('#rm-save-cats').text('✓').addClass('saved');
                setTimeout(function () { $('#rm-save-cats').text(''); }, 2000);
            } else {
                $('#rm-save-cats').text('❌');
            }
        })
        .catch(function () { $('#rm-save-cats').text('❌'); });
    }

    function populateModal(p) {
        // Gallery
        var galleryHtml = '<div class="rm-gallery" id="rm-gallery">';
        if (p.gallery && p.gallery.length) {
            p.gallery.forEach(function (img, i) {
                var delBtn = img.is_main ? '' :
                    '<button class="rm-gallery-del" data-id="' + img.id + '" title="Eliminar">×</button>';
                galleryHtml += '<div class="rm-gallery-item">' +
                    '<img src="' + escHtml(img.url) + '" class="rm-gallery-thumb' + (i === 0 ? ' active' : '') +
                    '" data-src="' + escHtml(img.url) + '" alt="" />' + delBtn + '</div>';
            });
        }
        galleryHtml += '<button class="rm-gallery-add-btn" id="rm-gallery-add" title="Agregar imágenes">＋</button></div>';

        // Attributes
        var attrsHtml = '';
        if (p.attributes && p.attributes.length) {
            attrsHtml = '<div id="rm-attrs-list">' + p.attributes.map(function (attr) {
                if (attr.is_taxonomy) {
                    return '<div class="rm-attr-row rm-attr-taxonomy" data-name="' + escHtml(attr.name) + '" data-taxonomy="' + escHtml(attr.taxonomy) + '">' +
                        '<span class="rm-attr-name-lbl">' + escHtml(attr.name) + '</span>' +
                        '<span class="rm-attr-value-ro">' + escHtml(attr.value) + '</span>' +
                        '<span class="rm-attr-tax-badge">WC</span>' +
                        '<button class="rm-attr-del" title="Eliminar atributo">×</button></div>';
                }
                return '<div class="rm-attr-row rm-attr-custom" data-name="' + escHtml(attr.name) + '">' +
                    '<span class="rm-attr-name-lbl">' + escHtml(attr.name) + '</span>' +
                    '<input type="text" class="rm-attr-value-input rm-rinput" value="' + escHtml(attr.value) + '" />' +
                    '<button class="rm-attr-del" title="Eliminar atributo">×</button></div>';
            }).join('') + '</div>' +
            '<span class="rm-attr-hint">Atributos WC (badge) solo se editan desde WooCommerce</span>';
        } else {
            attrsHtml = '<div class="rm-rreadonly" style="color:var(--rm-text-dim)">Sin atributos</div>';
        }

        $('#rm-review-left').html([
            '<div class="rm-main-img-wrap">',
            '<img id="rm-main-img" src="' + escHtml(p.main_image || '') + '" alt="" />',
            '</div>',
            galleryHtml,
            '<div class="rm-review-fields">',
            // Título
            '<div class="rm-rfield">',
            '<label class="rm-rlabel">Título <span class="rm-char-counter" id="rm-title-counter">' + (p.title ? p.title.length : 0) + ' car.</span></label>',
            '<input type="text" id="rm-field-title" class="rm-rinput" value="' + escHtml(p.title) + '" />',
            '<span class="rm-autosave-indicator" id="rm-save-title"></span>',
            '</div>',
            // Descripción
            '<div class="rm-rfield">',
            '<label class="rm-rlabel">Descripción</label>',
            '<textarea id="rm-field-desc" class="rm-rtextarea" rows="5">' + escHtml(p.description || '') + '</textarea>',
            '<span class="rm-autosave-indicator" id="rm-save-desc"></span>',
            '</div>',
            // Precios
            '<div class="rm-rfield rm-prices-row">',
            '<div class="rm-rfield-half">',
            '<label class="rm-rlabel">Precio regular</label>',
            '<input type="text" id="rm-field-regular" class="rm-rinput" value="' + escHtml(p.regular_price || '') + '" />',
            '<span class="rm-autosave-indicator" id="rm-save-regular"></span>',
            '</div>',
            '<div class="rm-rfield-half">',
            '<label class="rm-rlabel">Precio oferta</label>',
            '<input type="text" id="rm-field-sale" class="rm-rinput" value="' + escHtml(p.sale_price || '') + '" />',
            '<span class="rm-autosave-indicator" id="rm-save-sale"></span>',
            '</div>',
            '</div>',
            // Alibaba
            '<div class="rm-rfield rm-prices-row">',
            '<div class="rm-rfield-half">',
            '<label class="rm-rlabel">🔗 URL Alibaba</label>',
            '<input type="text" id="rm-field-alibaba-url" class="rm-rinput" value="' + escHtml(p.url_alibaba || '') + '" placeholder="https://alibaba.com/..." />',
            '<span class="rm-autosave-indicator" id="rm-save-alibaba-url"></span>',
            '</div>',
            '<div class="rm-rfield-half">',
            '<label class="rm-rlabel">💰 Precio Alibaba</label>',
            '<input type="text" id="rm-field-alibaba-price" class="rm-rinput" value="' + escHtml(p.alibaba_price || '') + '" placeholder="0.00" />',
            '<span class="rm-autosave-indicator" id="rm-save-alibaba-price"></span>',
            '</div>',
            '</div>',
            // Producto correcto
            '<div class="rm-rfield">',
            '<label class="rm-rlabel">✅ Producto Correcto <span class="rm-field-hint">(URL o texto)</span></label>',
            '<input type="text" id="rm-field-producto-correcto" class="rm-rinput" value="' + escHtml(p.producto_correcto || '') + '" placeholder="URL o descripción del producto correcto" />',
            '<span class="rm-autosave-indicator" id="rm-save-producto-correcto"></span>',
            '</div>',
            // Peso y Dimensiones
            '<div class="rm-rfield rm-dims-row">',
            '<div class="rm-rfield-third">',
            '<label class="rm-rlabel">Peso (kg)</label>',
            '<input type="text" id="rm-field-weight" class="rm-rinput" value="' + escHtml(p.weight || '') + '" placeholder="0.00" />',
            '<span class="rm-autosave-indicator" id="rm-save-weight"></span>',
            '</div>',
            '<div class="rm-rfield-third">',
            '<label class="rm-rlabel">Largo × Ancho × Alto (cm)</label>',
            '<div style="display:flex;gap:4px;">',
            '<input type="text" id="rm-field-length" class="rm-rinput" value="' + escHtml(p.length || '') + '" placeholder="L" style="min-width:0" />',
            '<input type="text" id="rm-field-width"  class="rm-rinput" value="' + escHtml(p.width  || '') + '" placeholder="A" style="min-width:0" />',
            '<input type="text" id="rm-field-height" class="rm-rinput" value="' + escHtml(p.height || '') + '" placeholder="H" style="min-width:0" />',
            '</div>',
            '<span class="rm-autosave-indicator" id="rm-save-dims"></span>',
            '</div>',
            '</div>',
            // Atributos
            '<div class="rm-rfield">',
            '<label class="rm-rlabel">Atributos</label>',
            attrsHtml,
            '</div>',
            // Categorías (editable con búsqueda)
            '<div class="rm-rfield">',
            '<label class="rm-rlabel">Categorías <span class="rm-autosave-indicator" id="rm-save-cats"></span></label>',
            '<div id="rm-cats-selected" class="rm-cats-selected">' + buildCategoryTags(p.category_ids || [], p.categories) + '</div>',
            '<div class="rm-cats-search-wrap">',
            '<input type="text" id="rm-cats-search" class="rm-rinput" placeholder="Buscar categoría..." autocomplete="off" />',
            '<div id="rm-cats-dropdown" class="rm-cats-dropdown" style="display:none;"></div>',
            '</div>',
            '</div>',
            '</div>',
        ].join(''));

        $('#rm-panel-id').text('ID: ' + p.id);
        $('#rm-panel-sku').text('SKU: ' + (p.sku || '—'));
        $('#rm-btn-editar-wc').attr('href', p.edit_url || '#');
        renderModalChecklist(p.checks);
        $('#rm-field-comment').val(p.comentario || '');
        updateModalScore(p.checks);
        updateModalNav();
        $('#rm-review-right .rm-rpanel').css('opacity', '1');

        // Direct-bind gallery add — avoids delegation/propagation issues
        var galleryPid = p.id;
        $('#rm-gallery-add').off('click').on('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            if (typeof wp === 'undefined' || !wp.media) {
                showToast('Media library no disponible', 'error');
                return;
            }
            var frame = wp.media({
                title:    'Seleccionar imágenes para galería',
                button:   { text: 'Agregar a galería' },
                multiple: true,
            });
            frame.on('open', function () {
                $('.media-modal').css('z-index', '1100001');
                $('.media-modal-backdrop').css('z-index', '1099999');
            });
            frame.on('select', function () {
                var attachments = frame.state().get('selection').toJSON();
                if (!attachments.length) return;

                // FIX: send ALL attachment IDs in a single request to avoid race condition
                // (parallel requests would each read stale gallery, overwriting each other)
                var attIds = attachments.map(function (att) { return att.id; });
                fetch(REST + 'product/' + galleryPid + '/gallery', {
                    method: 'POST', headers: restHeaders(),
                    body: JSON.stringify({ action: 'add', attachment_ids: attIds }),
                })
                .then(function (r) { return r.json(); })
                .then(function (res) {
                    if (res.success && res.added && res.added.length) {
                        res.added.forEach(function (img) {
                            $('#rm-gallery-add').before(
                                '<div class="rm-gallery-item">' +
                                '<img src="' + escHtml(img.url) + '" class="rm-gallery-thumb" data-src="' + escHtml(img.url) + '" alt="" />' +
                                '<button class="rm-gallery-del" data-id="' + img.id + '" title="Eliminar">×</button>' +
                                '</div>'
                            );
                        });
                        showToast('✅ ' + res.added.length + ' imagen(es) agregada(s) a la galería', 'success');
                    } else if (res.error) {
                        showToast('❌ ' + res.error, 'error');
                    }
                })
                .catch(function () { showToast('Error al agregar imágenes', 'error'); });
            });
            frame.open();
        });

        // Direct-bind attribute delete — avoids delegation/propagation issues
        var attrPid = p.id;
        $('#rm-review-left').off('click.attrdel').on('click.attrdel', '.rm-attr-del', function (e) {
            e.stopPropagation();
            e.preventDefault();
            $(this).closest('.rm-attr-row').remove();
            var attrs = [];
            $('#rm-attrs-list .rm-attr-row').each(function () {
                var $r    = $(this);
                var isTax = $r.hasClass('rm-attr-taxonomy');
                var obj   = { name: $r.data('name'), is_taxonomy: isTax };
                if (isTax) { obj.taxonomy = $r.data('taxonomy'); }
                else        { obj.value = $r.find('.rm-attr-value-input').val() || ''; }
                attrs.push(obj);
            });
            fetch(REST + 'product/' + attrPid + '/update', {
                method: 'POST', headers: restHeaders(),
                body: JSON.stringify({ attributes: attrs }),
            })
            .then(function (r) { return r.json(); })
            .then(function (res) {
                if (res.success) showToast('Atributo eliminado', 'success');
                else showToast(res.error || 'Error', 'error');
            })
            .catch(function () { showToast('Error de conexión', 'error'); });
        });
    }

    /* ================================================================
       CHECKLIST — 7 items in display order
    ================================================================= */
    var checklistDef = [
        { field: 'revision_producto_ok',     label: 'Es El Producto' },
        { field: 'revision_imagenes_ok',     label: 'Imágenes'       },
        { field: 'revision_titulo_ok',       label: 'Título'         },
        { field: 'revision_descripcion_ok',  label: 'Descripción'    },
        { field: 'revision_precio_ok',       label: 'Precio'         },
        { field: 'revision_peso_ok',         label: 'Peso'           },
        { field: 'revision_dimensiones_ok',  label: 'Dimensiones'    },
        { field: 'revision_atributos_ok',    label: 'Atributos'      },
        { field: 'revision_categoria_ok',    label: 'Categoría'      },
    ];

    function renderModalChecklist(checks) {
        var html = checklistDef.map(function (item) {
            var key = item.field.replace('revision_', '').replace('_ok', '');
            var val = (checks && checks[key]) ? checks[key] : '';
            return buildCheckItemHtml(item.field, item.label, val);
        }).join('');
        $('#rm-checklist').html(html);
    }

    function buildCheckItemHtml(field, label, val) {
        var bCls = val === 'si' ? 'badge-ok' : val === 'no' ? 'badge-no' : val === 'na' ? 'badge-na' : '';
        var bLbl = val === 'si' ? 'OK'       : val === 'no' ? 'NO'      : val === 'na' ? 'N/A'      : '—';
        return '<div class="rm-check-item" data-field="' + field + '">' +
            '<span class="rm-check-label">' + escHtml(label) + '</span>' +
            '<div class="rm-check-btns">' +
            '<button class="rm-cbtn' + (val === 'si' ? ' active-ok' : '') + '" data-val="si">OK</button>' +
            '<button class="rm-cbtn' + (val === 'no' ? ' active-no' : '') + '" data-val="no">No</button>' +
            '<button class="rm-cbtn' + (val === 'na' ? ' active-na' : '') + '" data-val="na">N/A</button>' +
            '</div>' +
            '<span class="rm-check-badge ' + bCls + '">' + bLbl + '</span>' +
            '</div>';
    }

    function updateModalScore(checks) {
        if (!checks) return;
        var okCount = Object.values(checks).filter(function (v) { return v === 'si'; }).length;
        var pct     = Math.round((okCount / checklistDef.length) * 100);
        $('#rm-score-bar').css('width', pct + '%').toggleClass('full', pct === 100);
        $('#rm-score-pct').text(pct + '%');
    }

    /* ================================================================
       NAVIGATION
    ================================================================= */
    function updateModalNav() {
        $('#rm-rnav-pos').text((modal.index + 1) + ' / ' + modal.ids.length);
        $('#rm-nav-prev').prop('disabled', modal.index <= 0);
        $('#rm-nav-next').prop('disabled', modal.index >= modal.ids.length - 1);
    }

    function navigateModal(dir) {
        var next = modal.index + dir;
        if (next < 0 || next >= modal.ids.length) return;
        modal.index = next;
        fetchAndShowProduct(modal.ids[next]);
        updateModalNav();
    }

    /* ================================================================
       SAVE HELPERS
    ================================================================= */
    function saveChecklistItem(pid, field, val) {
        var payload = {};
        payload[field] = val;
        fetch(REST + 'product/' + pid + '/checklist', {
            method: 'POST', headers: restHeaders(), body: JSON.stringify(payload),
        }).catch(function () { showToast('Error al guardar', 'error'); });
    }

    /* ================================================================
       APROBAR / RECHAZAR
    ================================================================= */
    function doProductAction(pid, action) {
        var $btnA = $('#rm-btn-aprobar'), $btnR = $('#rm-btn-rechazar');
        $btnA.prop('disabled', true);
        $btnR.prop('disabled', true);

        var checkPayload = {};
        $('#rm-checklist .rm-check-item').each(function () {
            var field   = $(this).data('field');
            var $active = $(this).find('.rm-cbtn.active-ok, .rm-cbtn.active-no, .rm-cbtn.active-na');
            if ($active.length) checkPayload[field] = $active.data('val');
        });
        checkPayload['comentario_revision'] = $('#rm-field-comment').val();

        fetch(REST + 'product/' + pid + '/action', {
            method: 'POST', headers: restHeaders(),
            body: JSON.stringify({ action: action, checklist: checkPayload }),
        })
        .then(function (r) { return r.json(); })
        .then(function (res) {
            if (res.success) {
                var label = action === 'aprobar' ? '✅ Aprobado' : '❌ Rechazado';
                showToast(label + ' — ID ' + pid, action === 'aprobar' ? 'success' : 'error');
                loadProducts();
                loadStats();
                if (modal.index < modal.ids.length - 1) {
                    navigateModal(1);
                } else {
                    closeReviewModal();
                }
            } else {
                showToast(res.error || 'Error al procesar', 'error');
            }
        })
        .catch(function () { showToast('Error de conexión', 'error'); })
        .finally(function () {
            $btnA.prop('disabled', false);
            $btnR.prop('disabled', false);
        });
    }

    /* ================================================================
       KEYBOARD SHORTCUTS
    ================================================================= */
    function bindKeyboard() {
        $(document).on('keydown.rmmodal', function (e) {
            if (!modal.open) return;
            var tag     = e.target.tagName.toLowerCase();
            var inInput = tag === 'input' || tag === 'textarea' || tag === 'select';

            if (e.key === 'Escape') {
                closeReviewModal();
            } else if (e.key === 'ArrowLeft' && !inInput) {
                e.preventDefault(); navigateModal(-1);
            } else if (e.key === 'ArrowRight' && !inInput) {
                e.preventDefault(); navigateModal(1);
            } else if ((e.key === 'a' || e.key === 'A') && !inInput && modal.product) {
                doProductAction(modal.product.id, 'aprobar');
            } else if ((e.key === 'r' || e.key === 'R') && !inInput && modal.product) {
                doProductAction(modal.product.id, 'rechazar');
            }
        });
    }

})(jQuery);
