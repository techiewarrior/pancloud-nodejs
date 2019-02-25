/**
 * Implements the abstract coreClass that implements common methods for higher-end classes like Event Service
 * and Logging Service
 */
import * as fetch from 'node-fetch'
import { Credentials } from './credentials'
import { ApplicationFrameworkError, PanCloudError } from './error'
import { commonLogger, LogLevel, retrier } from './common';

export interface CoreStats {
    apiTransactions: number
}

/**
 * Interface to provide configuration options to the core class
 */
export interface CoreOptions {
    /**
     * credential object that should be used in the coreClass instance
     */
    credential: Credentials,
    /**
     * Toggle the access_token auto-refresh feature
     */
    autoRefresh?: boolean,
    /**
     * Minimum level of logs that should be generated by the coreClass
     */
    level?: LogLevel
    /**
     * Number of times a fetch operation must be retried in case of exception
     */
    retrierCount?: number
    /**
     * Delay (in milliseconds) between retry attempts
     */
    retrierDelay?: number
    fetchTimeout?: number | undefined
}

/**
 * This class should not be used directly. It is meant to be extended. Use higher-level classes like LoggingService
 * or EventService
 */
export class CoreClass {
    /**
     * Credential object to be used by this instance
     */
    protected cred: Credentials
    /**
     * Master Application Framework API entry point
     */
    protected baseUrl: string
    /**
     * Keeps the HTTP headers used by the user agent. mainly used to keep the Authorization header (bearer access token)
     */
    protected fetchHeaders: { [i: string]: string }
    private fetchTimeout: number | undefined
    private autoR: boolean
    private retrierCount?: number
    private retrierDelay?: number
    lastResponse: any
    public className: string
    protected stats: CoreStats

    /**
     * 
     * @param ops configuration options for this instance
     */
    protected constructor(baseUrl: string, ops: CoreOptions) {
        this.className = "coreClass"
        this.cred = ops.credential
        this.baseUrl = baseUrl
        if (ops.level != undefined && ops.level != LogLevel.INFO) {
            commonLogger.level = ops.level
        }
        if (ops.autoRefresh == undefined) {
            this.autoR = true
        } else {
            this.autoR = ops.autoRefresh
        }
        this.retrierCount = ops.retrierCount
        this.retrierDelay = ops.retrierDelay
        this.fetchTimeout = ops.fetchTimeout
        this.stats = {
            apiTransactions: 0
        }
        this.setFetchHeaders()
    }


    /**
     * Prepares the HTTP headers. Mainly used to keep the Autorization header (bearer access-token)
     */
    private setFetchHeaders(): void {
        this.fetchHeaders = {
            'Authorization': 'Bearer ' + this.cred.getAccessToken(),
            'Content-Type': 'application/json'
        }
        commonLogger.info(this, 'updated authorization header')
    }

    /**
     * Triggers the credential object access-token refresh procedure and updates the HTTP headers
     */
    protected async refresh(): Promise<void> {
        await this.cred.refreshAccessToken()
        this.setFetchHeaders()
    }

    private async checkAutoRefresh(): Promise<void> {
        if (this.autoR) {
            if (await this.cred.autoRefresh()) {
                this.setFetchHeaders()
            }
        }
    }

    private async fetchXWrap(method: string, path?: string, body?: string): Promise<any> {
        let url = this.baseUrl + ((path) ? path : '')
        this.stats.apiTransactions++
        await this.checkAutoRefresh()
        let rInit: fetch.RequestInit = {
            headers: this.fetchHeaders,
            method: method
        }
        if (this.fetchTimeout) {
            rInit.timeout = this.fetchTimeout
        }
        if (body) {
            rInit.body = body
        }
        commonLogger.debug(this, `fetch operation to ${url}`, method, body)
        let r = await retrier(this, this.retrierCount, this.retrierDelay, fetch.default, url, rInit)
        let rText = await r.text()
        if (rText.length == 0) {
            commonLogger.info(this, 'fetch response is null')
            return null
        }
        let rJson: any
        try {
            rJson = JSON.parse(rText)
        } catch (exception) {
            throw new PanCloudError(this, 'PARSER', `Invalid JSON: ${exception.message}`)
        }
        if (!r.ok) {
            commonLogger.alert(this, rText, "FETCHXWRAP")
            throw new ApplicationFrameworkError(this, rJson)
        }
        commonLogger.debug(this, 'fetch response', undefined, rJson)
        return rJson
    }

    /**
     * Convenience method that abstracts a GET operation to the Application Framework. Captures both non JSON responses
     * as well as Application Framework errors (non-200) throwing exceptions in both cases.
     * @param url URL to be called
     * @param timeout milliseconds before issuing a timeout exeception. The operation is wrapped by a 'retrier'
     * that will retry the operation. User can change default retry parameters (3 times / 100 ms) using the right
     * class configuration properties
     * @returns the object returned by the Application Framework
     */
    protected async fetchGetWrap(path?: string): Promise<any> {
        return await this.fetchXWrap("GET", path, undefined)
    }

    /**
     * Convenience method that abstracts a POST operation to the Application Framework
     */
    protected async fetchPostWrap(path?: string, body?: string): Promise<any> {
        return await this.fetchXWrap("POST", path, body)
    }

    /**
     * Convenience method that abstracts a PUT operation to the Application Framework
     */
    protected async fetchPutWrap(path?: string, body?: string): Promise<any> {
        return await this.fetchXWrap("PUT", path, body)
    }

    /**
     * Convenience method that abstracts a DELETE operation to the Application Framework
     */
    protected async fetchDeleteWrap(path?: string): Promise<any> {
        return await this.fetchXWrap("DELETE", path, undefined)
    }

    /**
     * Convenience method that abstracts a DELETE operation to the Application Framework
     */
    protected async voidXOperation(path?: string, payload?: string, method = "POST"): Promise<void> {
        let r_json = await this.fetchXWrap(method, path, payload);
        this.lastResponse = r_json
    }
}