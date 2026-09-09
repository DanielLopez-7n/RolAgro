/* ==========================================================
   RolAgro — Panel de administración
   Gestiona productos y categorías y consulta los pedidos
   recibidos. Todas las llamadas van a /admin/api/*, protegido
   con autenticación básica (ver src/middlewares/basicAuth.js).
   ========================================================== */

(function () {
  "use strict";

  const API = "/admin/api";

  /** Categorías en memoria para no repedirlas al abrir el modal de producto. */
  let categories = [];

  // Estado de la tabla de productos: paginada porque el catálogo puede
  // tener miles de filas después de importar el ERP (ver
  // inventoryImport.service.js). No se guarda "todos los productos" en
  // memoria en ningún lado — cada acción (editar, buscar en el modal de
  // lotes) pide el dato fresco al servidor en vez de buscarlo en un array
  // que puede no tener esa página cargada.
  let productsPage = 1;
  let productsSearch = "";
  let productsPublishedFilter = "";
  let productsSearchDebounce = null;

  // --- Referencias DOM ---
  const feedbackEl = document.getElementById("admin-feedback");
  const productsTbody = document.getElementById("products-tbody");
  const productsSearchEl = document.getElementById("products-search");
  const productsFilterPublishedEl = document.getElementById("products-filter-published");
  const productsCountEl = document.getElementById("products-count");
  const productsPrevBtn = document.getElementById("products-prev");
  const productsNextBtn = document.getElementById("products-next");
  const productsPageLabelEl = document.getElementById("products-page-label");
  const categoriesListEl = document.getElementById("categories-list");
  const ordersTbody = document.getElementById("orders-tbody");

  const productModal = new bootstrap.Modal(document.getElementById("productModal"));
  const productModalLabel = document.getElementById("productModalLabel");
  const productForm = document.getElementById("product-form");
  const productIdEl = document.getElementById("product-id");
  const productNameEl = document.getElementById("product-name");
  const productPriceEl = document.getElementById("product-price");
  const productCategoryEl = document.getElementById("product-category");
  const productImageEl = document.getElementById("product-image");
  const productDescriptionEl = document.getElementById("product-description");
  const productPreviewEl = document.getElementById("product-image-preview");
  const productPreviewEmptyEl = document.getElementById("product-image-empty");
  const productSubmitBtn = document.getElementById("product-submit");
  const productFeedbackEl = document.getElementById("product-feedback");

  const categoryModal = new bootstrap.Modal(document.getElementById("categoryModal"));
  const categoryForm = document.getElementById("category-form");
  const categoryNameEl = document.getElementById("category-name");
  const categoryFeedbackEl = document.getElementById("category-feedback");

  const importModal = new bootstrap.Modal(document.getElementById("importModal"));
  const importForm = document.getElementById("import-form");
  const importFileEl = document.getElementById("import-file");
  const importFeedbackEl = document.getElementById("import-feedback");
  const importResultEl = document.getElementById("import-result");
  const importSubmitBtn = document.getElementById("import-submit");

  const batchesTbody = document.getElementById("batches-tbody");
  const batchModal = new bootstrap.Modal(document.getElementById("batchModal"));
  const batchForm = document.getElementById("batch-form");
  const batchProductEl = document.getElementById("batch-product");
  const batchProductOptionsEl = document.getElementById("batch-product-options");
  const batchQtyEl = document.getElementById("batch-qty");
  const batchDateEl = document.getElementById("batch-date");
  const batchSubmitBtn = document.getElementById("batch-submit");
  const batchFeedbackEl = document.getElementById("batch-feedback");

  const formatCOP = (value) =>
    "$" + Number(value).toLocaleString("es-CO", { maximumFractionDigits: 0 });

  /**
   * Escapa caracteres con significado en HTML.
   * Misma lógica que en public/js/main.js: aquí los datos también vienen de la
   * base y se pintan con innerHTML, así que un nombre con comillas o etiquetas
   * no debe romper (ni inyectar nada en) la tabla.
   */
  const escapeHtml = (value) =>
    String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");

  const formatDate = (value) =>
    new Date(value).toLocaleString("es-CO", {
      dateStyle: "short",
      timeStyle: "short",
    });

  function showFeedback(message, type) {
    feedbackEl.textContent = message;
    feedbackEl.className = `alert alert-${type}`;
    feedbackEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function hideFeedback() {
    feedbackEl.className = "alert d-none";
  }

  /**
   * Envoltura de fetch para la API del panel: parsea el JSON y convierte
   * cualquier respuesta de error en una excepción con el mensaje del servidor,
   * para que cada llamada solo tenga que ocuparse del caso feliz.
   */
  async function apiFetch(path, options = {}) {
    const res = await fetch(API + path, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });

    let data = null;
    try {
      data = await res.json();
    } catch (err) {
      // Respuesta sin JSON (ej. un 401 servido como HTML por el navegador).
      data = null;
    }

    if (!res.ok) {
      throw new Error((data && data.error) || `Error ${res.status}`);
    }
    return data;
  }

  // ==========================================================
  // Categorías
  // ==========================================================

  async function loadCategories() {
    categories = await apiFetch("/categories");

    productCategoryEl.innerHTML = categories
      .map((cat) => `<option value="${Number(cat.id)}">${escapeHtml(cat.name)}</option>`)
      .join("");

    categoriesListEl.innerHTML = categories.length
      ? categories
          .map(
            (cat) => `
            <span class="badge bg-light text-dark border d-flex align-items-center gap-2 py-2">
              ${escapeHtml(cat.name)}
              <button
                class="btn-close btn-close-sm category-delete"
                style="font-size: 0.6rem;"
                data-id="${Number(cat.id)}"
                data-name="${escapeHtml(cat.name)}"
                title="Eliminar categoría"
                aria-label="Eliminar categoría ${escapeHtml(cat.name)}"
              ></button>
            </span>`
          )
          .join("")
      : '<span class="text-muted small">Todavía no hay categorías.</span>';
  }

  categoriesListEl.addEventListener("click", async (event) => {
    const button = event.target.closest(".category-delete");
    if (!button) return;

    const name = button.dataset.name;
    if (!confirm(`¿Eliminar la categoría "${name}"?`)) return;

    try {
      await apiFetch(`/categories/${button.dataset.id}`, { method: "DELETE" });
      await loadCategories();
      showFeedback(`Categoría "${name}" eliminada.`, "success");
    } catch (err) {
      // El caso típico es 409: la categoría todavía tiene productos.
      showFeedback(err.message, "danger");
    }
  });

  document.getElementById("btn-nueva-categoria").addEventListener("click", () => {
    categoryForm.reset();
    categoryFeedbackEl.className = "alert d-none";
    categoryModal.show();
  });

  categoryForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      await apiFetch("/categories", {
        method: "POST",
        body: JSON.stringify({ name: categoryNameEl.value.trim() }),
      });
      categoryModal.hide();
      await loadCategories();
      showFeedback("Categoría creada.", "success");
    } catch (err) {
      categoryFeedbackEl.textContent = err.message;
      categoryFeedbackEl.className = "alert alert-danger mt-3";
    }
  });

  // ==========================================================
  // Productos
  // ==========================================================

  async function loadProducts() {
    const params = new URLSearchParams({ page: productsPage });
    if (productsSearch) params.set("search", productsSearch);
    if (productsPublishedFilter) params.set("published", productsPublishedFilter);

    try {
      const { items, total, page, totalPages } = await apiFetch(`/products?${params}`);

      if (items.length === 0) {
        productsTbody.innerHTML = `
          <tr>
            <td colspan="6" class="text-center text-muted py-4">
              ${
                productsSearch || productsPublishedFilter
                  ? "Ningún producto coincide con el filtro."
                  : 'Todavía no hay productos. Crea el primero con "Nuevo producto".'
              }
            </td>
          </tr>`;
      } else {
        productsTbody.innerHTML = items.map(renderProductRow).join("");
      }

      productsPage = page;
      productsCountEl.textContent =
        total === 0 ? "" : `${total} producto${total === 1 ? "" : "s"} en total`;
      productsPageLabelEl.textContent = `Página ${page} de ${totalPages}`;
      productsPrevBtn.closest(".page-item").classList.toggle("disabled", page <= 1);
      productsNextBtn.closest(".page-item").classList.toggle("disabled", page >= totalPages);
    } catch (err) {
      productsTbody.innerHTML = `
        <tr><td colspan="6" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  productsSearchEl.addEventListener("input", () => {
    // Debounce: no se pide una página nueva en cada letra, se espera una
    // pausa corta en el tipeo.
    clearTimeout(productsSearchDebounce);
    productsSearchDebounce = setTimeout(() => {
      productsSearch = productsSearchEl.value.trim();
      productsPage = 1;
      loadProducts();
    }, 300);
  });

  productsFilterPublishedEl.addEventListener("change", () => {
    productsPublishedFilter = productsFilterPublishedEl.value;
    productsPage = 1;
    loadProducts();
  });

  productsPrevBtn.addEventListener("click", () => {
    if (productsPage <= 1) return;
    productsPage -= 1;
    loadProducts();
  });

  productsNextBtn.addEventListener("click", () => {
    productsPage += 1;
    loadProducts();
  });

  function renderProductRow(product) {
    const image = product.image_url
      ? `<img src="${escapeHtml(product.image_url)}" alt="" class="rounded" style="width:56px;height:56px;object-fit:cover;" />`
      : '<span class="text-muted small">—</span>';

    // published llega de MySQL como 0/1 (TINYINT). Los borradores de la
    // importación del ERP nacen así: sin precio ni categoría reales, y por
    // eso invisibles en /api/products (ver products.service.js findAll).
    const isDraft = !product.published;
    const draftBadge = isDraft
      ? '<span class="badge bg-warning-subtle text-warning-emphasis border border-warning-subtle ms-2">Borrador</span>'
      : "";

    return `
      <tr class="${isDraft ? "table-warning" : ""}">
        <td>${image}</td>
        <td>
          <div class="fw-semibold">${escapeHtml(product.name)}${draftBadge}</div>
          <div class="text-muted small">${escapeHtml(product.description || "")}</div>
        </td>
        <td><span class="badge bg-success-subtle text-success-emphasis">${escapeHtml(product.category_name)}</span></td>
        <td>${
          product.marca_name
            ? `<span class="badge bg-secondary-subtle text-secondary-emphasis">${escapeHtml(product.marca_name)}</span>`
            : '<span class="text-muted small">—</span>'
        }</td>
        <td class="text-end fw-semibold">${formatCOP(product.price)}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary product-edit" data-id="${Number(product.id)}" title="Editar">
            <i class="bi bi-pencil"></i>
          </button>
          <button
            class="btn btn-sm ${isDraft ? "btn-outline-success" : "btn-outline-secondary"} product-toggle-publish"
            data-id="${Number(product.id)}"
            data-published="${isDraft ? "1" : "0"}"
            title="${isDraft ? "Publicar en el sitio" : "Ocultar del sitio"}"
          >
            <i class="bi ${isDraft ? "bi-eye" : "bi-eye-slash"}"></i>
          </button>
          <button class="btn btn-sm btn-outline-danger product-delete" data-id="${Number(product.id)}" data-name="${escapeHtml(product.name)}" title="Eliminar">
            <i class="bi bi-trash"></i>
          </button>
        </td>
      </tr>`;
  }

  // Delegación: la tabla se redibuja entera tras cada cambio.
  productsTbody.addEventListener("click", async (event) => {
    const editBtn = event.target.closest(".product-edit");
    if (editBtn) {
      openProductModal(Number(editBtn.dataset.id));
      return;
    }

    const toggleBtn = event.target.closest(".product-toggle-publish");
    if (toggleBtn) {
      const publish = toggleBtn.dataset.published === "1";
      try {
        await apiFetch(`/products/${toggleBtn.dataset.id}/publish`, {
          method: "PATCH",
          body: JSON.stringify({ published: publish }),
        });
        await loadProducts();
        showFeedback(
          publish ? "Producto publicado: ya se ve en el sitio." : "Producto ocultado del sitio.",
          "success"
        );
      } catch (err) {
        showFeedback(err.message, "danger");
      }
      return;
    }

    const deleteBtn = event.target.closest(".product-delete");
    if (!deleteBtn) return;

    const name = deleteBtn.dataset.name;
    if (!confirm(`¿Eliminar el producto "${name}"? Esta acción no se puede deshacer.`)) {
      return;
    }

    try {
      await apiFetch(`/products/${deleteBtn.dataset.id}`, { method: "DELETE" });
      await loadProducts();
      showFeedback(
        `Producto "${name}" eliminado. Los pedidos que lo incluían conservan su detalle.`,
        "success"
      );
    } catch (err) {
      showFeedback(err.message, "danger");
    }
  });

  /** Abre el modal vacío (alta) o con los datos del producto (edición). */
  async function openProductModal(id) {
    productForm.reset();
    productFeedbackEl.className = "alert d-none";
    updateImagePreview();

    if (!categories.length) {
      try {
        await loadCategories();
      } catch (err) {
        showFeedback("No se pudieron cargar las categorías: " + err.message, "danger");
        return;
      }
    }

    if (categories.length === 0) {
      showFeedback("Crea al menos una categoría antes de cargar productos.", "warning");
      return;
    }

    if (id) {
      // Se pide el producto directo al servidor: con la tabla paginada, el
      // que se quiere editar (ej. desde "Cargar precio" en el resultado de
      // la importación) puede no estar en la página que está visible ahora.
      let product;
      try {
        product = await apiFetch(`/products/${id}`);
      } catch (err) {
        showFeedback("Ese producto ya no existe.", "warning");
        await loadProducts();
        return;
      }

      productModalLabel.textContent = "Editar producto";
      productIdEl.value = product.id;
      productNameEl.value = product.name;
      productPriceEl.value = product.price;
      productCategoryEl.value = product.category_id;
      productImageEl.value = product.image_url || "";
      productDescriptionEl.value = product.description || "";
      updateImagePreview();

      if (!product.published) {
        productFeedbackEl.textContent =
          "Este producto es un borrador de la importación: no se ve en el sitio. " +
          "Guardá el precio y la categoría reales, y después publicalo con el botón del ojo en la tabla.";
        productFeedbackEl.className = "alert alert-warning mt-3";
      }
    } else {
      productModalLabel.textContent = "Nuevo producto";
      productIdEl.value = "";
    }

    productModal.show();
  }

  document.getElementById("btn-nuevo-producto").addEventListener("click", () => {
    openProductModal(null);
  });

  function updateImagePreview() {
    const url = productImageEl.value.trim();
    if (url) {
      productPreviewEl.src = url;
      productPreviewEl.classList.remove("d-none");
      productPreviewEmptyEl.classList.add("d-none");
    } else {
      productPreviewEl.classList.add("d-none");
      productPreviewEmptyEl.classList.remove("d-none");
    }
  }

  productImageEl.addEventListener("input", updateImagePreview);

  // Si la URL no carga, se avisa en vez de dejar el icono de imagen rota.
  productPreviewEl.addEventListener("error", () => {
    productPreviewEl.classList.add("d-none");
    productPreviewEmptyEl.textContent = "No se pudo cargar esa imagen. Revisa la URL.";
    productPreviewEmptyEl.classList.remove("d-none");
  });

  productPreviewEl.addEventListener("load", () => {
    productPreviewEmptyEl.textContent = "Escribe una URL para ver la imagen aquí.";
  });

  productForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const id = productIdEl.value;
    const payload = {
      name: productNameEl.value.trim(),
      price: productPriceEl.value,
      category_id: productCategoryEl.value,
      image_url: productImageEl.value.trim(),
      description: productDescriptionEl.value.trim(),
    };

    productSubmitBtn.disabled = true;
    productSubmitBtn.textContent = "Guardando…";

    try {
      await apiFetch(id ? `/products/${id}` : "/products", {
        method: id ? "PUT" : "POST",
        body: JSON.stringify(payload),
      });

      productModal.hide();
      await loadProducts();
      showFeedback(id ? "Producto actualizado." : "Producto creado.", "success");
    } catch (err) {
      productFeedbackEl.textContent = err.message;
      productFeedbackEl.className = "alert alert-danger mt-3";
    } finally {
      productSubmitBtn.disabled = false;
      productSubmitBtn.textContent = "Guardar";
    }
  });

  // ==========================================================
  // Pedidos
  // ==========================================================

  async function loadOrders() {
    ordersTbody.innerHTML =
      '<tr><td colspan="6" class="text-center text-muted py-4">Cargando…</td></tr>';

    try {
      const orders = await apiFetch("/orders");

      if (orders.length === 0) {
        ordersTbody.innerHTML =
          '<tr><td colspan="6" class="text-center text-muted py-4">Todavía no hay pedidos.</td></tr>';
        return;
      }

      ordersTbody.innerHTML = orders.map(renderOrderRows).join("");
    } catch (err) {
      ordersTbody.innerHTML = `
        <tr><td colspan="6" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  /** Devuelve la fila del pedido más su fila de detalle (colapsada). */
  function renderOrderRows(order) {
    const emailBadge =
      order.email_status === "enviado"
        ? '<span class="badge bg-success-subtle text-success-emphasis">Enviado</span>'
        : '<span class="badge bg-danger-subtle text-danger-emphasis" title="El pedido se guardó, pero el correo no salió">Fallido</span>';

    const items = order.items
      .map(
        (item) => `
          <tr>
            <td>${escapeHtml(item.product_name)}</td>
            <td class="text-center">${Number(item.qty)}</td>
            <td class="text-end">${formatCOP(item.unit_price)}</td>
            <td class="text-end">${formatCOP(item.subtotal)}</td>
          </tr>`
      )
      .join("");

    return `
      <tr class="order-row" role="button" data-bs-toggle="collapse" data-bs-target="#order-detail-${Number(order.id)}">
        <td class="fw-semibold">#${Number(order.id)}</td>
        <td>${escapeHtml(order.customer_name)}</td>
        <td>${escapeHtml(order.customer_phone)}</td>
        <td class="small text-muted">${formatDate(order.created_at)}</td>
        <td>${emailBadge}</td>
        <td class="text-end fw-semibold">${formatCOP(order.total)}</td>
      </tr>
      <tr class="collapse" id="order-detail-${Number(order.id)}">
        <td colspan="6" class="bg-light">
          <table class="table table-sm mb-0">
            <thead>
              <tr class="text-muted small">
                <th>Producto</th>
                <th class="text-center">Cant.</th>
                <th class="text-end">Precio</th>
                <th class="text-end">Subtotal</th>
              </tr>
            </thead>
            <tbody>${items}</tbody>
          </table>
        </td>
      </tr>`;
  }

  // ==========================================================
  // Vencimientos: lotes con fecha de vencimiento
  // ==========================================================

  const TIER_LABELS = {
    vencido: "Vencido",
    critico: "Crítico",
    urgente: "Urgente",
    proximo: "Próximo",
    con_tiempo: "Con tiempo",
  };
  const TIER_BADGE_CLASS = {
    vencido: "bg-danger",
    critico: "bg-danger",
    urgente: "bg-warning text-dark",
    proximo: "bg-primary",
    con_tiempo: "bg-success",
  };

  let batches = [];
  let activeBatchTier = "";

  function formatDateOnly(value) {
    // expiration_date llega como "AAAA-MM-DD" (ver batches.service.js):
    // se arma la fecha a mano para no reinterpretarla en la zona horaria
    // del navegador (new Date("2026-08-15") la toma como UTC medianoche,
    // que en un huso horario negativo puede mostrar el día anterior).
    const [y, m, d] = value.split("-");
    return `${d}/${m}/${y}`;
  }

  function updateBatchStats(rows) {
    const counts = { vencido: 0, critico: 0, urgente: 0, proximo: 0, con_tiempo: 0 };
    rows.forEach((b) => {
      if (counts[b.tier] !== undefined) counts[b.tier]++;
    });
    document.getElementById("batch-stat-vencido").textContent = counts.vencido;
    document.getElementById("batch-stat-critico").textContent = counts.critico;
    document.getElementById("batch-stat-urgente").textContent = counts.urgente;
    document.getElementById("batch-stat-proximo").textContent = counts.proximo;
  }

  function renderBatches() {
    updateBatchStats(batches);

    const filtered = activeBatchTier
      ? batches.filter((b) => b.tier === activeBatchTier)
      : batches;

    if (filtered.length === 0) {
      batchesTbody.innerHTML = `
        <tr><td colspan="7" class="text-center text-muted py-4">
          ${batches.length === 0 ? "Todavía no hay lotes cargados." : "Ningún lote en este filtro."}
        </td></tr>`;
      return;
    }

    batchesTbody.innerHTML = filtered
      .map(
        (b) => `
        <tr>
          <td>
            <div class="fw-semibold">${escapeHtml(b.product_name)}</div>
            <div class="text-muted small font-monospace">${escapeHtml(b.product_sku || "—")}</div>
          </td>
          <td>${b.marca_name ? escapeHtml(b.marca_name) : '<span class="text-muted small">—</span>'}</td>
          <td class="text-end font-monospace">${Number(b.qty)}</td>
          <td>${formatDateOnly(b.expiration_date)}</td>
          <td class="text-end font-monospace ${b.days < 0 ? "text-danger fw-bold" : ""}">${Number(b.days)}</td>
          <td><span class="badge ${TIER_BADGE_CLASS[b.tier] || "bg-secondary"}">${TIER_LABELS[b.tier] || b.tier}</span></td>
          <td class="text-end">
            <button class="btn btn-sm btn-outline-danger batch-delete" data-id="${Number(b.id)}" title="Eliminar lote">
              <i class="bi bi-trash"></i>
            </button>
          </td>
        </tr>`
      )
      .join("");
  }

  async function loadBatches() {
    batchesTbody.innerHTML =
      '<tr><td colspan="7" class="text-center text-muted py-4">Cargando…</td></tr>';
    try {
      batches = await apiFetch("/batches");
      renderBatches();
    } catch (err) {
      batchesTbody.innerHTML = `
        <tr><td colspan="7" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  document.getElementById("batch-filter-chips").addEventListener("click", (event) => {
    const btn = event.target.closest(".batch-filter-btn");
    if (!btn) return;

    // Bootstrap ya se encarga de rellenar el color de un btn-outline-* con
    // la clase "active"; no hace falta tocar más clases que esa.
    document.querySelectorAll(".batch-filter-btn").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");

    activeBatchTier = btn.dataset.tier;
    renderBatches();
  });

  batchesTbody.addEventListener("click", async (event) => {
    const btn = event.target.closest(".batch-delete");
    if (!btn) return;
    if (!confirm("¿Eliminar este lote?")) return;

    try {
      await apiFetch(`/batches/${btn.dataset.id}`, { method: "DELETE" });
      await loadBatches();
      showFeedback("Lote eliminado.", "success");
    } catch (err) {
      showFeedback(err.message, "danger");
    }
  });

  // Los lotes se piden al abrir la pestaña por primera vez, igual que los
  // pedidos: no hace falta esa consulta para quien solo edita el catálogo.
  let batchesLoaded = false;
  document.getElementById("tab-vencimientos-btn").addEventListener("shown.bs.tab", () => {
    if (batchesLoaded) return;
    batchesLoaded = true;
    loadBatches();
  });

  document.getElementById("btn-nuevo-lote").addEventListener("click", () => {
    batchForm.reset();
    batchFeedbackEl.className = "alert d-none";
    batchProductOptionsEl.innerHTML = "";
    batchModal.show();
  });

  /**
   * Búsqueda en vivo del producto para el lote: el catálogo puede tener
   * miles de filas, así que no se precarga nada — cada tecla (con
   * debounce) pide al servidor los productos que coinciden por nombre o
   * sku y los ofrece en el <datalist>.
   */
  let batchProductSearchDebounce = null;
  batchProductEl.addEventListener("input", () => {
    clearTimeout(batchProductSearchDebounce);
    const query = batchProductEl.value.trim();
    if (query.length < 2) {
      batchProductOptionsEl.innerHTML = "";
      return;
    }

    batchProductSearchDebounce = setTimeout(async () => {
      try {
        const results = await apiFetch(`/products/search?q=${encodeURIComponent(query)}`);
        batchProductOptionsEl.innerHTML = results
          .map(
            (p) =>
              `<option value="${escapeHtml(p.name)} (${escapeHtml(p.sku || "s/sku")})" data-id="${Number(p.id)}"></option>`
          )
          .join("");
      } catch (err) {
        // La búsqueda es un detalle del formulario: si falla, no interrumpe
        // el modal, simplemente no aparecen sugerencias.
        console.warn("No se pudo buscar el producto:", err.message);
      }
    }, 250);
  });

  batchForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    // El input de texto guarda "Nombre (sku)"; se busca en el datalist la
    // opción cuyo texto coincide exactamente, para recuperar el id real.
    const typed = batchProductEl.value;
    const option = Array.from(batchProductOptionsEl.options).find((o) => o.value === typed);

    if (!option) {
      batchFeedbackEl.textContent = "Elegí un producto de la lista (no un texto libre).";
      batchFeedbackEl.className = "alert alert-warning mt-3";
      return;
    }

    batchSubmitBtn.disabled = true;
    batchSubmitBtn.textContent = "Guardando…";

    try {
      await apiFetch("/batches", {
        method: "POST",
        body: JSON.stringify({
          product_id: Number(option.dataset.id),
          qty: batchQtyEl.value,
          expiration_date: batchDateEl.value,
        }),
      });

      batchModal.hide();
      await loadBatches();
      showFeedback("Lote guardado.", "success");
    } catch (err) {
      batchFeedbackEl.textContent = err.message;
      batchFeedbackEl.className = "alert alert-danger mt-3";
    } finally {
      batchSubmitBtn.disabled = false;
      batchSubmitBtn.textContent = "Guardar";
    }
  });

  // Los pedidos se piden al abrir la pestaña por primera vez, no al cargar la
  // página: quien entra a editar el catálogo no necesita esa consulta.
  let ordersLoaded = false;
  document.getElementById("tab-pedidos-btn").addEventListener("shown.bs.tab", () => {
    if (ordersLoaded) return;
    ordersLoaded = true;
    loadOrders();
  });

  document.getElementById("btn-recargar-pedidos").addEventListener("click", loadOrders);

  // ==========================================================
  // Importar inventario (marcas) desde el Excel del ERP
  // ==========================================================

  document.getElementById("btn-importar-erp").addEventListener("click", () => {
    importForm.reset();
    importFeedbackEl.className = "alert d-none";
    importResultEl.classList.add("d-none");
    importModal.show();
  });

  function renderImportResult(result) {
    document.getElementById("import-stat-total").textContent = result.totalDataRows;
    document.getElementById("import-stat-updated").textContent = result.updated;
    document.getElementById("import-stat-created").textContent = result.created;
    document.getElementById("import-stat-batches").textContent = result.batchesUpserted;
    document.getElementById("import-stat-ambiguous").textContent = result.ambiguousSkus.length;

    const createdWrap = document.getElementById("import-created-wrap");
    if (result.createdProducts.length > 0) {
      document.getElementById("import-created-tbody").innerHTML = result.createdProducts
        .map(
          (c) => `
          <tr>
            <td class="font-monospace">${escapeHtml(c.sku)}</td>
            <td>${escapeHtml(c.name)}</td>
            <td class="text-muted">${Number(c.rowNumber)}</td>
            <td class="text-end">
              <button type="button" class="btn btn-sm btn-outline-success import-edit-created" data-id="${Number(c.id)}">
                Cargar precio
              </button>
            </td>
          </tr>`
        )
        .join("");
      createdWrap.classList.remove("d-none");
    } else {
      createdWrap.classList.add("d-none");
    }

    const ambiguousWrap = document.getElementById("import-ambiguous-wrap");
    if (result.ambiguousSkus.length > 0) {
      document.getElementById("import-ambiguous-tbody").innerHTML = result.ambiguousSkus
        .map((a) => {
          const occurrences = a.occurrences
            .map((o) => `${escapeHtml(o.name)} (fila ${Number(o.rowNumber)})`)
            .join("; ");
          return `
            <tr>
              <td class="font-monospace">${escapeHtml(a.sku)}</td>
              <td>${occurrences}</td>
            </tr>`;
        })
        .join("");
      ambiguousWrap.classList.remove("d-none");
    } else {
      ambiguousWrap.classList.add("d-none");
    }

    importResultEl.classList.remove("d-none");
  }

  importForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const file = importFileEl.files[0];
    if (!file) return;

    importFeedbackEl.className = "alert d-none";
    importResultEl.classList.add("d-none");
    importSubmitBtn.disabled = true;
    importSubmitBtn.textContent = "Importando…";

    try {
      // FormData, no JSON: apiFetch fuerza Content-Type: application/json, y
      // acá el navegador tiene que armar el multipart/form-data él solo (con
      // el boundary correcto), así que se llama a fetch directo.
      const body = new FormData();
      body.append("file", file);

      const res = await fetch(`${API}/inventory/import`, { method: "POST", body });
      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || `Error ${res.status}`);
      }

      renderImportResult(data);

      const partes = [];
      if (data.updated > 0) partes.push(`${data.updated} actualizado(s)`);
      if (data.created > 0) partes.push(`${data.created} creado(s) como borrador`);
      if (data.batchesUpserted > 0) partes.push(`${data.batchesUpserted} lote(s) registrado(s)`);
      const mensaje =
        partes.length > 0
          ? `Importación completa: ${partes.join(", ")}.`
          : "Importación completa: no hubo cambios (revisá el detalle abajo).";
      importFeedbackEl.textContent = mensaje;
      importFeedbackEl.className = `alert ${partes.length > 0 ? "alert-success" : "alert-warning"}`;

      if (data.updated > 0 || data.created > 0) {
        await loadProducts(); // refleja las marcas y los borradores nuevos en la tabla.
      }
      if (data.batchesUpserted > 0) {
        batchesLoaded = false; // fuerza a recargar la pestaña de vencimientos la próxima vez que se abra.
      }
    } catch (err) {
      importFeedbackEl.textContent = err.message;
      importFeedbackEl.className = "alert alert-danger";
    } finally {
      importSubmitBtn.disabled = false;
      importSubmitBtn.textContent = "Importar";
    }
  });

  // "Cargar precio" en la lista de recién creados: cierra el modal de
  // importación y abre directo el modal de edición de ese producto.
  document.getElementById("import-result").addEventListener("click", (event) => {
    const btn = event.target.closest(".import-edit-created");
    if (!btn) return;
    importModal.hide();
    openProductModal(Number(btn.dataset.id));
  });

  // ==========================================================
  // Init
  // ==========================================================

  hideFeedback();
  loadCategories()
    .then(loadProducts)
    .catch((err) => showFeedback("No se pudo cargar el panel: " + err.message, "danger"));
})();
