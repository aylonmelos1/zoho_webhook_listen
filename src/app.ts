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
    try {
        const INSTANCE = process.env.EVOLUTION_INSTANCE || "sua-instancia"
        const REMOTEJID = process.env.EVOLUTION_REMOTEJID || "5573935050217"
        // res.status(200).json({sucess: true})
        log.debug("Novo Email recebido")
        const body: webhook = req.body

        // Verificar se é dos bombeiros
        if (body.fromAddress !== 'naoresponder@cbm.ba.gov.br') {
            res.status(200).json({ sucess: true, message: "Recebido" })
            log.trace("Mas não é do corpo de bombeiros")
            return
        }

        let email = Aprovation.safeParse(body.subject)

        if (email.success) {
            res.status(200).json({ sucess: true, message: "Recebido" })
            log.trace("É Aprovação")
            const notificar = new Messages("🎉 Nova Aprovação no Fênix", REMOTEJID, true, INSTANCE)
            notificar.sendMessage()
            return
        }

        email = NotificationProject.safeParse(body.subject)

        if (email.success) {
            res.status(200).json({ sucess: true, message: "Recebido" })
            log.trace("É Notificação de Projeto, enviando notificação")
            const notificar = new Messages("❗ Projeto Notificado - Verificar no Fênix", REMOTEJID, true, INSTANCE)
            notificar.sendMessage()
            return
        }

    } catch (error) {
        log.error(error)
    }
})

app.listen(4000, () => {
    log.debug("App running in port 4000")
})