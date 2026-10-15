const { 
    default: makeWASocket, 
    useMultiFileAuthState, 
    DisconnectReason 
} = require('@whiskeysockets/baileys');
const pino = require('pino');

async function iniciarBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sesion_soporte');

    const sock = makeWASocket({
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: true
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reconectar = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            console.log('Conexión cerrada. Reconectando:', reconectar);
            if (reconectar) iniciarBot();
        } else if (connection === 'open') {
            console.log('✅ Bot Click&Cut conectado exitosamente a WhatsApp.');
        }
    });

    sock.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        const msg = messages[0];
        if (!msg.message || msg.key.fromMe) return;

        // Extraer texto y parámetros
        const texto = (
            msg.message.conversation || 
            msg.message.extendedTextMessage?.text || 
            ''
        ).trim();

        const jid = msg.key.remoteJid;
        const esGrupo = jid.endsWith('@g.us');
        if (!esGrupo) return; // Solo actuar dentro de grupos

        const sender = msg.key.participant || jid;
        const remitenteNum = sender.split('@')[0];

        // Función para validar si el que envía es Administrador del grupo
        async function esAdmin(jidGrupo, usuarioJid) {
            try {
                const metadata = await sock.groupMetadata(jidGrupo);
                const participante = metadata.participants.find(p => p.id === usuarioJid);
                return participante?.admin === 'admin' || participante?.admin === 'superadmin';
            } catch (err) {
                console.error('Error al comprobar permisos de admin:', err);
                return false;
            }
        }

        // ==========================================
        // COMANDOS DE CLIENTES
        // ==========================================

        // --- .menu / .ayuda ---
        if (texto.toLowerCase() === '.menu' || texto.toLowerCase() === '.ayuda') {
            const menu = 
`🤖 *MENÚ DE ASISTENCIA — CLICK&CUT*

Escribe cualquiera de los siguientes comandos en el chat:

🔹 *.codigo [servicio]* ➔ Solicitar PIN o acceso temporal en tu TV.
🔹 *.reporte [falla]* ➔ Levantar ticket por cuenta caída o error.
🔹 *.pagos* ➔ Ver cuentas de transferencia y métodos de pago.
🔹 *.tramites* ➔ Catálogo de trámites y gestiones digitales.
🔹 *.reglas* ➔ Políticas de uso y garantías de los perfiles.
🔹 *.horario* ➔ Horarios de atención y soporte.

📌 *Por favor, utiliza los comandos para mantener el grupo ordenado.*`;

            await sock.sendMessage(jid, { text: menu }, { quoted: msg });
        }

        // --- .codigo [servicio] ---
        else if (texto.toLowerCase().startsWith('.codigo')) {
            const servicio = texto.split(' ').slice(1).join(' ') || 'tu cuenta';
            const respuesta = 
`🔐 *SOLICITUD DE CÓDIGO TEMPORAL*

👤 *Cliente:* @${remitenteNum}
📺 *Servicio:* ${servicio.toUpperCase()}

⚠️ *Instrucciones obligatorias:*
1. No cierres ni muevas la pantalla en tu TV o dispositivo.
2. Mantén visible la pantalla donde pide el código de 4 dígitos o el enlace.
3. En breve un administrador te enviará el acceso. Los códigos vencen rápido, ¡mantente atento!`;

            await sock.sendMessage(jid, { text: respuesta, mentions: [sender] }, { quoted: msg });
        }

        // --- .reporte [detalle] ---
        else if (texto.toLowerCase().startsWith('.reporte')) {
            const detalle = texto.split(' ').slice(1).join(' ');
            if (!detalle) {
                await sock.sendMessage(jid, { 
                    text: `⚠️ *Formato incorrecto.*\nEscribe: \`.reporte [Servicio] [Problema detallado]\`\n_Ejemplo: .reporte Max perfil 3 clave incorrecta_` 
                }, { quoted: msg });
                return;
            }

            const respuesta = 
`🛠️ *TICKET DE SOPORTE GENERADO*

👤 *Usuario:* @${remitenteNum}
📌 *Detalle:* ${detalle}
⏳ *Estado:* En cola de revisión

✅ *Tu reporte fue registrado con éxito. Un administrador revisará la cuenta a la brevedad. Evita repetir mensajes para agilizar tu atención.*`;

            await sock.sendMessage(jid, { text: respuesta, mentions: [sender] }, { quoted: msg });
        }

        // --- .pagos / .renovar ---
        else if (texto.toLowerCase() === '.pagos' || texto.toLowerCase() === '.renovar') {
            const pagos = 
`💳 *MÉTODOS DE PAGO DISPONIBLES — CLICK&CUT*

🏦 *Transferencia Directa (SPEI):*
• Banco: [Tu Banco]
• CLABE: \`[Tu CLABE Aquí]\`
• Titular: [Tu Nombre]

📱 *Mercado Pago / OXXO:*
• Enlace / Referencia: Solicitar al privado de administración.

⚠️ *Al transferir:* Envía comprobante al privado indicando tu nombre, servicio a pagar y correo asignado si es renovación.`;

            await sock.sendMessage(jid, { text: pagos }, { quoted: msg });
        }

        // --- .tramites ---
        else if (texto.toLowerCase() === '.tramites') {
            const tramites = 
`📄 *TRÁMITES Y SERVICIOS DIGITALES — CLICK&CUT*

Realizamos gestiones oficiales y asistencia en línea:
• Impresión y descarga de Actas (Nacimiento, Matrimonio, Defunción).
• Consultas y correcciones de CURP / RFC con homoclave.
• Citas oficiales y seguimiento de plataformas gubernamentales.
• Formatos, registros educativos y solicitudes en línea.

📩 *Para cotizaciones y requisitos de cualquier trámite, envía mensaje privado al administrador.*`;

            await sock.sendMessage(jid, { text: tramites }, { quoted: msg });
        }

        // --- .reglas / .garantia ---
        else if (texto.toLowerCase() === '.reglas' || texto.toLowerCase() === '.garantia') {
            const reglas = 
`📜 *POLÍTICAS DE GARANTÍA Y USO — CLICK&CUT*

1. *1 Pantalla / Perfil:* Prohibido ingresar en más dispositivos de los contratados.
2. *Datos Intocables:* Prohibido cambiar contraseñas, correos, nombres de perfiles ajenos o pines.
3. *Violación de reglas:* Modificar datos anula la garantía de inmediato sin reembolso.
4. *Tiempo de resolución:* Caídas o reemplazos se atienden en un lapso de 1 a 24 horas hábiles.`;

            await sock.sendMessage(jid, { text: reglas }, { quoted: msg });
        }

        // --- .horario ---
        else if (texto.toLowerCase() === '.horario') {
            const horario = 
`⏰ *HORARIOS DE ATENCIÓN Y SOPORTE*

• *Lunes a Sábado:* 9:00 AM – 10:00 PM
• *Domingos:* Turno de guardia y entregas programadas.

🌙 *Los reportes enviados fuera del horario se atienden en orden estricto de llegada al reanudar actividades.*`;

            await sock.sendMessage(jid, { text: horario }, { quoted: msg });
        }

        // ==========================================
        // COMANDOS DE ADMINISTRADOR
        // ==========================================

        // --- .cerrar (Bloquea el chat a solo admins) ---
        else if (texto.toLowerCase() === '.cerrar') {
            const admin = await esAdmin(jid, sender);
            if (!admin) {
                await sock.sendMessage(jid, { text: '⛔ *Acceso denegado.* Solo los administradores pueden usar este comando.' }, { quoted: msg });
                return;
            }

            try {
                await sock.groupSettingUpdate(jid, 'announcement');
                const respuesta = 
`🔒 *GRUPO CERRADO POR HORARIO*

El chat entra en modo descanso. Solo los administradores pueden enviar mensajes en este momento.

⏰ Reanudamos atención a las 9:00 AM.
Si dejaste un reporte pendiente, se atenderá a primera hora. ¡Buenas noches!`;

                await sock.sendMessage(jid, { text: respuesta });
            } catch (err) {
                await sock.sendMessage(jid, { text: '⚠️ *Error:* Asegúrate de que el bot sea administrador del grupo para cambiar la configuración.' }, { quoted: msg });
            }
        }

        // --- .abrir (Habilita el chat para todos) ---
        else if (texto.toLowerCase() === '.abrir') {
            const admin = await esAdmin(jid, sender);
            if (!admin) {
                await sock.sendMessage(jid, { text: '⛔ *Acceso denegado.* Solo los administradores pueden usar este comando.' }, { quoted: msg });
                return;
            }

            try {
                await sock.groupSettingUpdate(jid, 'not_announcement');
                const respuesta = 
`🔓 *GRUPO ABIERTO — BUENOS DÍAS*

El chat está habilitado para solicitudes, renovaciones y soporte.

💡 *Usa los comandos .codigo, .reporte o .pagos para agilizar tu atención.*`;

                await sock.sendMessage(jid, { text: respuesta });
            } catch (err) {
                await sock.sendMessage(jid, { text: '⚠️ *Error:* Asegúrate de que el bot sea administrador del grupo para cambiar la configuración.' }, { quoted: msg });
            }
        }

        // --- .aviso [mensaje] ---
        else if (texto.toLowerCase().startsWith('.aviso')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const comunicado = texto.split(' ').slice(1).join(' ');
            if (!comunicado) return;

            const plantilla = 
`📢 *COMUNICADO OFICIAL — CLICK&CUT*

${comunicado}

⚠️ *Atención a todos los miembros: Por favor leer con atención para evitar dudas repetidas.*`;

            await sock.sendMessage(jid, { text: plantilla });
        }

        // --- .todos [mensaje] / .tagall ---
        else if (texto.toLowerCase().startsWith('.todos') || texto.toLowerCase().startsWith('.tagall')) {
            const admin = await esAdmin(jid, sender);
            if (!admin) return;

            const mensaje = texto.split(' ').slice(1).join(' ') || 'Atención grupo';
            const metadata = await sock.groupMetadata(jid);
            const participantes = metadata.participants.map(p => p.id);

            let mencionesTexto = `🔔 *NOTIFICACIÓN GENERAL*\n\n${mensaje}\n\n`;
            for (const p of metadata.participants) {
                mencionesTexto += `@${p.id.split('@')[0]} `;
            }

            await sock.sendMessage(jid, { text: mencionesTexto, mentions: participantes });
        }
    });
}

iniciarBot();
