import express, { Request, Response } from 'express'
import log from './log'
import Messages from './controllers/message';
import { Aprovation, NotificationProject, webhook } from './controllers/zod';
import { configDotenv } from "dotenv";

configDotenv()

const app = express()

app.use(express.json());

app.get('/', (req: Request, res: Response) => {
    res.status(200).json({ message: 'Servidor online' })
});

app.post('/notificate', async (req: Request, res: Response) => {
    res.status(200).json({ message: 'Notificação recebida' })
    try {
        const INSTANCE = process.env.EVOLUTION_INSTANCE || "sua-instancia"
        const remoteJids = (process.env.EVOLUTION_REMOTEJID || "5573935050217")
            .split(',')
            .map((jid) => jid.trim())
            .filter(Boolean)

        log.debug("Novo Email recebido")
        const body: webhook = req.body

        // Verificar se é dos bombeiros
        if (body.fromAddress !== 'naoresponder@cbm.ba.gov.br') {
            log.trace("Mas não é do corpo de bombeiros")
            return res.status(200).json({ sucess: true, message: "Recebido" })
        }

        let matched = false

        if (Aprovation.safeParse(body.subject).success) {
            matched = true
            log.trace("É Aprovação")
            await Promise.all(remoteJids.map((jid) => {
                const notificar = new Messages("🎉 Nova Aprovação no Fênix", jid, true, INSTANCE)
                return notificar.sendWuzapiMessage(process.env.WUZAPI_TOKEN!, jid, "🎉 Nova Aprovação no Fênix")
            }))
        } else if (NotificationProject.safeParse(body.subject).success) {
            matched = true
            log.trace("É Notificação de Projeto, enviando notificação")
            await Promise.all(remoteJids.map((jid) => {
                const notificar = new Messages("❗ Projeto Notificado - Verificar no Fênix", jid, true, INSTANCE)
                return notificar.sendWuzapiMessage(process.env.WUZAPI_TOKEN!, jid, "❗ Projeto Notificado - Verificar no Fênix")
            }))
        } else {
            log.trace("Assunto não corresponde a nenhum filtro")
        }

    } catch (error) {
        log.error(error)
    }
})

app.listen(4000, () => {
    log.debug("App running in port 4000")
})