import { EmitterInterface } from "./emitter"
import { LOGTYPE } from "./common"

interface Event {
    time_generated: string
    sessionid: string
}

function isEvent(x: any): x is Event {
    return ('time_generated' in x) && ('sessionid' in x)
}

interface L3event extends Event {
    src: string
    dst: string
}

function isL3Event(x: any): x is L3event {
    return isEvent(x) && ('src' in x) && ('dst' in x)
}

interface L2event extends Event {
    "extended-traffic-log-mac": string
    "extended-traffic-log-mac-stc": string
}

function isL2Event(x: any): x is L2event {
    return isEvent(x) && ('extended-traffic-log-mac' in x) && ('extended-traffic-log-mac-stc' in x)
}

export type CorrelatedEvent = L2event & L3event

export interface ProcResponse {
    plain: EmitterInterface<any[]>[]
    correlated?: EmitterInterface<CorrelatedEvent[]>
}

interface DbItem {
    ts: number
    element: Event
    meta: {
        source: string
        logType?: LOGTYPE
    }
}

export interface CorrelationStats {
    agedOut: number,
    dbWaterMark: number,
    dbInserts: number,
    discardedEvents: number
}

export class MacCorrelator {
    private ageout: number
    private absoluteTime: boolean
    private gbMultiplier: number
    private gbAttempt: number
    private db: DbItem[]
    private lastTs: number
    stats: CorrelationStats

    constructor(ageout = 120, absoluteTime = false, gbMultiplier = 0) {
        this.ageout = ageout
        this.absoluteTime = absoluteTime
        this.gbAttempt = 0
        this.gbMultiplier = gbMultiplier
        this.db = []
        this.lastTs = 0
        this.stats = {
            agedOut: 0,
            dbWaterMark: 0,
            dbInserts: 0,
            discardedEvents: 0
        }
    }

    private gb(): DbItem[] | null {
        this.gbAttempt++
        if (this.gbAttempt > this.gbMultiplier) {
            this.gbAttempt = 0
            let fromTs = this.lastTs
            if (this.absoluteTime) {
                fromTs = Math.floor(Date.now() / 1000)
            }
            fromTs = fromTs - this.ageout
            let pointer = 0
            this.db.sort((a, b) => a.ts - b.ts).every((x, i) => {
                pointer = i
                return x.ts < fromTs
            })
            if (pointer) {
                let collected = this.db.slice(0, pointer)
                this.db = this.db.slice(pointer)
                this.stats.agedOut += collected.length
                return collected
            }
        }
        return null
    }

    private update(dbI: DbItem): { noncorr?: DbItem[], corr?: DbItem } | null {
        if (this.db.length > this.stats.dbWaterMark) {
            this.stats.dbWaterMark = this.db.length
        }
        let correlatedEvent: L2event & L3event
        if (dbI.ts > this.lastTs) {
            this.lastTs = dbI.ts
        }
        let collectedItems = this.gb()
        if (dbI.ts < this.lastTs - this.ageout) {
            if (collectedItems) {
                return { noncorr: collectedItems.concat(dbI) }
            }
            return { noncorr: [dbI] }
        }
        let matchIdx = this.db.findIndex(x => x.element.sessionid == dbI.element.sessionid)
        if (matchIdx == -1) {
            this.db.push(dbI)
            this.stats.dbInserts++
            if (collectedItems) {
                return { noncorr: collectedItems }
            }
            return null
        }
        let matchedElement = this.db[matchIdx]
        if (isL2Event(matchedElement.element)) {
            if (isL3Event(dbI.element)) {
                correlatedEvent = {
                    ...dbI.element,
                    "extended-traffic-log-mac": matchedElement.element["extended-traffic-log-mac"],
                    "extended-traffic-log-mac-stc": matchedElement.element["extended-traffic-log-mac-stc"]
                }
                dbI.element = correlatedEvent
                this.db.splice(matchIdx, 1)
                if (collectedItems) {
                    return { noncorr: collectedItems.concat(matchedElement), corr: dbI }
                } else {
                    return { noncorr: [matchedElement], corr: dbI }
                }
            }
        }
        if (isL3Event(matchedElement.element)) {
            if (isL2Event(dbI.element)) {
                correlatedEvent = {
                    ...matchedElement.element,
                    "extended-traffic-log-mac": dbI.element["extended-traffic-log-mac"],
                    "extended-traffic-log-mac-stc": dbI.element["extended-traffic-log-mac-stc"]
                }
                matchedElement.element = correlatedEvent
                this.db.splice(matchIdx, 1)
                if (collectedItems) {
                    return { noncorr: collectedItems.concat(dbI), corr: matchedElement }
                } else {
                    return { noncorr: [dbI], corr: matchedElement }
                }
            }
        }
        if (collectedItems) {
            return { noncorr: collectedItems.concat(dbI) }
        }
        return { noncorr: [dbI] }
    }

    public process(e: EmitterInterface<any[]>): ProcResponse {
        if (e.message) {
            let plainResponse: { [i: string]: EmitterInterface<any[]> } = {}
            let corrResponse: EmitterInterface<CorrelatedEvent[]> | undefined
            plainResponse[e.source] = { source: e.source, logType: e.logType, message: [] }
            e.message.forEach(x => {
                if (isEvent(x)) {
                    let ts = parseInt(x.time_generated, 10)
                    if (!isNaN(ts)) {
                        let updateResp = this.update({
                            ts: ts,
                            element: x,
                            meta: {
                                source: e.source,
                                logType: e.logType
                            }
                        })
                        if (updateResp !== null) {
                            if (updateResp.noncorr) {
                                updateResp.noncorr.forEach(y => {
                                    if (y.meta.source in plainResponse) {
                                        plainResponse[y.meta.source].message!.push(y)
                                    } else {
                                        plainResponse[y.meta.source] = {
                                            source: y.meta.source,
                                            logType: y.meta.logType,
                                            message: [y]
                                        }
                                    }
                                })
                            }
                            if (updateResp.corr) {
                                if (corrResponse) {
                                    corrResponse.message!.push(updateResp.corr.element as CorrelatedEvent)
                                } else {
                                    corrResponse = {
                                        source: e.source,
                                        logType: e.logType,
                                        message: [updateResp.corr.element as CorrelatedEvent]
                                    }
                                }
                            }
                        }
                        return
                    }
                }
                this.stats.discardedEvents++
                plainResponse[e.source].message!.push(x)
            })
            if (corrResponse) {
                return { plain: Object.values(plainResponse), correlated: corrResponse }
            }
            return { plain: Object.values(plainResponse) }
        }
        return { plain: [e] }
    }

    public flush(): ProcResponse {
        let mapped: { [key: number]: EmitterInterface<any[]> } = this.db.reduce(
            (acc: { [key: string]: EmitterInterface<any[]> }, item) => {
                if (item.meta.source in acc) {
                    acc[item.meta.source].message!.push(item.element)
                } else {
                    acc[item.meta.source] = { source: item.meta.source, logType: item.meta.logType, message: [item.element] }
                }
                return acc
            }, {})
        this.db = []
        return { plain: Object.values(mapped) }
    }
}