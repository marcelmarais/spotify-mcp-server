# Spotify MCP Server - Token Refresh Fix

## Problem Summary

Your Spotify MCP server was requiring re-authentication every ~1 hour because the token refresh mechanism was not implemented correctly.

## Root Causes

### 1. **Incorrect Token Expiration Time**
**Location**: `src/utils.ts` line 61 (original code)

```typescript
expires_in: 3600 * 24 * 30, // Default to 1 month ❌ WRONG
```

**Issue**: The code set the token expiration to 30 days, but Spotify access tokens actually expire after **1 hour (3600 seconds)**. This caused the SDK to think the token was valid for a month when it actually expired after an hour.

### 2. **No Token Expiration Tracking**
**Location**: `src/utils.ts` - `SpotifyConfig` interface

**Issue**: The configuration didn't store when the token expires (`expiresAt`), so the server had no way to know if a token was expired and needed refreshing.

### 3. **No Automatic Refresh Logic**
**Location**: `src/utils.ts` - `createSpotifyApi()` function

**Issue**: The function created a Spotify API instance but never checked if the token was expired or attempted to refresh it. It just used whatever token was in the config file, even if it was stale.

### 4. **Missing Refresh Token Function**
**Location**: `src/utils.ts`

**Issue**: There was no function to call Spotify's token refresh endpoint using the refresh token.

---

## What Was Fixed

### 1. **Added `expiresAt` Field to Config**
```typescript
export interface SpotifyConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number; // ✅ NEW: Unix timestamp in milliseconds
}
```

**Why**: This tracks when the access token expires so we can refresh it proactively.

### 2. **Created `refreshAccessToken()` Function**
```typescript
async function refreshAccessToken(
  config: SpotifyConfig,
): Promise<{ access_token: string; expires_in: number }> {
  // Calls Spotify's token refresh endpoint
  // Uses the refresh_token to get a new access_token
}
```

**Why**: This function exchanges the refresh token for a new access token when the old one expires.

**How it works**:
- Makes a POST request to `https://accounts.spotify.com/api/token`
- Sends the `refresh_token` with `grant_type=refresh_token`
- Returns a new `access_token` and its `expires_in` time

### 3. **Rewrote `createSpotifyApi()` to Check Expiration**
```typescript
export async function createSpotifyApi(): Promise<SpotifyApi> {
  const config = loadSpotifyConfig();
  
  if (config.accessToken && config.refreshToken) {
    const now = Date.now();
    const shouldRefresh = !config.expiresAt || config.expiresAt <= now;
    
    if (shouldRefresh) {
      // ✅ Refresh the token automatically
      const tokens = await refreshAccessToken(config);
      config.accessToken = tokens.access_token;
      config.expiresAt = now + tokens.expires_in * 1000;
      saveSpotifyConfig(config);
    }
    // ... create API instance with fresh token
  }
}
```

**Why**: This ensures that before making any Spotify API call, we check if the token is expired and refresh it if needed.

**How it works**:
1. Checks if `expiresAt` is missing or if the current time is past the expiration
2. If expired, calls `refreshAccessToken()` to get a new token
3. Saves the new token and expiration time to `spotify-config.json`
4. Creates the Spotify API instance with the fresh token

### 4. **Updated `exchangeCodeForToken()` to Return `expires_in`**
```typescript
return {
  access_token: data.access_token,
  refresh_token: data.refresh_token,
  expires_in: data.expires_in || 3600, // ✅ NEW
};
```

**Why**: We need to know when the token expires so we can save it to the config.

### 5. **Updated `authorizeSpotify()` to Save `expiresAt`**
```typescript
config.accessToken = tokens.access_token;
config.refreshToken = tokens.refresh_token;
config.expiresAt = Date.now() + tokens.expires_in * 1000; // ✅ NEW
saveSpotifyConfig(config);
```

**Why**: When you first authenticate, we now save when the token expires.

---

## How Token Refresh Works Now

### Before (Broken Flow)
1. User authenticates → gets access token + refresh token
2. Tokens saved to `spotify-config.json`
3. Server uses access token for API calls
4. After 1 hour, access token expires
5. ❌ Server keeps using expired token → **Authentication fails**
6. User must run `npm run auth` again

### After (Fixed Flow)
1. User authenticates → gets access token + refresh token + expiration time
2. Tokens + `expiresAt` saved to `spotify-config.json`
3. Server uses access token for API calls
4. Before each API call, server checks if token is expired
5. ✅ If expired, server automatically refreshes the token
6. New token + new `expiresAt` saved to config
7. API call proceeds with fresh token
8. **No re-authentication needed!**

---

## Key Concepts to Understand

### OAuth 2.0 Token Types

1. **Access Token**
   - Short-lived (1 hour for Spotify)
   - Used to make API requests
   - Like a temporary key to your account

2. **Refresh Token**
   - Long-lived (doesn't expire unless revoked)
   - Used to get new access tokens
   - Like a master key that can create temporary keys

### Token Refresh Flow

```
┌─────────────────────────────────────────────────────────┐
│ 1. Initial Authentication (npm run auth)               │
│    User → Spotify → Authorization Code                 │
│    Code → Access Token + Refresh Token                 │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 2. Normal API Usage                                     │
│    Server checks: Is access token expired?              │
│    No → Use existing token                              │
│    Yes → Use refresh token to get new access token      │
└─────────────────────────────────────────────────────────┘
                          ↓
┌─────────────────────────────────────────────────────────┐
│ 3. Token Refresh (automatic)                            │
│    POST to Spotify with refresh_token                   │
│    Spotify → New Access Token                           │
│    Save new token + new expiration time                 │
└─────────────────────────────────────────────────────────┘
```

### Why the Original Code Failed

The original code made a critical assumption: it set `expires_in: 3600 * 24 * 30` (30 days) when creating the Spotify API instance. This told the Spotify SDK "this token is valid for 30 days," but in reality:

- Spotify access tokens expire after **1 hour**
- The SDK trusted the `expires_in` value and didn't refresh
- After 1 hour, the token was actually expired
- API calls failed with authentication errors

The fix ensures we:
1. Track the **real** expiration time
2. Check expiration **before** each API call
3. Refresh **automatically** when needed

---

## Testing the Fix

After running `npm run auth`, your `spotify-config.json` should now include `expiresAt`:

```json
{
  "clientId": "...",
  "clientSecret": "...",
  "redirectUri": "http://127.0.0.1:8888/callback",
  "accessToken": "BQA...",
  "refreshToken": "AQD...",
  "expiresAt": 1735484028000  // ✅ This is new!
}
```

The server will now:
- Work continuously without re-authentication
- Automatically refresh tokens every hour
- Only require re-authentication if the refresh token is revoked or the config is deleted

---

## What You Learned

1. **OAuth Token Lifetimes**: Access tokens are short-lived, refresh tokens are long-lived
2. **Token Refresh Pattern**: Always store expiration time and check before using tokens
3. **Async/Await**: Token refresh requires network calls, so functions must be async
4. **Configuration Management**: Persisting token metadata (like `expiresAt`) is crucial
5. **Error Handling**: Graceful degradation when refresh fails (prompt for re-auth)

This is a common pattern in OAuth-based applications and is essential for maintaining persistent authentication without bothering users to re-login constantly.
