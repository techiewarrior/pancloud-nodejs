// Copyright 2015-2019 Palo Alto Networks, Inc
// 
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//       http://www.apache.org/licenses/LICENSE-2.0
// 
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { commonLogger, PancloudClass, EntryPoint } from './common'
import { PanCloudError } from './error'
import { Credentials } from './credentials'
import { env } from 'process'
import { CortexCredentialProvider, CredentialProviderOptions, CredentialsItem, isCredentialItem } from './credentialprovider'
import { createCipheriv, createDecipheriv, createHash } from 'crypto'
import * as fs from 'fs'

interface ConfigFile<T> {
    credentialItems: { [dlid: string]: CredentialsItem },
    metadata: { [datalakeId: string]: T }
}

function isConfigFile<T>(obj: any): obj is ConfigFile<T> {
    return typeof obj == 'object' &&
        obj.metadata &&
        obj.credentialItems && typeof obj.credentialItems == 'object' &&
        Object.entries(obj.credentialItems).every(v => typeof v[0] == 'string' && isCredentialItem(v[1]))
}

class FsCredProvider<T, K extends keyof T> extends CortexCredentialProvider<T, K> {
    private key: Buffer
    private iv: Buffer
    private configFileName: string
    private metadata: { [datalakeId: string]: T }
    className = 'FsCredProvider'

    constructor(ops: CredentialProviderOptions &
    { clientId: string, clientSecret: string } &
    { key: Buffer, iv: Buffer, configFileName: string }, tenantKey?: K) {
        super(ops, tenantKey)
        this.key = ops.key
        this.iv = ops.iv
        this.configFileName = ops.configFileName
        this.metadata = {}
    }

    private async fullSync(): Promise<void> {
        let configFile: ConfigFile<T> = {
            credentialItems: this.credentials,
            metadata: this.metadata
        }
        Object.entries(this.credentials).forEach(v => {
            let aes = createCipheriv('aes128', this.key, this.iv)
            let payload = Buffer.concat([aes.update(Buffer.from(v[1].refreshToken, 'utf8')), aes.final()]).toString('base64')
            configFile.credentialItems[v[0]].refreshToken = payload
            aes = createCipheriv('aes128', this.key, this.iv)
            payload = Buffer.concat([aes.update(Buffer.from(v[1].accessToken, 'utf8')), aes.final()]).toString('base64')
            configFile.credentialItems[v[0]].accessToken = payload
        })
        await promifyFs(this, fs.writeFile, this.configFileName, JSON.stringify(configFile, undefined, ' '))
    }

    protected createCredentialsItem(datalakeId: string, credentialsItem: CredentialsItem, metadata?: T | undefined): Promise<void> {
        if (metadata) {
            this.metadata[datalakeId] = metadata
        }
        commonLogger.info(this, `Lazy implementation of CREATE credentials request for datalake ${datalakeId} with a full synch operation`)
        return this.fullSync()
    }

    protected updateCredentialsItem(datalakeId: string, credentialsItem: CredentialsItem): Promise<void> {
        commonLogger.info(this, `Lazy implementation of UPDATE credentials request for datalake ${datalakeId} with a full synch operation`)
        return this.fullSync()
    }

    protected deleteCredentialsItem(datalakeId: string): Promise<void> {
        commonLogger.info(this, `Lazy implementation of DELETE credentials request for datalake ${datalakeId} with a full synch operation`)
        return this.fullSync()
    }

    selectDatalakeByTenant(tenantId: T[K]): Promise<string[]> {
        let matchingDatalakes = Object.keys(this.metadata).filter(datalakeId => {
            if (this.tenantKey === undefined) {
                return false
            }
            return this.metadata[datalakeId][this.tenantKey] == tenantId
        })
        return Promise.resolve(matchingDatalakes)
    }

    protected async loadCredentialsDb(): Promise<{ [dlid: string]: CredentialsItem }> {
        let jsonConfig: any
        try {
            let configFile = await promifyFs<Buffer>(this, fs.readFile, this.configFileName)
            jsonConfig = JSON.parse(configFile.toString('utf8'))
        } catch (e) {
            throw PanCloudError.fromError(this, e)
        }
        if (!isConfigFile<T>(jsonConfig)) {
            throw new PanCloudError(this, 'PARSER', `Invalid configuration file format in ${this.configFileName}`)
        }
        this.metadata = jsonConfig.metadata
        Object.entries(jsonConfig.credentialItems).forEach(v => {
            let aes = createDecipheriv('aes128', this.key, this.iv)
            let payload = Buffer.concat([aes.update(Buffer.from(v[1].refreshToken, 'base64')), aes.final()]).toString('utf8')
            jsonConfig.credentialItems[v[0]].refreshToken = payload
            aes = createDecipheriv('aes128', this.key, this.iv)
            payload = Buffer.concat([aes.update(Buffer.from(v[1].accessToken, 'base64')), aes.final()]).toString('utf8')
            jsonConfig.credentialItems[v[0]].accessToken = payload
        })
        commonLogger.info(this, `Loaded ${Object.keys(jsonConfig.credentialItems).length} entities from the configuration file ${this.configFileName}`)
        return jsonConfig.credentialItems
    }

    protected credentialsObjectFactory(datalakeId: string, entryPoint: EntryPoint, accTokenGuardTime: number,
        prefetch?: { accessToken: string, validUntil: number }): Promise<Credentials> {
        return this.defaultCredentialsObjectFactory(datalakeId, entryPoint, accTokenGuardTime, prefetch)
    }
}

const ENV_PREFIX = 'PAN'
const CONFIG_FILE = 'PANCLOUD_CONFIG.json'

/**
 * Initializes a `CortexCredentialProvider` subclass that leverages the local filesystem as storage.
 * State data will be stored in the file `PANCLOUD_CONFIG.json`
 * Gets all its configuration options either from optional properties of from environmental variables
 * @param secret encryption key that will be used to store sensible data at rest
 * @param ops.envPrefix optional environmental variables prefix. Defauls to `PAN`
 * @param ops.envClientId environmental variable that keeps the OAUTH2 `client_id` value in case it
 * is not provided explicitly. Defaults to `{ops.envPrefix}_CLIENT_ID`
 * @param ops.envClientSecret environmental variable that keeps the OAUTH2 `client_secret` value in
 * case it is not provided explicitly. Defaults to `{ops.envPrefix}_CLIENT_SECRET`
 */
export async function fsCredentialsFactory<T, K extends keyof T>(ops: CredentialProviderOptions &
{ envPrefix?: string, clientId?: string, clientSecret?: string, secret: string }, tenantKey?: K): Promise<FsCredProvider<T, K>> {
    let { key, iv } = passIvGenerator(ops.secret)
    let ePrefix = (ops && ops.envPrefix) ? ops.envPrefix : ENV_PREFIX
    let envClientId = `${ePrefix}_CLIENT_ID`
    let envClientSecret = `${ePrefix}_CLIENT_SECRET`
    let cId = (ops && ops.clientId) ? ops.clientId : env[envClientId]
    if (!cId) {
        throw new PanCloudError({ className: 'DefaultCredentialsProvider' }, 'CONFIG',
            `Environment variable ${envClientId} not found or empty value`)
    }
    commonLogger.info({ className: "defaultCredentialsFactory" }, `Got 'client_id'`)
    let cSec = (ops && ops.clientSecret) ? ops.clientSecret : env[envClientSecret]
    if (!cSec) {
        throw new PanCloudError({ className: 'DefaultCredentialsProvider' }, 'CONFIG',
            `Environment variable ${envClientSecret} not found or empty value`)
    }
    commonLogger.info({ className: "defaultCredentialsFactory" }, `Got 'client_secret'`)
    let configFileName = `${ePrefix}_${CONFIG_FILE}`
    try {
        await promifyFs<fs.Stats>(this, fs.stat, configFileName)
    } catch (e) {
        commonLogger.info({ className: 'fsCredProvider' }, `${configFileName} does not exist. Creating it`)
        let blankConfig: ConfigFile<T> = {
            credentialItems: {},
            metadata: {}
        }
        await promifyFs<void>(this, fs.writeFile, configFileName, JSON.stringify(blankConfig))
    }
    try {
        await promifyFs(this, fs.access, configFileName, fs.constants.W_OK | fs.constants.R_OK)
    } catch (e) {
        throw new PanCloudError({ className: 'fsCredProvider' }, 'CONFIG', `Invalid permissions in configuration file ${configFileName}`)
    }
    return new FsCredProvider({
        clientId: cId,
        clientSecret: cSec,
        key: key,
        iv: iv,
        configFileName: configFileName,
        ...ops
    }, tenantKey)
}

function passIvGenerator(secret: string): { key: Buffer, iv: Buffer } {
    let code = createHash('sha1').update(secret).digest()
    let key = code.slice(0, 16)
    let iv = code.slice(4, 20)
    return {
        key: key,
        iv: iv
    }
}

function promifyFs<T>(source: PancloudClass, f: (...args: any[]) => void, ...params: any[]): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        f(...params, (e: Error | undefined, data?: T) => {
            if (e) {
                reject(PanCloudError.fromError(source, e))
            }
            resolve(data)
        })
    })
}