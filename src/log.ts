// src/log.ts

import { Logger, ILogObj } from "tslog";

const log: Logger<ILogObj> = new Logger({
    prettyLogTimeZone: 'local',
    type: 'pretty'
})

export default log