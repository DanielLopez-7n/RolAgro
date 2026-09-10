/**
 * Avisos de la pantalla de login.
 *
 * El formulario es un POST HTML normal, así que el servidor no puede
 * "devolver" un mensaje sin un motor de plantillas: lo que hace es redirigir
 * de vuelta acá con un parámetro (?error=1, ?error=limite, ?salida=1) y este
 * archivo revela el aviso correspondiente.
 *
 * Todo lo importante funciona sin este script: entrar al panel no depende de
 * él, solo el texto que explica por qué el intento anterior no salió.
 */
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var error = params.get("error");

  if (error === "limite") {
    document.getElementById("alert-limite").hidden = false;
  } else if (error) {
    document.getElementById("alert-error").hidden = false;
  } else if (params.get("salida")) {
    document.getElementById("alert-salida").hidden = false;
  }

  // Se limpia la URL: si la persona recarga después de un error, no tiene
  // sentido que el aviso viejo siga ahí.
  if (window.history.replaceState && window.location.search) {
    window.history.replaceState({}, "", window.location.pathname);
  }
})();
