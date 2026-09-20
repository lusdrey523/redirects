# redirects

Cloudflare Worker que resuelve el enlace NFC/QR de las tarjetas físicas hacia la URL de reseñas de Google del negocio.

## Flujo

1. El cliente acerca el teléfono o escanea el QR de la tarjeta.
2. Se abre `https://[dominio]/[CODIGO]`.
3. El Worker busca el código en el KV `DEVICES`.
4. Si está configurado con una URL válida → redirige 302.
5. Si no → muestra página de tarjeta no configurada.

## Estados

- `pending` — creado, sin URL de reseñas válida
- `configured` — tiene URL `https` válida

## Datos por dispositivo

- `status`, `businessName`, `reviewUrl`, `scans`, `lastUsed`, `createdAt`, `updatedAt`, `history`

## Bindings necesarios

- KV: `DEVICES`
- Variable: `ADMIN_PASSWORD`

## Diseño físico

El archivo de diseño de la tarjeta está en `assets/`.
