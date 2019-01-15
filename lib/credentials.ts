import fetch from 'node-fetch';
import { PanCloudError } from './error'
import { commonLogger, retrier } from './common'

// This interface represents AppFramework token data
interface appFrameworkTokens {
    access_token: string, // access token
    refresh_token?: string, // refresh token
    expires_in: string // expiration in seconds
}

function isAppFramToken(obj: any): obj is appFrameworkTokens {
    return (typeof obj.access_token == 'string' &&
        typeof obj.expires_in == 'string' &&
        (obj.refresh_tokens === undefined || typeof obj.refresh_tokens == 'string'))
}

const IDP_TOKEN_URL: string = 'https://api.paloaltonetworks.com/api/oauth2/RequestToken'
const IDP_REVOKE_URL: string = 'https://api.paloaltonetworks.com/api/oauth2/RevokeToken'
const IDP_BASE_URL: string = 'https://identity.paloaltonetworks.com/as/authorization.oauth2'

export interface credOptions {
    client_id: string,
    client_secret: string,
    access_token?: string,
    refresh_token?: string,
    idp_token_url?: string,
    redirect_uri?: string,
    code?: string,
}

export class Credentials {
    private access_token: string
    private refresh_token: string
    private client_id: string
    private client_secret: string
    private idp_token_url: string
    private valid_until: number
    static className = "Credentials"

    private constructor(
        client_id: string, client_secret: string,
        access_token: string, refresh_token: string,
        idp_token_url: string) {
        this.client_id = client_id
        this.client_secret = client_secret
        this.access_token = access_token
        this.refresh_token = refresh_token
        this.valid_until = Credentials.expExtractor(access_token)
        this.idp_token_url = idp_token_url
    }

    private static expExtractor(jwt: string): number {
        let jwtParts = jwt.split('.')
        if (jwtParts.length != 3) { throw new PanCloudError(Credentials, 'CONFIG', 'invalid JWT Token') }
        let claim: any
        let exp: number
        try {
            claim = JSON.parse(Buffer.from(jwtParts[1], 'base64').toString())
            exp = Number.parseInt(claim.exp, 10)
        } catch (e) {
            throw PanCloudError.fromError(Credentials, e)
        }
        return exp
    }

    public static async factory(opt: credOptions): Promise<Credentials> {
        if (!opt.idp_token_url) { opt.idp_token_url = IDP_TOKEN_URL }
        if (!(opt.refresh_token || opt.code)) {
            throw new PanCloudError(Credentials, 'CONFIG', 'Invalid Credentials (code or refresh token missing)')
        }
        if (opt.refresh_token && opt.access_token) {
            return new Credentials(
                opt.client_id, opt.client_secret,
                opt.access_token, opt.refresh_token,
                opt.idp_token_url)
        }
        let tk: appFrameworkTokens
        let r_token: string
        if (opt.refresh_token) {
            r_token = opt.refresh_token
            tk = await Credentials.refresh_tokens(opt.client_id, opt.client_secret, opt.refresh_token, opt.idp_token_url)
            if (tk.refresh_token) {
                r_token = tk.refresh_token
            }
        } else if (opt.code !== undefined && opt.redirect_uri !== undefined) {
            tk = await Credentials.fetch_tokens(opt.client_id, opt.client_secret, opt.code, opt.idp_token_url, opt.redirect_uri)
            if (tk.refresh_token) {
                r_token = tk.refresh_token
            } else {
                throw new PanCloudError(Credentials, 'IDENTITY', 'Missing refresh_token in the response')
            }
        } else {
            throw new PanCloudError(Credentials, 'CONFIG', 'Invalid Credentials (code or redirect_uri missing)')
        }
        let vu = parseInt(tk.expires_in)
        vu = Math.floor(Date.now() / 1000) + (vu ? vu : 0)
        return new Credentials(opt.client_id, opt.client_secret,
            tk.access_token, r_token,
            opt.idp_token_url)
    }

    static async fetch_tokens(
        client_id: string,
        client_secret: string,
        code: string,
        idp_token_url: string,
        redirect_uri: string): Promise<appFrameworkTokens> {
        let res = await retrier(Credentials, undefined, undefined, fetch, idp_token_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "code": code
            })
        })
        if (!res.ok) {
            throw new PanCloudError(Credentials, 'IDENTITY', `HTTP Error from IDP fetch operation ${res.status} ${res.statusText}`)
        }
        let r_json: any
        try {
            r_json = await res.json()
        } catch (exception) {
            throw new PanCloudError(Credentials, 'PARSER', `Invalid JSON fetch response: ${exception.message}`)
        }
        if (isAppFramToken(r_json)) {
            commonLogger.info(Credentials, 'Authorization token successfully retrieved')
            return r_json
        }
        throw new PanCloudError(Credentials, 'PARSER', `Unparseable response received from IDP fetch operation: "${JSON.stringify(r_json)}"`)
    }

    static async refresh_tokens(
        client_id: string,
        client_secret: string,
        refresh_token: string,
        idp_token_url: string): Promise<appFrameworkTokens> {
        let res = await retrier(Credentials, undefined, undefined, fetch, idp_token_url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                "client_id": client_id,
                "client_secret": client_secret,
                "refresh_token": refresh_token,
                "grant_type": "refresh_token"
            }),
            timeout: 30000
        })
        if (!res.ok) {
            throw new PanCloudError(Credentials, 'IDENTITY', `HTTP Error from IDP refresh operation ${res.status} ${res.statusText}`)
        }
        let r_json: any
        try {
            r_json = await res.json()
        } catch (exception) {
            throw new PanCloudError(Credentials, 'PARSER', `Invalid JSON refresh response: ${exception.message}`)
        }
        if (isAppFramToken(r_json)) {
            commonLogger.info(Credentials, 'Authorization token successfully retrieved', 'IDENTITY')
            return r_json
        }
        throw new PanCloudError(Credentials, 'PARSER', `Unparseable response received from IDP refresh operation: "${JSON.stringify(r_json)}"`)
    }

    public async autoRefresh(): Promise<boolean> {
        if (Date.now() + 300000 > this.valid_until * 1000) {
            try {
                commonLogger.info(Credentials, 'Attempt to auto-refresh the access token')
                await this.refresh_access_token()
                return true
            } catch {
                commonLogger.info(Credentials, 'Failed to auto-refresh the access token')
            }
        }
        return false
    }

    public get_access_token(): string {
        return this.access_token
    }

    public get_expiration(): number {
        return this.valid_until
    }

    public async refresh_access_token(): Promise<void> {
        let tk = await Credentials.refresh_tokens(this.client_id, this.client_secret, this.refresh_token, this.idp_token_url)
        this.access_token = tk.access_token
        let vu = parseInt(tk.expires_in)
        this.valid_until = Math.floor(Date.now() / 1000) + (vu ? vu : 0)
        if (tk.refresh_token) {
            this.refresh_token = tk.refresh_token
        }
    }

    public async revoke_tokens(): Promise<void> {
        if (!this.refresh_token) {
            throw new PanCloudError(Credentials, 'CONFIG', `Not valid refresh token for revoke op: ${this.refresh_token}`)
        }
        let res = await fetch(IDP_REVOKE_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                "client_id": this.client_id,
                "client_secret": this.client_secret,
                "token": this.refresh_token,
                "token_type_hint": "refresh_token"
            })
        })
        if (res.ok && res.size > 0) {
            commonLogger.info(Credentials, 'Credentials(): Authorization token successfully revoked', 'IDENTITY');
        }
        throw new PanCloudError(Credentials, 'IDENTITY', `HTTP Error from IDP refresh operation ${res.status} ${res.statusText}`)
    }
}