/**
 * Provides common resources for other modules in the pancloud SDK
 */
import { SdkErr } from './error';
/**
 * A pancloud class must provide a className property that will be used to format its log messages
 */
export interface PancloudClass {
    className: string;
}
export declare enum LogLevel {
    DEBUG = 0,
    INFO = 1,
    ALERT = 2,
    ERROR = 3
}
/**
 * User-provided logger classes are supported as long as they adhere to this interface
 */
export interface PancloudLogger {
    level: LogLevel;
    error(e: SdkErr): void;
    alert(source: PancloudClass, message: string, name?: string): void;
    info(source: PancloudClass, message: string, name?: string): void;
    debug(source: PancloudClass, message: string, name?: string, payload?: any): void;
}
declare const LTYPES: {
    "panw.auth": string;
    "panw.config": string;
    "panw.dpi": string;
    "panw.dpi_hipreport": string;
    "panw.dpi_stats": string;
    "panw.gtp": string;
    "panw.gtpsum": string;
    "panw.hipmatch": string;
    "panw.sctp": string;
    "panw.sctpsum": string;
    "panw.system": string;
    "panw.threat": string;
    "panw.thsum": string;
    "panw.traffic": string;
    "panw.trsum": string;
    "panw.urlsum": string;
    "panw.userid": string;
    "tms.analytics": string;
    "tms.config": string;
    "tms.system": string;
    "tms.threat": string;
    "tms.traps": string;
};
/**
 * Convenience type to guide the developer using the right entry points
 */
export declare type EntryPoint = 'https://api.eu.paloaltonetworks.com' | 'https://api.us.paloaltonetworks.com';
export declare const region2EntryPoint: {
    [region: string]: EntryPoint;
};
export declare type OAUTH2SCOPE = 'logging-service:read' | 'logging-service:write' | 'event-service:read' | 'directory-sync-service:read';
export declare type ApiPath = "event-service/v1/channels" | "logging-service/v1" | "directory-sync-service/v1";
/**
 * Convenience type to guide the developer using the common log types
 */
export declare type LogType = keyof typeof LTYPES;
export declare function isKnownLogType(t: string): t is LogType;
/**
 * Instantiate a module-provided logger at load time
 */
export declare let commonLogger: PancloudLogger;
/**
 * Developer might decide to change the loglevel of the logger object at runtime
 * @param newLevel the new log level
 */
export declare function setLogLevel(newLevel: LogLevel): void;
/**
 * Changes the common logger variable to a user-provided object
 * @param logger user provided pancloudLogger compliant object to be used for SDK logging
 */
export declare function setLogger(logger: PancloudLogger): void;
/**
 * Abstract function used to retry multiple times a user-provided operation
 * @param source class using the retrier. Its className property value will be used in logs generated by the retrier
 * @param n number of attempts
 * @param delay milliseconds to wait after a failed attempt
 * @param handler function that implements the operation
 * @param params additional arguments to be passed to the handler function
 */
export declare function retrier<T, O>(source: PancloudClass, n: number | undefined, delay: number | undefined, handler: (...args: T[]) => Promise<O>, ...params: T[]): Promise<O>;
export declare function expTokenExtractor(source: PancloudClass, token: string): number;
export declare function uid(): string;
export {};
