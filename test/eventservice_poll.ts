import { autoCredentials, EventService, LogLevel } from 'pancloud-nodejs'

/**
 * Use the enventservice.js launcher to call this main() function
 */
export async function main(): Promise<void> {
    let c = await autoCredentials()
    let es = await EventService.factory(c)
    let t = await es.poll()
    t.forEach(e => {
        console.log(`Event Type: ${e.logType}, Record Count: ${e.event.length}`)
        console.log(`First Event\n${JSON.stringify(e.event[0])}`)
    })
}
