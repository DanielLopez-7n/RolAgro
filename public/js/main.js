/* ==========================================================
   RolAgro — Frontend dinámico (Fase 2)
   Carga productos/categorías desde la API y procesa el checkout
   de invitado contra el backend (email + enlace de WhatsApp).
   ========================================================== */

(function () {
  "use strict";

  /** @type {{id:number, name:string, price:number, qty:number}[]} */
  const cart = [];

  // --- Referencias DOM ---
  const productsGridEl = document.getElementById("products-grid");
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

      if (products.length === 0) {
        productsGridEl.innerHTML =
          '<p class="text-muted text-center">Aún no hay productos cargados.</p>';
        return;
      }

      productsGridEl.innerHTML = products.map(renderProductCard).join("");

      // Delegación: conecta los botones "Agregar" recién insertados
      productsGridEl.querySelectorAll(".add-to-cart").forEach((button) => {
        button.addEventListener("click", () => {
          addToCart({
            id: Number(button.dataset.id),
            name: button.dataset.name,
            price: Number(button.dataset.price),
          });
        });
      });
    } catch (err) {
      console.error("Error al cargar productos:", err);
      productsLoadingEl.classList.add("d-none");
      productsErrorEl.classList.remove("d-none");
    }
  }

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

  function addToCart({ id, name, price }) {
    const existing = cart.find((item) => item.id === id);
    if (existing) {
      existing.qty += 1;
    } else {
      cart.push({ id, name, price, qty: 1 });
    }
    renderCart();
  }

  function clearCart() {
    cart.length = 0;
    renderCart();
  }

  function renderCart() {
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
      li.className =
        "list-group-item d-flex justify-content-between align-items-center";
      li.innerHTML = `
        <div>
          <div class="fw-semibold">${item.name}</div>
          <small class="text-muted">${formatCOP(item.price)} x ${item.qty}</small>
        </div>
        <span class="fw-bold">${formatCOP(subtotal)}</span>
      `;
      cartItemsEl.appendChild(li);
    });

    cartTotalEl.textContent = formatCOP(total);
    cartCountEl.textContent = String(totalQty);
  }

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

  renderCart();
  loadProducts();
})();
