/* ==========================================================
   RolAgro — Frontend dinámico (Fase 2)
   Carga productos/categorías desde la API y procesa el checkout
   de invitado contra el backend (email + enlace de WhatsApp).
   ========================================================== */

(function () {
  "use strict";

  const CART_STORAGE_KEY = "rolagro_cart";

  /** @type {{id:number, name:string, price:number, qty:number}[]} */
  const cart = [];

  /** Catálogo completo en memoria, para filtrar sin volver al servidor. */
  let allProducts = [];

  // --- Referencias DOM ---
  const productsGridEl = document.getElementById("products-grid");
  const categoryFilterEl = document.getElementById("category-filter");
  const productsLoadingEl = document.getElementById("products-loading");
  const productsErrorEl = document.getElementById("products-error");

  const cartItemsEl = document.getElementById("cart-items");
  const cartEmptyEl = document.getElementById("cart-empty");
  const cartCountEl = document.getElementById("cart-count");
  const cartTotalEl = document.getElementById("cart-total");
  const confirmarBtn = document.getElementById("confirmar-pedido");

  const checkoutModalEl = document.getElementById("checkoutModal");
  const checkoutModal = new bootstrap.Modal(checkoutModalEl);
  const checkoutForm = document.getElementById("checkout-form");
  const checkoutNameEl = document.getElementById("checkout-name");
  const checkoutPhoneEl = document.getElementById("checkout-phone");
  const checkoutSubmitBtn = document.getElementById("checkout-submit");
  const checkoutFeedbackEl = document.getElementById("checkout-feedback");

  const formatCOP = (value) =>
    "$" + Number(value).toLocaleString("es-CO", { maximumFractionDigits: 0 });

  // ==========================================================
  // Catálogo: carga de productos desde la API
  // ==========================================================

  async function loadProducts() {
    try {
      const res = await fetch("/api/products");
      if (!res.ok) throw new Error("Respuesta no OK");
      const products = await res.json();

      productsLoadingEl.classList.add("d-none");

      // Se guarda el catálogo completo en memoria: el filtro por categoría
      // trabaja sobre esta lista y no vuelve a pedir datos al servidor.
      allProducts = products;

      if (products.length === 0) {
        productsGridEl.innerHTML =
          '<p class="text-muted text-center">Aún no hay productos cargados.</p>';
        return;
      }

      renderProducts(products);

      // El carrito puede venir de una visita anterior: se depura contra el
      // catálogo real antes de mostrarlo.
      syncCartWithCatalog(products);
    } catch (err) {
      console.error("Error al cargar productos:", err);
      productsLoadingEl.classList.add("d-none");
      productsErrorEl.classList.remove("d-none");
    }
  }

  /** Dibuja la grilla con la lista recibida (ya filtrada o completa). */
  function renderProducts(list) {
    if (list.length === 0) {
      productsGridEl.innerHTML =
        '<p class="text-muted text-center py-4">No hay productos en esta categoría.</p>';
      return;
    }
    productsGridEl.innerHTML = list.map(renderProductCard).join("");
  }

  // Delegación: la grilla se redibuja al filtrar, así que el listener va en
  // el contenedor y no en cada botón (evita duplicarlos en cada render).
  productsGridEl.addEventListener("click", (event) => {
    const button = event.target.closest(".add-to-cart");
    if (!button) return;

    addToCart({
      id: Number(button.dataset.id),
      name: button.dataset.name,
      price: Number(button.dataset.price),
    });
  });

  // ==========================================================
  // Filtro por categoría
  // ==========================================================

  async function loadCategories() {
    try {
      const res = await fetch("/api/categories");
      if (!res.ok) throw new Error("Respuesta no OK");
      const categories = await res.json();

      const buttons = [
        { id: null, name: "Todos" },
        ...categories,
      ].map(
        (cat, index) => `
          <button
            type="button"
            class="btn btn-sm ${index === 0 ? "btn-success" : "btn-outline-success"} category-btn"
            data-category="${cat.id === null ? "" : cat.id}"
          >${cat.name}</button>`
      );

      categoryFilterEl.innerHTML = buttons.join("");
    } catch (err) {
      // El filtro es un extra: si falla, el catálogo completo sigue visible.
      console.warn("No se pudieron cargar las categorías:", err);
    }
  }

  categoryFilterEl.addEventListener("click", (event) => {
    const button = event.target.closest(".category-btn");
    if (!button) return;

    // Estado visual: solo el botón activo va relleno.
    categoryFilterEl.querySelectorAll(".category-btn").forEach((b) => {
      b.classList.remove("btn-success");
      b.classList.add("btn-outline-success");
    });
    button.classList.remove("btn-outline-success");
    button.classList.add("btn-success");

    const categoryId = button.dataset.category;
    renderProducts(
      categoryId
        ? allProducts.filter((p) => String(p.category_id) === categoryId)
        : allProducts
    );
  });

  function renderProductCard(product) {
    return `
      <div class="col">
        <div class="card h-100 product-card shadow-sm">
          <img src="${product.image_url}" class="card-img-top" alt="${product.name}" />
          <div class="card-body d-flex flex-column">
            <span class="badge bg-success-subtle text-success-emphasis mb-2 align-self-start">${product.category_name}</span>
            <h5 class="card-title">${product.name}</h5>
            <p class="card-text text-muted small flex-grow-1">${product.description || ""}</p>
            <div class="d-flex justify-content-between align-items-center mt-2">
              <span class="fw-bold text-success fs-5">${formatCOP(product.price)}</span>
              <button
                class="btn btn-sm btn-success add-to-cart"
                data-id="${product.id}"
                data-name="${product.name}"
                data-price="${product.price}"
              >
                <i class="bi bi-cart-plus"></i> Agregar
              </button>
            </div>
          </div>
        </div>
      </div>`;
  }

  // ==========================================================
  // Carrito (en memoria)
  // ==========================================================

  /**
   * Recupera el carrito guardado en el navegador.
   * Devuelve [] si no hay nada, si el contenido está corrupto o si el
   * navegador bloquea el almacenamiento (modo incógnito, permisos).
   */
  function loadCartFromStorage() {
    try {
      const raw = localStorage.getItem(CART_STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (item) =>
            item &&
            Number.isFinite(Number(item.id)) &&
            Number(item.qty) > 0 &&
            Number.isFinite(Number(item.price))
        )
        // Se normalizan los tipos: el id debe ser número para poder
        // compararlo con el del catálogo.
        .map((item) => ({
          id: Number(item.id),
          name: String(item.name || ""),
          price: Number(item.price),
          qty: Math.min(Math.floor(Number(item.qty)), 999),
        }));
    } catch (err) {
      console.warn("No se pudo leer el carrito guardado:", err);
      return [];
    }
  }

  function saveCartToStorage() {
    try {
      localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(cart));
    } catch (err) {
      console.warn("No se pudo guardar el carrito:", err);
    }
  }

  /**
   * Pone al día el carrito guardado contra el catálogo recién cargado:
   * descarta productos que ya no existen y refresca nombres y precios que
   * hayan cambiado desde la última visita.
   *
   * El total real lo recalcula el servidor al confirmar el pedido; esto es
   * solo para que el cliente no vea datos viejos en pantalla.
   */
  function syncCartWithCatalog(products) {
    const byId = new Map(products.map((p) => [p.id, p]));
    let changed = false;

    for (let i = cart.length - 1; i >= 0; i--) {
      const fresh = byId.get(cart[i].id);
      if (!fresh) {
        cart.splice(i, 1);
        changed = true;
      } else if (
        Number(fresh.price) !== cart[i].price ||
        fresh.name !== cart[i].name
      ) {
        cart[i].price = Number(fresh.price);
        cart[i].name = fresh.name;
        changed = true;
      }
    }

    if (changed) renderCart();
  }

  function addToCart({ id, name, price }) {
    const existing = cart.find((item) => item.id === id);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ id, name, price, qty: 1 });
    }
    renderCart();
  }

  /** Suma o resta unidades. Al llegar a 0 el producto sale del carrito. */
  function changeQty(id, delta) {
    const item = cart.find((entry) => entry.id === id);
    if (!item) return;

    item.qty = Math.min(item.qty + delta, 999);
    if (item.qty <= 0) {
      removeFromCart(id);
      return;
    }
    renderCart();
  }

  function removeFromCart(id) {
    const index = cart.findIndex((entry) => entry.id === id);
    if (index !== -1) {
      cart.splice(index, 1);
      renderCart();
    }
  }

  function clearCart() {
    cart.length = 0;
    renderCart();
  }

  function renderCart() {
    // Se persiste aquí para no olvidarlo en ninguna operación: todas las
    // que modifican el carrito terminan llamando a renderCart().
    saveCartToStorage();
    cartItemsEl.innerHTML = "";

    if (cart.length === 0) {
      cartItemsEl.appendChild(cartEmptyEl);
      cartTotalEl.textContent = formatCOP(0);
      cartCountEl.textContent = "0";
      return;
    }

    let total = 0;
    let totalQty = 0;

    cart.forEach((item) => {
      const subtotal = item.price * item.qty;
      total += subtotal;
      totalQty += item.qty;

      const li = document.createElement("li");
      li.className = "list-group-item";
      li.innerHTML = `
        <div class="d-flex justify-content-between align-items-start gap-2">
          <div class="flex-grow-1">
            <div class="fw-semibold small">${item.name}</div>
            <small class="text-muted">${formatCOP(item.price)} c/u</small>
          </div>
          <button
            class="btn btn-sm btn-link text-danger p-0 cart-remove"
            data-id="${item.id}"
            title="Quitar del carrito"
            aria-label="Quitar ${item.name} del carrito"
          >
            <i class="bi bi-trash"></i>
          </button>
        </div>
        <div class="d-flex justify-content-between align-items-center mt-2">
          <div class="btn-group btn-group-sm" role="group" aria-label="Cantidad">
            <button class="btn btn-outline-secondary cart-decrease" data-id="${item.id}" aria-label="Quitar una unidad">
              <i class="bi bi-dash"></i>
            </button>
            <span class="btn btn-outline-secondary disabled px-3">${item.qty}</span>
            <button class="btn btn-outline-secondary cart-increase" data-id="${item.id}" aria-label="Agregar una unidad">
              <i class="bi bi-plus"></i>
            </button>
          </div>
          <span class="fw-bold">${formatCOP(subtotal)}</span>
        </div>
      `;
      cartItemsEl.appendChild(li);
    });

    cartTotalEl.textContent = formatCOP(total);
    cartCountEl.textContent = String(totalQty);
  }

  // Delegación: la lista se redibuja entera en cada cambio, así que el
  // listener va en el contenedor y no en cada botón.
  cartItemsEl.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-id]");
    if (!button) return;

    const id = Number(button.dataset.id);
    if (button.classList.contains("cart-increase")) changeQty(id, 1);
    else if (button.classList.contains("cart-decrease")) changeQty(id, -1);
    else if (button.classList.contains("cart-remove")) removeFromCart(id);
  });

  // ==========================================================
  // Checkout de invitado (modal -> POST /api/orders)
  // ==========================================================

  function showCheckoutFeedback(message, type) {
    checkoutFeedbackEl.textContent = message;
    checkoutFeedbackEl.className = `alert alert-${type}`;
  }

  confirmarBtn.addEventListener("click", () => {
    if (cart.length === 0) {
      alert("Tu carrito está vacío. Agrega productos antes de confirmar.");
      return;
    }
    checkoutFeedbackEl.classList.add("d-none");
    checkoutForm.reset();

    // Cierra el offcanvas del carrito antes de abrir el modal
    const offcanvasEl = document.getElementById("carritoOffcanvas");
    const offcanvasInstance = bootstrap.Offcanvas.getInstance(offcanvasEl);
    if (offcanvasInstance) offcanvasInstance.hide();

    checkoutModal.show();
  });

  checkoutForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    const name = checkoutNameEl.value.trim();
    const phone = checkoutPhoneEl.value.trim();

    if (!name || !phone) {
      showCheckoutFeedback("Completa tu nombre y teléfono.", "warning");
      checkoutFeedbackEl.classList.remove("d-none");
      return;
    }

    checkoutSubmitBtn.disabled = true;
    checkoutSubmitBtn.textContent = "Enviando...";

    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          phone,
          items: cart.map((item) => ({ productId: item.id, qty: item.qty })),
        }),
      });

      const data = await res.json();

      if (!res.ok || !data.success) {
        throw new Error(data.error || "No se pudo enviar el pedido.");
      }

      clearCart();
      checkoutModal.hide();

      const whatsappWindow = window.open(data.whatsappLink, "_blank");
      if (!whatsappWindow) {
        alert(
          "¡Pedido enviado! No pudimos abrir WhatsApp automáticamente, " +
            "usa este enlace: " +
            data.whatsappLink
        );
      }
    } catch (err) {
      console.error("Error al enviar el pedido:", err);
      showCheckoutFeedback(err.message, "danger");
      checkoutFeedbackEl.classList.remove("d-none");
    } finally {
      checkoutSubmitBtn.disabled = false;
      checkoutSubmitBtn.textContent = "Enviar Pedido";
    }
  });

  // ==========================================================
  // Init
  // ==========================================================

  // Restaura el carrito de la visita anterior antes del primer render.
  cart.push(...loadCartFromStorage());

  renderCart();
  loadProducts();
  loadCategories();
})();
