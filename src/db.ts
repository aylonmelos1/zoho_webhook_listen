import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const dbPath = process.env.SQLITE_PATH || join(process.cwd(), 'data', 'notifications.sqlite')

mkdirSync(dirname(dbPath), { recursive: true })

const db = new DatabaseSync(dbPath)

db.exec(`
    PRAGMA journal_mode = WAL;

    CREATE TABLE IF NOT EXISTS recipients (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        label TEXT NOT NULL,
        jid TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL DEFAULT 'phone',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source TEXT NOT NULL DEFAULT 'zoho',
        type TEXT NOT NULL DEFAULT 'ignored',
        subject TEXT,
        sender TEXT,
        from_address TEXT,
        to_address TEXT,
        received_time TEXT,
        message_id TEXT,
        payload TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS deliveries (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        notification_id INTEGER,
        recipient_id INTEGER,
        jid TEXT NOT NULL,
        message TEXT NOT NULL,
        status TEXT NOT NULL,
        response TEXT,
        error TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        FOREIGN KEY(notification_id) REFERENCES notifications(id),
        FOREIGN KEY(recipient_id) REFERENCES recipients(id)
    );
`)

export type Recipient = {
    id: number
    label: string
    jid: string
    type: string
    active: number
    created_at: string
}

export type NotificationRecord = {
    id: number
    source: string
    type: string
    subject: string | null
    sender: string | null
    from_address: string | null
    to_address: string | null
    received_time: string | null
    message_id: string | null
    payload: string
    created_at: string
}

export type DeliveryRecord = {
    id: number
    notification_id: number | null
    recipient_id: number | null
    jid: string
    message: string
    status: string
    response: string | null
    error: string | null
    created_at: string
}

export function seedRecipientsFromEnv(remoteJids: string[]) {
    const insert = db.prepare(`
        INSERT OR IGNORE INTO recipients (label, jid, type)
        VALUES (?, ?, ?)
    `)

    for (const jid of remoteJids) {
        insert.run(`Contato ${jid}`, jid, guessRecipientType(jid))
    }
}

export function listRecipients(includeInactive = false): Recipient[] {
    const sql = includeInactive
        ? `SELECT * FROM recipients ORDER BY active DESC, label COLLATE NOCASE ASC`
        : `SELECT * FROM recipients WHERE active = 1 ORDER BY label COLLATE NOCASE ASC`

    return db.prepare(sql).all() as Recipient[]
}

export function createRecipient(input: { label: string, jid: string, type?: string }): Recipient {
    const label = input.label.trim() || input.jid.trim()
    const jid = input.jid.trim()
    const type = input.type?.trim() || guessRecipientType(jid)

    const result = db.prepare(`
        INSERT INTO recipients (label, jid, type)
        VALUES (?, ?, ?)
    `).run(label, jid, type)

    return db.prepare(`SELECT * FROM recipients WHERE id = ?`).get(result.lastInsertRowid) as Recipient
}

export function updateRecipientStatus(id: number, active: boolean) {
    db.prepare(`UPDATE recipients SET active = ? WHERE id = ?`).run(active ? 1 : 0, id)
}

export function deleteRecipient(id: number) {
    db.prepare(`DELETE FROM recipients WHERE id = ?`).run(id)
}

export function createNotification(input: {
    source?: string
    type: string
    subject?: string | null
    sender?: string | null
    fromAddress?: string | null
    toAddress?: string | null
    receivedTime?: string | null
    messageId?: string | null
    payload: unknown
}): NotificationRecord {
    const result = db.prepare(`
        INSERT INTO notifications (
            source, type, subject, sender, from_address, to_address,
            received_time, message_id, payload
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
        input.source || 'zoho',
        input.type,
        input.subject || null,
        input.sender || null,
        input.fromAddress || null,
        input.toAddress || null,
        input.receivedTime || null,
        input.messageId || null,
        JSON.stringify(input.payload),
    )

    return db.prepare(`SELECT * FROM notifications WHERE id = ?`).get(result.lastInsertRowid) as NotificationRecord
}

export function createDelivery(input: {
    notificationId?: number | null
    recipientId?: number | null
    jid: string
    message: string
    status: string
    response?: unknown
    error?: unknown
}) {
    db.prepare(`
        INSERT INTO deliveries (
            notification_id, recipient_id, jid, message, status, response, error
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
        input.notificationId || null,
        input.recipientId || null,
        input.jid,
        input.message,
        input.status,
        typeof input.response === 'undefined' ? null : JSON.stringify(input.response),
        typeof input.error === 'undefined' ? null : stringifyError(input.error),
    )
}

export function listNotifications(limit = 50): NotificationRecord[] {
    return db.prepare(`
        SELECT * FROM notifications
        ORDER BY id DESC
        LIMIT ?
    `).all(limit) as NotificationRecord[]
}

export function listDeliveries(limit = 80): DeliveryRecord[] {
    return db.prepare(`
        SELECT * FROM deliveries
        ORDER BY id DESC
        LIMIT ?
    `).all(limit) as DeliveryRecord[]
}

export function getStats() {
    return {
        notifications: db.prepare(`SELECT COUNT(*) AS total FROM notifications`).get() as { total: number },
        approvals: db.prepare(`SELECT COUNT(*) AS total FROM notifications WHERE type = 'approval'`).get() as { total: number },
        projects: db.prepare(`SELECT COUNT(*) AS total FROM notifications WHERE type = 'project_notification'`).get() as { total: number },
        sent: db.prepare(`SELECT COUNT(*) AS total FROM deliveries WHERE status = 'sent'`).get() as { total: number },
        failed: db.prepare(`SELECT COUNT(*) AS total FROM deliveries WHERE status = 'failed'`).get() as { total: number },
    }
}

function guessRecipientType(jid: string) {
    if (jid.includes('@g.us') || jid.toLowerCase().includes('group')) {
        return 'group'
    }

    if (jid.includes('@')) {
        return 'jid'
    }

    return 'phone'
}

function stringifyError(error: unknown) {
    if (error instanceof Error) {
        return error.message
    }

    return String(error)
}

export default db
