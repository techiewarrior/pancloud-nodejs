import { autoCredentials, DirectorySyncService, LogLevel } from 'pancloud-nodejs'

const entryPoint = "https://api.us.paloaltonetworks.com"

export async function main(): Promise<void> {
    let c = await autoCredentials()
    let dss = await DirectorySyncService.factory(c)
    let users = await dss.query('users')
    console.log(`Sucessfully Received ${users.count} user objects`)
    users.result.forEach(x => {
        console.log(`Domain: ${x.domainName}\n---`)
        console.log(JSON.stringify(x, undefined, ' '))
    })
    console.log(`Page Number: ${users.pageNumber}`)
    console.log(`Page Size: ${users.pageSize}`)
    if (users.unreadResults) { console.log(`Unread Results: ${users.unreadResults}`) }
}