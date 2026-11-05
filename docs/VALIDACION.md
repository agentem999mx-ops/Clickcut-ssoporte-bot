# Validación de la entrega

Fecha de preparación: 4 de noviembre de 2026 (zona del usuario: America/Mexico_City).

## Resultado

21 pruebas automatizadas aprobadas; 0 fallidas. Node v24.22.0 en Windows. Ejecución real de HTTP sobre localhost con autorización del entorno. Ninguna prueba contacta Meta ni inicia una sesión de WhatsApp. Los datos de prueba son sintéticos y se crean en memoria o en un directorio temporal que se elimina al terminar.

Cobertura funcional verificada:

* Persistencia y reapertura de SQLite; tickets con folio y deduplicación de webhook.
* Precio congelado de pedidos, renovación de pedido completado propio y privacidad en consultas de estado.
* Ticket de escalamiento humano, pausa del bot, baja/alta y bloqueo de cola.
* Ventana de 24 horas con fecha original, plantillas fuera de ventana, respeto de baja, reintento 429 y retención de resultados inciertos.
* Firma HMAC sobre bytes originales, rechazo de falsificación y comparación de contraseñas scrypt.
* HTTP del panel: login, CSRF, límites owner/staff, rechazo de autoasignación por staff, asignación por owner, revocación y respuestas.
* Lectura de conversación por responsable autorizado y rechazo al staff ajeno.
* Webhook de Meta: desafío GET, lote firmado, procesamiento único de tickets y pedidos.
* Baileys simulado: doble autorización, permiso del bot, grupos permitidos, rechazo de privados/historial antiguo, deduplicación y agenda de una sola ejecución.
* Puerto futuro desactivado y eliminación de campos no autorizados de accesos-control.

El servicio oficial no tiene dependencias npm de terceros. Archivo lock generado. Dependencias opcionales de grupos instaladas con `--ignore-scripts`; auditoría del instalador: 71 paquetes, 0 vulnerabilidades conocidas reportadas. Importación real comprobada de `makeWASocket`, `useMultiFileAuthState`, `DisconnectReason`, pino y generador QR. Esto no equivale a una prueba de sesión ni garantiza ausencia de fallos o vulnerabilidades futuras. Se fijó Baileys `7.0.0-rc14`, versión candidata indicada por el registro consultado; revisar estabilidad y cambios antes de activarla.

Se verifican además sintaxis JavaScript, coherencia del backup, formato del parche y aplicación sobre el commit base. El paquete de entrega excluye `.git`, node_modules, `.env`, bases, backups, QR y sesiones.

## Pendiente antes de producción

* Prueba de extremo a extremo con recursos de prueba de Meta, token válido, webhook público HTTPS y plantillas aprobadas.
* Comprobar políticas, versión Graph soportada, permisos, consentimiento y costos vigentes. Las páginas vigentes de Meta devolvieron 429 al consultarlas; no se afirma una tarifa ni una versión actual de Graph.
* Revisión de UX en navegador, accesibilidad y carga con los operadores previstos. Se probó HTTP y autorización del panel; no se realizó inspección visual automatizada.
* Prueba real de Baileys en grupo de ensayo con un número separado, solo si se decide aceptar sus riesgos; en particular identidades LID/PN, reconexión y permisos actuales.
* Definir catálogo comercial, reglas, horario, precios, responsable de pendientes y validación de pagos. El bot no verifica pagos ni entrega contraseñas.
* Cifrado y ACL del volumen, MFA en proxy para el panel, política de retención, purga y ejercicio de recuperación.
* No está implementado el adaptador de accesos-control; requiere contrato y autorización en ambos sistemas. No se cambió ese repositorio.

## Límites explícitos

Una instancia por servicio con SQLite; sin alta disponibilidad ni escalado horizontal. El panel limita resultados a 100 filas y el historial a 50 textos por dirección. No hay manejo de adjuntos, campañas, conciliación automática de pagos, recordatorios recurrentes de renovación, entrega de accesos, catálogo Commerce de Meta, edición de prioridad o gestión de usuarios desde navegador. Las renovaciones sí se registran como solicitudes revisables. Los avisos de grupos se programan por operador local, no desde el panel. Estos alcances y la activación de servicios externos requieren trabajo adicional antes de prometerlos como funciones operativas.
