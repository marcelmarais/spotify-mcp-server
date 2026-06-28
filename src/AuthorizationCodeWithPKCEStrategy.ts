import { createHash, randomBytes } from 'node:crypto';
import type {
  AccessToken,
  IAuthStrategy,
  ICachable,
  ICachingStrategy,
  SdkConfiguration,
} from '@spotify/web-api-ts-sdk';
import { type AuthLockOptions, withAuthLock } from './auth-lock.js';

interface CachedVerifier extends ICachable {
  verifier: string;
  state: string;
  expiresOnAccess: boolean;
}

type RequestAuthorizationCallback = (
  authorizationUrl: string,
) => Promise<string>;

export default class AuthorizationCodeWithPKCEStrategy
  implements IAuthStrategy
{
  private static readonly cacheKey =
    'spotify-sdk:AuthorizationCodeWithPKCEStrategy:token';
  private configuration: SdkConfiguration | null = null;

  protected get cache(): ICachingStrategy {
    return this.sdkConfig.cachingStrategy;
  }

  private get sdkConfig(): SdkConfiguration {
    if (!this.configuration) {
      throw new Error('Spotify SDK configuration has not been set.');
    }

    return this.configuration;
  }

  constructor(
    protected clientId: string,
    protected redirectUri: string,
    protected scopes: string[],
    private readonly requestAuthorizationCallback: RequestAuthorizationCallback,
    private readonly authLockOptions: AuthLockOptions,
  ) {}

  public setConfiguration(configuration: SdkConfiguration): void {
    this.configuration = configuration;
  }

  public async getOrCreateAccessToken(): Promise<AccessToken> {
    return await this.cache.getOrCreate<AccessToken>(
      AuthorizationCodeWithPKCEStrategy.cacheKey,
      async () => {
        return await withAuthLock(this.authLockOptions, async () => {
          const cachedToken = await this.cache.get<AccessToken>(
            AuthorizationCodeWithPKCEStrategy.cacheKey,
          );
          if (cachedToken) {
            return cachedToken;
          }

          const token = await this.redirectOrVerifyToken();
          return toCachable(token);
        });
      },
      async (expiring) => {
        return await refreshCachedAccessToken(this.clientId, expiring);
      },
    );
  }

  public async getAccessToken(): Promise<AccessToken | null> {
    return await this.cache.get<AccessToken>(
      AuthorizationCodeWithPKCEStrategy.cacheKey,
    );
  }

  public removeAccessToken(): void {
    this.cache.remove(AuthorizationCodeWithPKCEStrategy.cacheKey);
  }

  private async redirectOrVerifyToken(): Promise<AccessToken> {
    const verifier = generateCodeVerifier(128);
    const challenge = generateCodeChallenge(verifier);
    const state = generateCodeVerifier(16);

    const singleUseVerifier: CachedVerifier = {
      verifier,
      state,
      expiresOnAccess: true,
    };
    this.cache.setCacheItem('spotify-sdk:verifier', singleUseVerifier);

    const redirectTarget = await this.generateRedirectUrlForUser(
      this.scopes,
      challenge,
      state,
    );
    const callbackUrl = await this.requestAuthorizationCallback(redirectTarget);
    const callback = new URL(callbackUrl);

    const error = callback.searchParams.get('error');
    if (error) {
      throw new Error(`Spotify authorization failed: ${error}`);
    }

    const code = callback.searchParams.get('code');
    if (!code) {
      throw new Error("No authorization code found in Spotify's callback URL.");
    }

    return await this.verifyAndExchangeCode(
      code,
      callback.searchParams.get('state'),
    );
  }

  private async verifyAndExchangeCode(
    code: string,
    returnedState: string | null,
  ): Promise<AccessToken> {
    const cachedItem = await this.cache.get<CachedVerifier>(
      'spotify-sdk:verifier',
    );
    const verifier = cachedItem?.verifier;
    const state = cachedItem?.state;

    if (!verifier) {
      throw new Error(
        "No verifier found in cache - can't validate query string callback parameters.",
      );
    }

    if (!state || returnedState !== state) {
      throw new Error('Spotify authorization state mismatch.');
    }

    return await this.exchangeCodeForToken(code, verifier);
  }

  protected async generateRedirectUrlForUser(
    scopes: string[],
    challenge: string,
    state: string,
  ): Promise<string> {
    const scope = scopes.join(' ');

    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('response_type', 'code');
    params.append('redirect_uri', this.redirectUri);
    params.append('scope', scope);
    params.append('state', state);
    params.append('code_challenge_method', 'S256');
    params.append('code_challenge', challenge);

    return `https://accounts.spotify.com/authorize?${params.toString()}`;
  }

  protected async exchangeCodeForToken(
    code: string,
    verifier: string,
  ): Promise<AccessToken> {
    const params = new URLSearchParams();
    params.append('client_id', this.clientId);
    params.append('grant_type', 'authorization_code');
    params.append('code', code);
    params.append('redirect_uri', this.redirectUri);
    params.append('code_verifier', verifier);

    const result = await this.fetchToken(params);
    const text = await result.text();

    if (!result.ok) {
      throw new Error(
        `Failed to exchange code for token: ${result.statusText}, ${text}`,
      );
    }

    return JSON.parse(text) as AccessToken;
  }

  private async fetchToken(params: URLSearchParams): Promise<Response> {
    return await this.sdkConfig.fetch(
      'https://accounts.spotify.com/api/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      },
    );
  }
}

async function refreshCachedAccessToken(
  clientId: string,
  item: AccessToken,
): Promise<ICachable & AccessToken> {
  const updated = await refreshToken(clientId, item.refresh_token);
  return toCachable({
    ...updated,
    refresh_token: updated.refresh_token || item.refresh_token,
  });
}

function toCachable(item: AccessToken): ICachable & AccessToken {
  if (item.expires && item.expires === -1) {
    return item;
  }

  return { ...item, expires: calculateExpiry(item) };
}

function calculateExpiry(item: AccessToken): number {
  return Date.now() + item.expires_in * 1000;
}

async function refreshToken(
  clientId: string,
  refreshToken: string,
): Promise<AccessToken> {
  const params = new URLSearchParams();
  params.append('client_id', clientId);
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);

  const result = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params,
  });

  const text = await result.text();

  if (!result.ok) {
    throw new Error(`Failed to refresh token: ${result.statusText}, ${text}`);
  }

  return JSON.parse(text) as AccessToken;
}

function generateCodeVerifier(length: number): string {
  const possible =
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(length);

  return Array.from(bytes, (byte) => possible[byte % possible.length]).join('');
}

function generateCodeChallenge(codeVerifier: string): string {
  return createHash('sha256')
    .update(codeVerifier)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}
