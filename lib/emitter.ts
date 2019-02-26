import { LogType, commonLogger, LogLevel } from './common'
import { CoreClass, CoreOptions, CoreStats } from './core'
import { PanCloudError } from './error'
import { MacCorrelator, CorrelatedEvent, CorrelationStats } from './l2correlator'
import { EventEmitter } from 'events'
import { Util } from './util'

const EVENT_EVENT = 'EVENT_EVENT'
const PCAP_EVENT = 'PCAP_EVENT'
const CORR_EVENT = 'CORR_EVENT'
type EventTypes = typeof EVENT_EVENT | typeof PCAP_EVENT | typeof CORR_EVENT

/**
 * coreClass supports "async operations". In this mode, events received by the Framework will be send to its
 * subscribers. Emitted events will be conformant to this interface.
 */
export interface EmitterInterface<T> {
    /**
     * The source of the event. It might be the string **EventService** in the case of events comming from
     * the Event Service or the JOB ID in the case of events comming from a **LoggingService.query()** invocation
     */
    source: string,
    /**
     * The type of events contained in the message
     */
    logType?: LogType,
    /**
     * The content itself. Its type varies based on the topic
     */
    message?: T
}

/**
 * Structure of a L2/L3 correlation event
 */
export interface L2correlation {
    /**
     * value of the **time_generated** attribute of the event that triggered a successfull correlation
     */
    time_generated: string,
    /**
     * value of the **sessionid** attribute that matched in the L2 and L3 events
     */
    sessionid: string,
    /**
     * Source IP
     */
    src: string,
    /**
     * Destination IP
     */
    dst: string,
    /**
     * Source MAC of the packet as _seen_ from the PANOS device. It might not be the real MAC of the device
     * using the IP (i.e. if a L3 hop exists)
     */
    "extended-traffic-log-mac": string
    /**
     * Destination MAC of the packet as _seen_ from the PANOS device. It might not be the real MAC of the device
     * using the IP (i.e. if a L3 hop exists)
     */
    "extended-traffic-log-mac-stc": string
}

/**
 * Runtime statistics generated by the Emitter class
 */
export interface EmitterStats extends CoreStats {
    /**
     * Number of events emitted in the **EVENT_EVENT** topic
     */
    eventsEmitted: number,
    /**
     * Number of events emitted in the **PCAP_EVENT** topic
     */
    pcapsEmitted: number,
    /**
     * Number of events emitted in the **CORR_EVENT** topic
     */
    correlationEmitted: number
    /**
     * If present, it will contain runtime statistics from the L2/L3 correlation engine
     */
    correlationStats?: CorrelationStats
}

/**
 * Options for the Emitter class factory
 */
export interface EmitterOptions extends CoreOptions {
    /**
     * Allows the same event receiver to be registered multiple times. It defaults to **false** wich means
     * that if the same event receiver is registered multiple times then only one copy of the events will be sent.
     */
    allowDup?: boolean,
    /**
     * If provided, it will instantiate a L2/L3 stream-based correlation engine. For the engine to work,
     * the ES Filter must match, at least, _extended-application-log_ events from panw.dpi for L2 data and 
     * either panw.traffic or panw.threat for L3 data
     */
    l2Corr?: {
        /**
         * The amount of seconds events are kept in the correlation buffer waiting for a correlation to happen.
         * Defaults to 120 seconds
         */
        timeWindow?: number
        /**
         * Whether absolute (_Date.now()_) or relative time (from stream of events coming in) must be used to
         * consider a match valid. It defaults to **false**
         */
        absoluteTime?: boolean
        /**
         * The L2 correlation engines uses a lame garbage collector that may kick in each time a new event
         * is sent for correlation. If you expect a low rate of events then you can use the default value
         * of **0** meaning the garbage collector is invoked for each new event. A value of _10_, for instance
         * would mean that the gargabe collector is invoked after 10 ingested events.
         */
        gcMultiplier?: number
    }
}

export class Emitter extends CoreClass {
    protected emitter: EventEmitter
    private allowDupReceiver: boolean
    private notifier: { [event: string]: boolean }
    protected l2enable: boolean
    protected l2engine: MacCorrelator
    public className: string
    protected stats: EmitterStats

    protected constructor(baseUrl: string, ops: EmitterOptions) {
        super(baseUrl, ops)
        this.className = "emitterClass"
        this.allowDupReceiver = (ops.allowDup == undefined) ? false : ops.allowDup
        this.newEmitter()
        if (ops.level != undefined && ops.level != LogLevel.INFO) {
            commonLogger.level = ops.level
        }
        this.stats = {
            correlationEmitted: 0,
            eventsEmitted: 0,
            pcapsEmitted: 0,
            ...this.stats
        }
        if (ops.l2Corr) {
            this.l2enable = true
            this.l2engine = new MacCorrelator(
                ops.l2Corr.timeWindow,
                ops.l2Corr.absoluteTime,
                ops.l2Corr.gcMultiplier)
            this.stats.correlationStats = this.l2engine.stats
        } else {
            this.l2enable = false
        }
    }

    private registerListener(event: EventTypes, l: (...args: any[]) => void): boolean {
        if (this.allowDupReceiver || !this.emitter.listeners(event).includes(l)) {
            this.emitter.on(event, l)
            this.notifier[event] = true
            return true
        }
        return false
    }

    private unregisterListener(event: EventTypes, l: (...args: any[]) => void): void {
        this.emitter.removeListener(event, l)
        this.notifier[event] = (this.emitter.listenerCount(event) > 0)
    }

    /**
     * Registers a client to the **EVENT_EVENT** topic
     * @param listener function that will be provided to the **EventEmitter.on()** method and that will
     * receive events comming from the Application Framework
     * @returns the value _true_ if the listener is indeed registered. _false_ in case the
     * listener has already been registered and the factory option **allowDupReceiver** was
     * not set to _true_
     */
    protected registerEventListener(listener: (e: EmitterInterface<any[]>) => void): boolean {
        return this.registerListener(EVENT_EVENT, listener)
    }

    /**
     * Unregisters the listener from the **EVENT_EVENT** topic
     * @param listener 
     */
    protected unregisterEventListener(listener: (e: EmitterInterface<any[]>) => void): void {
        this.unregisterListener(EVENT_EVENT, listener)
    }

    /**
     * Registers a client to the **PCAP_EVENT** topic
     * @param listener function that will be provided to the **EventEmitter.on()** method and that will
     * receive *Buffer* instances containing a valid _libPcap_ file body for each received record
     * containing a valid value in the _pcap_ property.
     * @returns the value _true_ if the listener is indeed registered. _false_ in case the
     * listener has already been registered and the factory option **allowDupReceiver** was
     * not set to _true_
     */
    protected registerPcapListener(listener: (e: EmitterInterface<Buffer>) => void): boolean {
        return this.registerListener(PCAP_EVENT, listener)
    }

    /**
     * Unregisters the listener from the **PCAP_EVENT** topic
     * @param listener 
     */
    protected unregisterPcapListener(listener: (e: EmitterInterface<Buffer>) => void): void {
        this.unregisterListener(PCAP_EVENT, listener)
    }

    /**
     * Registers a client to the **CORR_EVENT** topic
     * @param listener function that will be provided to the **EventEmitter.on()** method and that will
     * receive **L2correlation** instances containing a valid _libPcap_ file body for each received record
     * containing a valid value in the _pcap_ property.
     * @returns the value _true_ if the listener is indeed registered. _false_ in case the
     * listener has already been registered and the factory option **allowDupReceiver** was
     * not set to _true_
     */
    protected registerCorrListener(listener: (e: EmitterInterface<L2correlation[]>) => void): boolean {
        return this.registerListener(CORR_EVENT, listener)
    }

    /**
     * Unregisters the listener from the **PCAP_EVENT** topic
     * @param listener 
     */
    protected unregisterCorrListener(listener: (e: EmitterInterface<L2correlation[]>) => void): void {
        this.unregisterListener(CORR_EVENT, listener)
    }

    protected newEmitter(
        ee?: (e: EmitterInterface<any[]>) => void,
        pe?: (arg: EmitterInterface<Buffer>) => void,
        ce?: (e: EmitterInterface<L2correlation[]>) => void) {
        this.emitter = new EventEmitter()
        this.emitter.on('error', (err) => {
            commonLogger.error(PanCloudError.fromError(this, err))
        })
        this.notifier = { EVENT_EVEN: false, PCAP_EVENT: false, CORRELATION_EVENT: false }
        if (ee) {
            this.registerEventListener(ee)
        }
        if (pe) {
            this.registerPcapListener(pe)
        }
        if (ce) {
            this.registerCorrListener(ce)
        }
    }

    protected emitMessage(e: EmitterInterface<any[]>): void {
        if (this.notifier[PCAP_EVENT]) {
            this.emitPcap(e)
        }
        let epkg = [e]
        let correlated: EmitterInterface<CorrelatedEvent[]> | undefined
        if (this.l2enable) {
            ({ plain: epkg, correlated } = this.l2engine.process(e))
            if (this.notifier[CORR_EVENT] && correlated) {
                this.emitCorr(correlated)
            }
        }
        if (this.notifier[EVENT_EVENT]) {
            if (correlated) {
                this.emitEvent(correlated)
            }
            epkg.forEach(x => this.emitEvent(x))
        }
    }

    private emitEvent(e: EmitterInterface<any[]>): void {
        if (e.message) {
            this.stats.eventsEmitted += e.message.length
        }
        this.emitter.emit(EVENT_EVENT, e)
    }

    private emitPcap(e: EmitterInterface<any[]>): void {
        let message: EmitterInterface<Buffer> = {
            source: e.source,
        }
        if (e.message) {
            e.message.forEach(x => {
                let pcapBody = Util.pcaptize(x)
                if (pcapBody) {
                    this.stats.pcapsEmitted++
                    message.message = pcapBody
                    this.emitter.emit(PCAP_EVENT, message)
                }
            })
        } else {
            this.emitter.emit(PCAP_EVENT, message)
        }
    }

    private emitCorr(e: EmitterInterface<CorrelatedEvent[]>): void {
        if (e.message) {
            this.stats.correlationEmitted += e.message.length
        }
        if (e.message) {
            this.emitter.emit(CORR_EVENT, {
                source: e.source,
                logType: e.logType,
                message: e.message.map(x => <L2correlation>{
                    time_generated: x.time_generated,
                    sessionid: x.sessionid,
                    src: x.src,
                    dst: x.src,
                    "extended-traffic-log-mac": x["extended-traffic-log-mac"],
                    "extended-traffic-log-mac-stc": x["extended-traffic-log-mac-stc"]
                })
            })
        }
    }

    public l2CorrFlush(): void {
        if (this.l2enable) {
            let { plain } = this.l2engine.flush()
            if (this.notifier[EVENT_EVENT]) { plain.forEach(x => this.emitEvent(x)) }
            commonLogger.info(this, "Flushed the L3/L2 Correlation engine DB", "CORRELATION")
        }
    }
}