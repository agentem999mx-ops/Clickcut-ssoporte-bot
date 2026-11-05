# Click&Cut Bot 2.0

Implementación candidata para revisión, basada en el commit `3089d4af50d236d9eeee7ae2edc934b28471cad3` de `agentem999mx-ops/Clickcut-ssoporte-bot`. El bot no está desplegado ni vinculado a WhatsApp. Ambos canales están desactivados por defecto.

* Canal privado oficial: catálogo, solicitudes de pedido y renovación, tickets persistentes, consulta por cliente y escalamiento humano.
* Panel owner/staff: asignación, seguimiento, conversación de texto y respuestas con permisos por caso.
* Worker Baileys opcional: grupos permitidos, reglas, avisos, abrir/cerrar y agenda UTC, aislado y apagado por defecto.
* Integración futura con accesos-control: contrato mínimo deshabilitado; no expone cuentas ni contraseñas.

Con Node 24.22.x: `npm ci --ignore-scripts`, `npm test`. Consultar [despliegue](docs/DESPLIEGUE.md) para crear un usuario y ejecutar el panel localmente sin conectar WhatsApp.

Documentación: [arquitectura y seguridad](docs/ARQUITECTURA.md), [instrucciones](docs/DESPLIEGUE.md), [validación y límites](docs/VALIDACION.md). Las pruebas utilizan datos sintéticos. No hay credenciales reales.
