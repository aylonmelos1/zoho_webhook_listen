import axios from "axios";
import { configDotenv } from "dotenv";

configDotenv()

const APIKEY = process.env.EVOLUTION_API_KEY || 'apikey'
const DOMAIN = process.env.EVOLUTION_DOMAIN || 'seudomain.com.br'

const request = axios.create({
    baseURL: `https://${DOMAIN}/message/sendText/`,
    headers: {
        apikey: APIKEY,
        "Content-Type": 'application/json'
    }
})

export default request