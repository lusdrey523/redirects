# redirects — Breto's Services

Cloudflare Worker que resuelve el enlace físico (NFC + QR) de las tarjetas de reseñas Google hacia el perfil correcto del negocio.

## Qué es un Device

Un **device** es una tarjeta física (PVC) con chip NFC + código QR.  
Cada tarjeta tiene un código corto (ejemplo: `ABC123`) grabado en el NFC y en el QR.

### Flujo real

1. El cliente acerca el teléfono a la tarjeta (NFC) o escanea el QR.
2. El teléfono abre `https://[dominio]/[CODIGO]`.
3. El Worker busca el código en el KV `DEVICES`.
4. Si el dispositivo está `configured` y tiene una `reviewUrl` válida → redirige 302 a la URL de reseñas de Google.
5. Si no está configurado → muestra página de “tarjeta no configurada”.

## Estados de un dispositivo

| Estado       | Significado                                      |
|--------------|--------------------------------------------------|
| `pending`    | Creado, todavía no tiene URL de reseñas válida |
| `configured` | Tiene `reviewUrl` https válida y lista para uso  |

## Datos guardados por dispositivo

- `status`
- `businessName`
- `reviewUrl`
- `scans` (contador de usos)
- `lastUsed`
- `createdAt` / `updatedAt`
- `history` (últimas 20 acciones)

## Variables de entorno / bindings necesarios

- Binding KV: `DEVICES`
- `ADMIN_PASSWORD` (solo para acceso al panel)

## Archivos de diseño

El archivo `Base PVC.png` es el diseño físico de la tarjeta.  
Se recomienda moverlo a una carpeta `assets/` para no mezclar material de impresión con el código del Worker.

## Qué está implementado vs. conceptual

| Elemento                              | Estado        |
|---------------------------------------|---------------|
| Redirect NFC/QR → Google Reviews      | Implementado  |
| Gestión de dispositivos (CRUD básico) | Implementado  |
| Contador de escaneos                  | Implementado  |
| Export CSV                            | Implementado  |
| CRM de prospectos                     | No construido |
| Línea B (tarjeta de contacto digital) | No construido |
| Pedidos / pagos / producción          | No construido |

---

Documentación operativa interna y arquitectura completa (SIP-SOE, RMHE, MEC, etc.) se mantiene en Google Drive, no en este repositorio.
