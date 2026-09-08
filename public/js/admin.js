/* ==========================================================
   RolAgro — Panel de administración
   Gestiona productos y categorías y consulta los pedidos
   recibidos. Todas las llamadas van a /admin/api/*, protegido
   con autenticación básica (ver src/middlewares/basicAuth.js).
   ========================================================== */

(function () {
  "use strict";

  const API = "/admin/api";

  /** Catálogos en memoria para no repedirlos al abrir el modal. */
  let categories = [];
  let products = [];

  // --- Referencias DOM ---
  const feedbackEl = document.getElementById("admin-feedback");
  const productsTbody = document.getElementById("products-tbody");
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
    try {
      products = await apiFetch("/products");

      if (products.length === 0) {
        productsTbody.innerHTML = `
          <tr>
            <td colspan="5" class="text-center text-muted py-4">
              Todavía no hay productos. Crea el primero con "Nuevo producto".
            </td>
          </tr>`;
        return;
      }

      productsTbody.innerHTML = products.map(renderProductRow).join("");
    } catch (err) {
      productsTbody.innerHTML = `
        <tr><td colspan="5" class="text-center text-danger py-4">${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function renderProductRow(product) {
    const image = product.image_url
      ? `<img src="${escapeHtml(product.image_url)}" alt="" class="rounded" style="width:56px;height:56px;object-fit:cover;" />`
      : '<span class="text-muted small">—</span>';

    return `
      <tr>
        <td>${image}</td>
        <td>
          <div class="fw-semibold">${escapeHtml(product.name)}</div>
          <div class="text-muted small">${escapeHtml(product.description || "")}</div>
        </td>
        <td><span class="badge bg-success-subtle text-success-emphasis">${escapeHtml(product.category_name)}</span></td>
        <td class="text-end fw-semibold">${formatCOP(product.price)}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary product-edit" data-id="${Number(product.id)}" title="Editar">
            <i class="bi bi-pencil"></i>
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
      // Se usa el listado que ya está en memoria en lugar de pedir el producto
      // otra vez: la tabla visible se acaba de traer del servidor.
      const product = products.find((p) => p.id === id);
      if (!product) {
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
  // Init
  // ==========================================================

  hideFeedback();
  loadCategories()
    .then(loadProducts)
    .catch((err) => showFeedback("No se pudo cargar el panel: " + err.message, "danger"));
})();
