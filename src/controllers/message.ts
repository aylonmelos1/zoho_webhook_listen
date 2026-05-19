import { isAxiosError } from "axios";
import log from "../log";
import request from './axios'

interface WuzapiMessage {
    "Phone": string,
    "Body": string
}

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

    public async sendWuzapiMessage(instanceToken: string, remoteJid: string, message: string) {
    const url = `https://wuzapi.abaincendio.com.br/chat/send/text`;
    const payload: WuzapiMessage = {
        Phone: remoteJid,
        Body: message,
    };

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'token': instanceToken,
            },
            body: JSON.stringify(payload),
        });

        const text = await response.text();
        const data = text ? parseResponse(text) : {};

        if (!response.ok) {
            throw new Error(`Wuzapi returned ${response.status}: ${text}`);
        }

        log.debug(`Message sent to ${remoteJid}: ${message}`);
        return data;
    } catch (error) {
        log.error('Error sending Wuzapi message:', error);
        throw error;
    }
}

    public async sendEvoMessage() {
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

function parseResponse(text: string) {
    try {
        return JSON.parse(text)
    } catch {
        return { raw: text }
    }
}
