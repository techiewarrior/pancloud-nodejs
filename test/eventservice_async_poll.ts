import { autoCredentials, EventService, EsFilterBuilderCfg, EmitterInterface, LogLevel } from 'pancloud-nodejs'

let builderCfg: EsFilterBuilderCfg = {
    filter: [
        { table: "panw.traffic", timeout: 1000 },
        { table: "panw.dpi", timeout: 1000 },
        { table: "panw.threat", where: 'where risk-of-app > 3' }],
    filterOptions: {
        callBack: {
            event: receiver
        },
        poolOptions: {
            ack: true,
            pollTimeout: 1000
        }
    }
}

/**
 * Use the enventservice.js launcher to call this main() function
 */
export async function main(): Promise<void> {
    let c = await autoCredentials()
    let es = await EventService.factory(c)
    await es.filterBuilder(builderCfg)
    console.log("Set the filter and registered the async event receiver")
    await new Promise<void>(resolve => {
        setTimeout(() => {
            console.log('\n1 minute timer expired. Pausing the poller')
            es.pause()
            resolve()
        }, 60000)
    })
    await es.clearFilter(true)
    console.log("Cleared the filter and flushed the channel")
    console.log("Event Service stats")
    console.log(JSON.stringify(es.getEsStats(), undefined, " "))
}

let lType = ""
let eventCounter = 0

function receiver(e: EmitterInterface<any[]>): void {
    if (e.logType && e.logType != lType) {
        lType = e.logType
        console.log(`\nReceiving: Event Type: ${lType} from ${e.source}`)
    }
    if (e.message) {
        eventCounter += e.message.length
    }
    process.stdout.write(`${eventCounter}...`)
}