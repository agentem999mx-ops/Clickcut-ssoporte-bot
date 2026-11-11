# Preparación y despliegue posterior — no ejecutado

## Revisar y ejecutar localmente

Requisito: Node 24.22.x. Abrir la carpeta raíz del proyecto extraído. El servicio oficial no tiene dependencias de terceros.

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
Copy-Item .env.example .env
```

Crear el primer owner localmente. En PowerShell 7, la contraseña se solicita sin mostrarla; nunca ponerla como argumento o literal en el historial:

```powershell
$ccPassword = Read-Host 'Nueva contraseña de 14 caracteres o más' -MaskInput
$ccPassword | node --env-file-if-exists=.env src/users-cli.js create propietario owner
Remove-Variable ccPassword
npm.cmd start
```

Abrir `http://127.0.0.1:3000`. Cloud está apagado y no se contacta WhatsApp. Crear productos desde el panel. Para otro usuario repetir el comando `create colaborador staff`; usar `disable colaborador` o `password colaborador` para desactivar o restablecer (el restablecimiento también lee la nueva contraseña por stdin). No se entregan usuarios ni contraseñas precreados.

## Servicio oficial en servidor propio

1. Crear usuario sin privilegios, directorio privado de datos y volumen persistente. Una única instancia, sin autoescalado. Instalar Node 24.22.x y `npm ci --ignore-scripts`. Ejecutar las pruebas antes de configurar secretos reales.
2. Configurar reverse proxy HTTPS con certificado, dominio y `PUBLIC_ORIGIN` exacto. Exponer solo webhook y panel a través del proxy; preferir panel detrás de VPN/SSO del proxy con MFA. Reenviar rutas sin modificar el cuerpo del webhook. Limitar tráfico y tamaño de carga. Restringir el puerto de Node a localhost y usar `HOST=127.0.0.1` en VM; dentro de contenedor usar `HOST=0.0.0.0` sin publicar el puerto directamente a Internet.
3. En el gestor de secretos configurar `NODE_ENV=production`, `PUBLIC_ORIGIN=https://dominio`, `DB_PATH` del volumen, `META_APP_SECRET`, `META_VERIFY_TOKEN` aleatorio de al menos 24 caracteres, `META_PHONE_NUMBER_ID`, `META_ACCESS_TOKEN` y `META_GRAPH_VERSION`. Elegir una versión Graph soportada conforme a Meta. El token de usuario de sistema necesita el alcance mínimo de mensajería correspondiente; evitar un token temporal. No copiar estos valores al repositorio.
4. Crear y verificar los recursos de negocio que Meta requiera, configurar la aplicación, número oficial, permisos y suscripción del WABA. Dar de alta webhook HTTPS `/webhooks/whatsapp`, token de verificación y campo `messages`. El GET de verificación y el POST firmado tienen funciones diferentes.
5. Probar primero con recursos de prueba de Meta y destinatarios permitidos: catálogo, pedido, ticket, repetición de webhook, renovación de pedido propio, acceso staff y humano. Validar webhook `statuses`. Configurar plantillas sin parámetros aprobadas y registrar sus pares `nombre:idioma` en `META_APPROVED_TEMPLATES` si se necesitan respuestas fuera de ventana. Confirmar consentimiento; no cargar contactos para campañas.
6. Habilitar `CLOUD_ENABLED=true` solamente después de la revisión funcional y de políticas. Iniciar con supervisor de procesos (`npm start`), reinicio con espera, límite de memoria, apagado SIGTERM y comprobación `/health`. Un estado saludable confirma HTTP/DB, no que Meta o WhatsApp estén disponibles.
7. Mantener copias cifradas y probar recuperación. Revisar tickets pendientes, `outbox.failed`, `outbox.unknown`, `outbox.blocked`, respuestas 429 y disco disponible. No registrar cuerpos, headers Authorization ni archivos de sesión en el recolector de logs.

La cuenta de aplicación guarda su DB en texto claro a nivel SQLite: requiere cifrado de disco/volumen y de backup. Para una copia consistente con el servicio en marcha usar backup de SQLite; no copiar solo el archivo principal ignorando WAL. Ejemplo de backup local, con destino protegido:

```powershell
node scripts/backup.js data/clickcut.sqlite data/backups/clickcut.sqlite
```

La copia no cifra por sí misma: cifrar en almacenamiento y aplicar retención. Para restaurar, detener el servicio, guardar una copia del estado actual, restaurar en un directorio limpio y apuntar `DB_PATH` al archivo restaurado. No mezclar con WAL/SHM de otra versión. Verificar integridad y casos conocidos antes de abrir tráfico.

## Módulo de grupos opcional

No requerido para operar el canal oficial. Revisar `ARQUITECTURA.md` y el estado de dependencias en `VALIDACION.md`. Usar un usuario del sistema y volumen distintos. No darle la base de clientes, tokens Meta ni el archivo `.env` del servicio oficial. `groups/.env.example` es independiente.

```powershell
Copy-Item groups/.env.example groups/.env
Copy-Item groups/config.example.json groups/config.local.json
npm.cmd ci --prefix groups --ignore-scripts
```

Configurar JID reales de grupos y JID exactos de staff en el archivo local; la plantilla deliberadamente inválida evita actuar en cualquier grupo por omisión. Validar administradores actuales y permisos del bot. Cambiar los dos indicadores `GROUPS_ENABLED` y `GROUPS_RISK_ACCEPTED` solo tras aceptar el riesgo de integración no oficial. En una terminal privada local, sin grabación de logs, habilitar temporalmente `GROUPS_PAIRING_LOCAL=true`, arrancar `npm run groups` y vincular el dispositivo. Desactivar después la visualización QR. No vincular nada durante revisión del parche.

Ante desconexión se espera de forma exponencial hasta un máximo de ocho intentos; logout requiere operador y nueva vinculación. No borrar sesión automáticamente. No configurar un supervisor que reconecte de inmediato en bucle después de logout; pausar y revisar.

Comandos: `.reglas`, `.menu`, `.ayuda`; `.reporte`/`.codigo` remiten al privado sin guardar el detalle. Solo staff autorizado que además sea admin actual: `.aviso texto`, `.abrir`, `.cerrar`. No existe `.todos` ni etiquetado masivo. Mensajes privados se ignoran.

Agenda puntual por operador local (fecha de ejemplo: sustituir por una futura en UTC):

```powershell
node --env-file=groups/.env groups/schedule.js JID_DEL_GRUPO close 2030-01-01T04:00:00Z
node --env-file=groups/.env groups/schedule.js JID_DEL_GRUPO notice 2030-01-01T15:00:00Z 'Aviso autorizado'
```

El módulo valida que el grupo esté permitido y el bot sea admin. No hay edición de agenda desde el panel privado ni recurrencia diaria automática. Cualquier job `unknown` requiere verificar el grupo antes de reprogramar.

## Revisión de parche y rollback

El parche está basado en el commit original; el ZIP incluye la copia modificada sin `.git`, datos, sesiones ni dependencias descargadas. Para revisar sobre otra copia limpia del mismo commit:

```powershell
git apply --check RUTA/Clickcut-2.0.patch
git apply RUTA/Clickcut-2.0.patch
npm.cmd ci --ignore-scripts
npm.cmd test
```

No ejecutar `git push`, crear PR, publicar imágenes ni activar despliegues como parte de esta revisión. Si el repositorio cambió, reconciliar el parche antes de aplicar. Rollback posterior: detener ambos servicios, volver al artefacto previo y restaurar su backup compatible. El bot anterior puede reconectar a grupos si se arranca: no usarlo como rollback automático sin revisar. Desactivar Cloud corta los envíos nuevos del servicio, pero no revoca envíos ya aceptados ni la suscripción de Meta; deshabilitar la suscripción por separado cuando corresponda.
