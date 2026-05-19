import express, { Request, Response } from 'express'
import { configDotenv } from "dotenv";
import log from './log'
import Messages from './controllers/message';
import { Aprovation, NotificationProject, webhook } from './controllers/zod';
import {
    createDelivery,
    createNotification,
    createRecipient,
    deleteRecipient,
    getStats,
    listDeliveries,
    listNotifications,
    listRecipients,
    Recipient,
    seedRecipientsFromEnv,
    updateRecipientStatus,
} from './db';

configDotenv()

const app = express()
const port = Number(process.env.PORT || 4000)

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));

const envRemoteJids = parseJidList(process.env.EVOLUTION_REMOTEJID || "5573935050217")
seedRecipientsFromEnv(envRemoteJids)

app.get('/', (req: Request, res: Response) => {
    res.status(200).type('html').send(renderDashboard())
});

app.get('/api/state', (req: Request, res: Response) => {
    res.status(200).json({
        stats: getStats(),
        recipients: listRecipients(true),
        notifications: listNotifications(80).map(parsePayload),
        deliveries: listDeliveries(120).map(parseDeliveryPayload),
    })
});

app.post('/api/recipients', (req: Request, res: Response) => {
    const label = String(req.body.label || '').trim()
    const jid = String(req.body.jid || '').trim()
    const type = String(req.body.type || '').trim()

    if (!jid) {
        return res.status(400).json({ message: 'Informe o telefone, JID ou JID do grupo.' })
    }

    try {
        const recipient = createRecipient({ label, jid, type })
        res.status(201).json({ recipient })
    } catch (error) {
        log.error(error)
        res.status(409).json({ message: 'Esse destinatário já está cadastrado.' })
    }
});

app.patch('/api/recipients/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id)
    const active = Boolean(req.body.active)

    if (!Number.isFinite(id)) {
        return res.status(400).json({ message: 'Destinatário inválido.' })
    }

    updateRecipientStatus(id, active)
    res.status(200).json({ success: true })
});

app.delete('/api/recipients/:id', (req: Request, res: Response) => {
    const id = Number(req.params.id)

    if (!Number.isFinite(id)) {
        return res.status(400).json({ message: 'Destinatário inválido.' })
    }

    deleteRecipient(id)
    res.status(200).json({ success: true })
});

app.post('/api/send', async (req: Request, res: Response) => {
    const message = String(req.body.message || '').trim()
    const directJids = parseJidList(String(req.body.jids || ''))
    const selectedRecipientIds = Array.isArray(req.body.recipientIds)
        ? req.body.recipientIds.map(Number).filter(Number.isFinite)
        : []

    if (!message) {
        return res.status(400).json({ message: 'Informe a mensagem.' })
    }

    const storedRecipients = listRecipients(false)
        .filter((recipient) => selectedRecipientIds.length === 0 || selectedRecipientIds.includes(recipient.id))
    const directRecipients = directJids.map((jid) => ({
        id: null,
        label: jid,
        jid,
        type: 'direct',
        active: 1,
        created_at: new Date().toISOString(),
    }))
    const recipients = dedupeRecipients([...storedRecipients, ...directRecipients])

    if (recipients.length === 0) {
        return res.status(400).json({ message: 'Cadastre ou informe ao menos um destinatário.' })
    }

    const notification = createNotification({
        source: 'manual',
        type: 'manual',
        subject: 'Envio manual pelo painel',
        payload: { message, directJids, selectedRecipientIds },
    })

    const results = await sendToRecipients(recipients, message, notification.id)
    res.status(200).json({ notification, results })
});

app.post('/notificate', async (req: Request, res: Response) => {
    res.status(200).json({ message: 'Notificação recebida' })

    try {
        log.debug("Novo Email recebido")
        const body: webhook = req.body
        const notificationType = classifyWebhook(body)
        const notification = createNotification({
            source: 'zoho',
            type: notificationType,
            subject: body.subject,
            sender: body.sender,
            fromAddress: body.fromAddress,
            toAddress: body.toAddress,
            receivedTime: body.receivedTime,
            messageId: body.messageId,
            payload: body,
        })

        if (body.fromAddress !== 'naoresponder@cbm.ba.gov.br') {
            log.trace("Mas não é do corpo de bombeiros")
            return
        }

        const message = messageForNotificationType(notificationType)

        if (!message) {
            log.trace("Assunto não corresponde a nenhum filtro")
            return
        }

        log.trace(`É ${notificationType}, enviando notificação`)
        await sendToRecipients(listRecipients(false), message, notification.id)
    } catch (error) {
        log.error(error)
    }
})

app.listen(port, () => {
    log.debug(`App running in port ${port}`)
})

function classifyWebhook(body: webhook) {
    if (Aprovation.safeParse(body.subject).success) {
        return 'approval'
    }

    if (NotificationProject.safeParse(body.subject).success) {
        return 'project_notification'
    }

    return 'ignored'
}

function messageForNotificationType(type: string) {
    if (type === 'approval') {
        return "🎉 Nova Aprovação no Fênix"
    }

    if (type === 'project_notification') {
        return "❗ Projeto Notificado - Verificar no Fênix"
    }

    return null
}

async function sendToRecipients(recipients: Recipient[], message: string, notificationId: number) {
    if (!process.env.WUZAPI_TOKEN) {
        throw new Error('WUZAPI_TOKEN não configurado.')
    }

    const sender = new Messages(message, '', true)

    return Promise.all(recipients.map(async (recipient) => {
        try {
            const response = await sender.sendWuzapiMessage(process.env.WUZAPI_TOKEN!, recipient.jid, message)
            createDelivery({
                notificationId,
                recipientId: recipient.id,
                jid: recipient.jid,
                message,
                status: 'sent',
                response,
            })
            return { jid: recipient.jid, status: 'sent', response }
        } catch (error) {
            createDelivery({
                notificationId,
                recipientId: recipient.id,
                jid: recipient.jid,
                message,
                status: 'failed',
                error,
            })
            return { jid: recipient.jid, status: 'failed', error: error instanceof Error ? error.message : String(error) }
        }
    }))
}

function parseJidList(value: string) {
    return value
        .split(',')
        .map((jid) => jid.trim())
        .filter(Boolean)
}

function dedupeRecipients(recipients: Recipient[]) {
    const seen = new Set<string>()

    return recipients.filter((recipient) => {
        if (seen.has(recipient.jid)) {
            return false
        }

        seen.add(recipient.jid)
        return true
    })
}

function parsePayload(record: any) {
    return {
        ...record,
        payload: safeJson(record.payload),
    }
}

function parseDeliveryPayload(record: any) {
    return {
        ...record,
        response: safeJson(record.response),
    }
}

function safeJson(value: string | null) {
    if (!value) {
        return null
    }

    try {
        return JSON.parse(value)
    } catch {
        return value
    }
}

function renderDashboard() {
    return `<!doctype html>
<html lang="pt-BR">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Painel de Notificações Wuzapi</title>
    <style>
        :root {
            color-scheme: light;
            --bg: #f5f7fb;
            --surface: #ffffff;
            --surface-2: #eef3f8;
            --text: #17202f;
            --muted: #64748b;
            --line: #d9e2ec;
            --accent: #147a63;
            --accent-strong: #0f5f4e;
            --danger: #ba2d3b;
            --warning: #a15c00;
            --radius: 8px;
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        }

        * { box-sizing: border-box; }
        body {
            margin: 0;
            background: var(--bg);
            color: var(--text);
        }

        header {
            background: var(--surface);
            border-bottom: 1px solid var(--line);
        }

        .wrap {
            width: min(1180px, calc(100% - 32px));
            margin: 0 auto;
        }

        .topbar {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            padding: 18px 0;
        }

        h1, h2, h3, p { margin: 0; }
        h1 { font-size: 22px; line-height: 1.2; }
        h2 { font-size: 16px; line-height: 1.3; }
        h3 { font-size: 14px; line-height: 1.2; }
        p, td, th, input, select, textarea, button { font-size: 14px; }
        .muted { color: var(--muted); }
        .status { font-weight: 700; color: var(--accent); }

        main {
            display: grid;
            gap: 18px;
            padding: 20px 0 32px;
        }

        .stats {
            display: grid;
            grid-template-columns: repeat(5, minmax(0, 1fr));
            gap: 12px;
        }

        .stat, .panel {
            background: var(--surface);
            border: 1px solid var(--line);
            border-radius: var(--radius);
        }

        .stat { padding: 14px; }
        .stat strong {
            display: block;
            font-size: 28px;
            line-height: 1;
            margin-bottom: 6px;
        }

        .grid {
            display: grid;
            grid-template-columns: 380px minmax(0, 1fr);
            gap: 18px;
            align-items: start;
        }

        .panel-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 12px;
            padding: 14px;
            border-bottom: 1px solid var(--line);
        }

        .panel-body { padding: 14px; }
        .stack { display: grid; gap: 12px; }
        .row { display: flex; gap: 10px; align-items: center; }
        .row > * { min-width: 0; }
        .grow { flex: 1; }

        label {
            display: grid;
            gap: 6px;
            color: var(--muted);
            font-size: 12px;
            font-weight: 700;
            text-transform: uppercase;
        }

        input, select, textarea {
            width: 100%;
            border: 1px solid var(--line);
            border-radius: 7px;
            background: #fff;
            color: var(--text);
            padding: 10px 11px;
            outline: none;
        }

        textarea {
            min-height: 96px;
            resize: vertical;
        }

        input:focus, select:focus, textarea:focus {
            border-color: var(--accent);
            box-shadow: 0 0 0 3px rgba(20, 122, 99, .14);
        }

        button {
            border: 0;
            border-radius: 7px;
            background: var(--accent);
            color: #fff;
            cursor: pointer;
            font-weight: 700;
            padding: 10px 12px;
            white-space: nowrap;
        }

        button.secondary {
            background: var(--surface-2);
            color: var(--text);
            border: 1px solid var(--line);
        }

        button.danger {
            background: #fff0f2;
            color: var(--danger);
            border: 1px solid #f2b8c0;
        }

        button:disabled {
            opacity: .55;
            cursor: not-allowed;
        }

        .recipient {
            display: grid;
            gap: 10px;
            padding: 12px 0;
            border-bottom: 1px solid var(--line);
        }

        .recipient:last-child { border-bottom: 0; }
        .jid {
            color: var(--muted);
            font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
            font-size: 12px;
            overflow-wrap: anywhere;
        }

        .pill {
            display: inline-flex;
            align-items: center;
            border-radius: 999px;
            background: var(--surface-2);
            color: var(--muted);
            font-size: 12px;
            font-weight: 700;
            padding: 4px 8px;
        }

        table {
            width: 100%;
            border-collapse: collapse;
        }

        th, td {
            border-bottom: 1px solid var(--line);
            padding: 11px 8px;
            text-align: left;
            vertical-align: top;
        }

        th {
            color: var(--muted);
            font-size: 12px;
            text-transform: uppercase;
        }

        tr:last-child td { border-bottom: 0; }
        .subject { max-width: 420px; overflow-wrap: anywhere; }
        .ok { color: var(--accent-strong); font-weight: 700; }
        .failed { color: var(--danger); font-weight: 700; }
        .ignored { color: var(--warning); font-weight: 700; }
        .empty {
            color: var(--muted);
            padding: 18px;
            text-align: center;
            background: var(--surface-2);
            border-radius: var(--radius);
        }

        @media (max-width: 900px) {
            .stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
            .grid { grid-template-columns: 1fr; }
            .topbar { align-items: flex-start; flex-direction: column; }
            .row { flex-wrap: wrap; }
            table { display: block; overflow-x: auto; white-space: nowrap; }
        }
    </style>
</head>
<body>
    <header>
        <div class="wrap topbar">
            <div>
                <h1>Painel de Notificações Wuzapi</h1>
                <p class="muted">Acompanhamento do webhook Zoho e envios para WhatsApp.</p>
            </div>
            <div class="status" id="status">Carregando...</div>
        </div>
    </header>

    <main class="wrap">
        <section class="stats" id="stats"></section>

        <section class="grid">
            <div class="stack">
                <section class="panel">
                    <div class="panel-head">
                        <h2>Destinatários</h2>
                        <button class="secondary" id="refreshBtn" type="button">Atualizar</button>
                    </div>
                    <div class="panel-body stack">
                        <form class="stack" id="recipientForm">
                            <label>Nome
                                <input name="label" placeholder="Ex: Grupo Projetos">
                            </label>
                            <label>Telefone, JID ou grupo
                                <input name="jid" required placeholder="5573999999999 ou 1203@g.us">
                            </label>
                            <label>Tipo
                                <select name="type">
                                    <option value="phone">Telefone</option>
                                    <option value="group">Grupo</option>
                                    <option value="jid">JID</option>
                                </select>
                            </label>
                            <button type="submit">Cadastrar destinatário</button>
                        </form>
                        <div id="recipients"></div>
                    </div>
                </section>

                <section class="panel">
                    <div class="panel-head"><h2>Envio manual</h2></div>
                    <div class="panel-body">
                        <form class="stack" id="sendForm">
                            <label>Mensagem
                                <textarea name="message" required placeholder="Mensagem para enviar via Wuzapi"></textarea>
                            </label>
                            <label>JIDs extras, separados por vírgula
                                <input name="jids" placeholder="5573999999999, 1203@g.us">
                            </label>
                            <button type="submit">Enviar para ativos</button>
                            <p class="muted">Envia para todos os destinatários ativos e também para os JIDs extras informados.</p>
                        </form>
                    </div>
                </section>
            </div>

            <div class="stack">
                <section class="panel">
                    <div class="panel-head"><h2>Notificações recebidas</h2></div>
                    <div class="panel-body" id="notifications"></div>
                </section>

                <section class="panel">
                    <div class="panel-head"><h2>Últimos envios</h2></div>
                    <div class="panel-body" id="deliveries"></div>
                </section>
            </div>
        </section>
    </main>

    <script>
        const state = { recipients: [] };
        const statusEl = document.querySelector('#status');

        document.querySelector('#refreshBtn').addEventListener('click', loadState);
        document.querySelector('#recipientForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            await request('/api/recipients', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(Object.fromEntries(new FormData(form))),
            });
            form.reset();
            await loadState();
        });

        document.querySelector('#sendForm').addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const payload = Object.fromEntries(new FormData(form));
            await request('/api/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload),
            });
            form.reset();
            await loadState();
        });

        async function loadState() {
            try {
                const data = await request('/api/state');
                state.recipients = data.recipients;
                renderStats(data.stats);
                renderRecipients(data.recipients);
                renderNotifications(data.notifications);
                renderDeliveries(data.deliveries);
                statusEl.textContent = 'Online';
            } catch (error) {
                statusEl.textContent = error.message;
            }
        }

        async function request(url, options) {
            const response = await fetch(url, options);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.message || 'Erro na requisição');
            }

            return data;
        }

        function renderStats(stats) {
            const items = [
                ['Notificações', stats.notifications.total],
                ['Aprovações', stats.approvals.total],
                ['Pendências', stats.projects.total],
                ['Enviadas', stats.sent.total],
                ['Falhas', stats.failed.total],
            ];

            document.querySelector('#stats').innerHTML = items.map(([label, value]) => (
                '<div class="stat"><strong>' + escapeHtml(value) + '</strong><span class="muted">' + escapeHtml(label) + '</span></div>'
            )).join('');
        }

        function renderRecipients(recipients) {
            const target = document.querySelector('#recipients');

            if (!recipients.length) {
                target.innerHTML = '<div class="empty">Nenhum destinatário cadastrado.</div>';
                return;
            }

            target.innerHTML = recipients.map((recipient) => (
                '<div class="recipient">' +
                    '<div class="row">' +
                        '<div class="grow">' +
                            '<h3>' + escapeHtml(recipient.label) + '</h3>' +
                            '<div class="jid">' + escapeHtml(recipient.jid) + '</div>' +
                        '</div>' +
                        '<span class="pill">' + escapeHtml(recipient.type) + '</span>' +
                    '</div>' +
                    '<div class="row">' +
                        '<button class="secondary" type="button" data-toggle="' + recipient.id + '" data-active="' + (recipient.active ? 0 : 1) + '">' + (recipient.active ? 'Desativar' : 'Ativar') + '</button>' +
                        '<button class="danger" type="button" data-delete="' + recipient.id + '">Remover</button>' +
                    '</div>' +
                '</div>'
            )).join('');

            target.querySelectorAll('[data-toggle]').forEach((button) => {
                button.addEventListener('click', async () => {
                    await request('/api/recipients/' + button.dataset.toggle, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ active: button.dataset.active === '1' }),
                    });
                    await loadState();
                });
            });

            target.querySelectorAll('[data-delete]').forEach((button) => {
                button.addEventListener('click', async () => {
                    await request('/api/recipients/' + button.dataset.delete, { method: 'DELETE' });
                    await loadState();
                });
            });
        }

        function renderNotifications(notifications) {
            const target = document.querySelector('#notifications');

            if (!notifications.length) {
                target.innerHTML = '<div class="empty">Nenhuma notificação recebida ainda.</div>';
                return;
            }

            target.innerHTML = '<table><thead><tr><th>Data</th><th>Tipo</th><th>Assunto</th><th>Origem</th></tr></thead><tbody>' +
                notifications.map((item) => (
                    '<tr>' +
                        '<td>' + escapeHtml(formatDate(item.created_at)) + '</td>' +
                        '<td class="' + typeClass(item.type) + '">' + escapeHtml(typeLabel(item.type)) + '</td>' +
                        '<td class="subject">' + escapeHtml(item.subject || '-') + '</td>' +
                        '<td>' + escapeHtml(item.from_address || item.source || '-') + '</td>' +
                    '</tr>'
                )).join('') +
                '</tbody></table>';
        }

        function renderDeliveries(deliveries) {
            const target = document.querySelector('#deliveries');

            if (!deliveries.length) {
                target.innerHTML = '<div class="empty">Nenhum envio registrado ainda.</div>';
                return;
            }

            target.innerHTML = '<table><thead><tr><th>Data</th><th>Status</th><th>JID</th><th>Mensagem</th></tr></thead><tbody>' +
                deliveries.map((item) => (
                    '<tr>' +
                        '<td>' + escapeHtml(formatDate(item.created_at)) + '</td>' +
                        '<td class="' + (item.status === 'sent' ? 'ok' : 'failed') + '">' + escapeHtml(item.status) + '</td>' +
                        '<td class="jid">' + escapeHtml(item.jid) + '</td>' +
                        '<td class="subject">' + escapeHtml(item.message) + '</td>' +
                    '</tr>'
                )).join('') +
                '</tbody></table>';
        }

        function typeLabel(type) {
            return {
                approval: 'Aprovação',
                project_notification: 'Pendência',
                ignored: 'Ignorada',
                manual: 'Manual',
            }[type] || type;
        }

        function typeClass(type) {
            if (type === 'ignored') return 'ignored';
            if (type === 'manual') return 'ok';
            return 'ok';
        }

        function formatDate(value) {
            return new Intl.DateTimeFormat('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
            }).format(new Date(value.replace(' ', 'T') + 'Z'));
        }

        function escapeHtml(value) {
            return String(value)
                .replaceAll('&', '&amp;')
                .replaceAll('<', '&lt;')
                .replaceAll('>', '&gt;')
                .replaceAll('"', '&quot;')
                .replaceAll("'", '&#039;');
        }

        loadState();
        setInterval(loadState, 15000);
    </script>
</body>
</html>`
}
