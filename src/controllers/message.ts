import { isAxiosError } from "axios";
import log from "../log";
import request from './axios'

class Messages {
    message: string;
    remoteJid: string;
    notifyAll: boolean;
    instance?: string

    constructor(message: string, remoteJid: string, notifyAll: boolean, instance?: string) {
        this.message = message;
        this.remoteJid = remoteJid;
        this.notifyAll = notifyAll ? true : false,
        this.instance = typeof instance == 'undefined' ? 'instancia' : instance
    }

    public async sendMessage() {
        try {

            const message = `${this.message}\n\n🤖 Essa é uma mensagem automática 🤖`

            const options =
            {
                number: this.remoteJid,
                text: message,
                options: {
                    delay: 5000,
                    presence: "composing",
                    linkPreview: true,
                    mentions: {
                        everyOne: true
                    }
                },
                textMessage: {
                    text: message
                }
            };

            const result = await request.post(`/${this.instance ?? "instancia"}`, options)

            log.debug(result.data)
        } catch (error) {
            if (isAxiosError(error)) {
                log.fatal(error.response?.data)
            }
            // log.fatal(error)
        }
    }
}

export default Messages