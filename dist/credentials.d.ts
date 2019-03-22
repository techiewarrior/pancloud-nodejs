/**
 * credentials module implements a class to keep all Application Framework credentials operations
 * bound together.
 */
import { PancloudClass } from './common';
/**
 * Base abstract CredentialS class
 */
export declare abstract class Credentials implements PancloudClass {
    private validUntil;
    private accessToken;
    className: string;
    private guardTime;
    constructor(guardTime?: number);
    protected setAccessToken(accessToken: string, validUntil: number): void;
    /**
     * Returns the current access token
     */
    getAccessToken(): Promise<string>;
    getExpiration(): Promise<number>;
    /**
     * Checks the access token expiration time and automaticaly refreshes it if going to expire
     * inside the next 5 minutes
     */
    autoRefresh(): Promise<boolean>;
    /**
     * Triggers an access token refresh request
     */
    abstract retrieveAccessToken(): Promise<void>;
}
export declare function defaultCredentialsFactory(accessToken: string): Credentials;
