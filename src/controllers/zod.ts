import { z } from 'zod'

const Webhook = z.object({
    sender: z.string(),
    subject: z.string(),
    receivedTime: z.string(),
    messageId: z.string(),
    fromAddress: z.string().email(),
    html: z.string(),
    toAddress: z.string().email()
})

export type webhook = z.infer<typeof Webhook>

const Aprovation = z.string().includes('Confirmação de Aprovação')

const NotificationProject = z.string().includes('Notificação de Pendência')

export { Aprovation, Webhook, NotificationProject}