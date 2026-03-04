const SpotifyWebApi = require("spotify-web-api-node");
const W3CWebSocket = require('websocket').w3cwebsocket;
const agent = require('superagent').agent();
// const superdebug = require('superagent-debugger');
const dotenv = require("dotenv");
const crypto = require("crypto");
const fs = require('fs')
const TOTP = require("totp-generator").TOTP;
const errorLog = require('./logger').errorlogger;
const infoLog = require('./logger').infoLogger;
const USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64; rv:124.0) Gecko/20100101 Firefox/124.0';
const TOKENS_FILE = 'tokens.json';
// Pathfinder (api-partner) internal API – see PATHFINDER-PLAYLIST.md
const PATHFINDER_QUERY_URL = 'https://api-partner.spotify.com/pathfinder/v2/query';
// Persisted-query hash: copied from HAR (POST body extensions.persistedQuery.sha256Hash).
// It is the SHA-256 of the GraphQL query document; we don't have that document, so we use the
// hash observed from the Web Player. Same hash is used for fetchPlaylist / fetchPlaylistContents.
const PATHFINDER_PLAYLIST_QUERY_HASH = '9c53fb83f35c6a177be88bf1b67cb080b853e86b576ed174216faa8f9164fc8f';
const SPOTIFY_WEB_APP_VERSION = '1.2.85.334.g6a4891e1';
dotenv.config();

class Spotify {

    // Short TTL cache for track bodies to cut API calls on song rollover (next -> current often already fetched).
    _trackCache = new Map();
    _trackCacheTTLMs = 60000;
    _rateLimitedUntil = 0;
    _runTaskQueue = Promise.resolve();

    // (re)attempt a task, a given number of times. On 429, honors Retry-After header.
    // Serialized so only one task runs at a time; avoids burst retries that trigger 86400 (24h) limits.
    async runTask(task, limit = 1, taskName = '') {
        const name = taskName || 'runTask';
        return new Promise((resolve, reject) => {
            this._runTaskQueue = this._runTaskQueue.then(() =>
                this._runTaskOnce(task, limit, name).then(resolve, reject)
            );
        });
    }

    async _runTaskOnce(task, limit, taskName = '') {
        const now = Date.now();
        if (now < this._rateLimitedUntil) {
            const waitMs = this._rateLimitedUntil - now;
            this.consoleInfo(`Rate limit cooldown: waiting ${Math.round(waitMs / 1000)}s before request.`);
            await this.sleep(waitMs);
        }
        return task().catch(async (e) => {
            this.consoleError(`Attempt failed (${taskName}), ${limit} tries remaining.`, e);
            if (e.message == "Unauthorized") {
                this.consoleInfo("Unauthorized? Refreshing auth token...");
                await this.refreshAuthToken();
            }
            if (limit <= 0) {
                this.consoleError("Too many attempts. Giving up.");
                throw e;
            }
            let waitMs = 2000;
            if (e.statusCode === 429) {
                const headers = e.headers || e.response?.headers || {};
                const raw = headers['retry-after'] || headers['Retry-After'];
                const seconds = raw != null ? parseInt(String(raw), 10) : NaN;
                const RETRY_AFTER_DEFAULT_SEC = 30;
                const RETRY_AFTER_MIN_SEC = 1;
                const RETRY_AFTER_MAX_SEC = 300;
                const RETRY_AFTER_NO_RETRY_SEC = 3600;
                if (!Number.isNaN(seconds) && seconds >= RETRY_AFTER_NO_RETRY_SEC) {
                    this._rateLimitedUntil = Math.max(this._rateLimitedUntil, Date.now() + Math.min(seconds, RETRY_AFTER_MAX_SEC) * 1000);
                    this.consoleError(`Rate limited (429) [${taskName}]; Retry-After ${seconds}s — not retrying. Backing off until ${new Date(this._rateLimitedUntil).toISOString()}.`);
                    throw e;
                }
                const sec = !Number.isNaN(seconds) && seconds >= 0
                    ? Math.min(RETRY_AFTER_MAX_SEC, Math.max(RETRY_AFTER_MIN_SEC, seconds))
                    : RETRY_AFTER_DEFAULT_SEC;
                waitMs = sec * 1000;
                this._rateLimitedUntil = Math.max(this._rateLimitedUntil, Date.now() + waitMs);
                if (seconds > RETRY_AFTER_MAX_SEC) {
                    this.consoleInfo(`Rate limited (429) [${taskName}]; long cooldown (${seconds}s). Backing off until ${new Date(this._rateLimitedUntil).toISOString()}.`);
                }
                this.consoleInfo(`Rate limited (429) [${taskName}]; waiting ${sec}s before retry (Retry-After: ${raw ?? 'none'}).`);
            }
            await this.sleep(waitMs);
            const nextLimit = (e.statusCode === 429 && limit === 1) ? 1 : limit - 1;
            return this._runTaskOnce(task, nextLimit, taskName);
        });
    }

    getAuthorizeUrl() {
        // Initialise connection to Spotify
        this.api = new SpotifyWebApi({
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            redirectUri: process.env.REDIRECT_URI
        });

        // Generate a Url to authorize access to Spotify (requires login credentials)
        const scopes = ["user-modify-playback-state", "user-read-currently-playing", "user-read-playback-state", "streaming"];
        const authorizeUrl = this.api.createAuthorizeURL(scopes, "default-state");
        this.consoleInfo(`Authorization required. Going to ${authorizeUrl}`);
        return authorizeUrl;
    }

    /**
     * Web token is used as bearer authorization for certain (unpublished) API requests.
     * @param sp_dc this is the http-only cookie value from a logged in spotify web client
     */
    async refreshWebAuthToken(sp_dc = null) {
        if (sp_dc == null && this.web_auth && this.web_auth.sp_dc) {
            sp_dc = this.web_auth.sp_dc;
        }
        if (sp_dc == undefined || sp_dc == null) {
            return Promise.reject("Missing web authorization cookie!");
        }
        this.consoleInfo("Attempting to retreive web auth token with sp_dc: " + sp_dc);
        const access_token_url = await this.getAccessTokenUrl();
        this.web_auth = await agent.get(access_token_url)
            .query({reason: "transport", productType: "web_player"})
            .set('Content-Type', 'application/json')
            .set('User-Agent', USER_AGENT)
            .set('Cookie', "sp_dc=" + sp_dc)
            // .use(superdebug.default(console.info))
            .then(resp => {
                // isAnonymous should be false (Spotify should be able to identify who's account it is)
                if (resp.body.isAnonymous) {
                    this.consoleError("Response:", JSON.stringify(resp.body));
                    throw new Error("Unable to retrieve access token");
                }
                this.consoleInfo("Response:", JSON.stringify(resp.body));
                return {
                    client_id: resp.body.clientId,
                    access_token: resp.body.accessToken,
                    expires_at: resp.body.accessTokenExpirationTimestampMs
                }
            });
        this.web_auth.sp_dc = sp_dc;
        this.consoleInfo("Web Access Token:", this.web_auth.access_token);
        this.saveTokensToFile();
        return Promise.resolve('OK');
    }

    saveTokensToFile() {
        const tokens = {};
        if (this.web_auth) {
            tokens.web_auth = this.web_auth;
        }
        if (this.auth) {
            tokens.auth = {
                access_token: this.auth.access_token,
                refresh_token: this.auth.refresh_token,
                expires_at: this.auth.expires_at
            }
        }

        fs.writeFile(TOKENS_FILE, JSON.stringify(tokens, null, 4), (error) => {
            if (error) {
                this.consoleError("Error writing spotify tokens to file: " + TOKENS_FILE, error);
            }
            else {
                this.consoleInfo("Spotify tokens written to file: " + TOKENS_FILE);
            }
        });
    }

    loadTokensFromFile() {
        const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, "utf8"));
        this.auth = tokens.auth;
        this.web_auth = tokens.web_auth;
        this.consoleInfo("Loaded spotify tokens file: " + TOKENS_FILE);
    }

    async initializeTokensFromFile() {
        try {
            this.loadTokensFromFile();
        }
        catch (err) {
            return Promise.reject("Failed to load spotify tokens. " + err.message)
        }
        this.api = new SpotifyWebApi({
            clientId: process.env.CLIENT_ID,
            clientSecret: process.env.CLIENT_SECRET,
            accessToken: this.auth.access_token,
            refreshToken: this.auth.refresh_token
        });
        return Promise.resolve("OK");
    }

    isAuthTokenValid() {
        if (this.auth == undefined || this.auth.expires_at == undefined) {
            return false;
        }
        else if (this.auth.expires_at < new Date().getTime()) {
            return false;
        }
        return true;
    }

    isWebAuthTokenValid() {
        if (this.web_auth == undefined || this.web_auth.expires_at == undefined) {
            return false;
        }
        else if (this.web_auth.expires_at < new Date().getTime()) {
            return false;
        }
        return true;
    }

    async initialized() {
        this.consoleInfo("Spotify is ready!");
        return Promise.resolve('OK');
    }

    async refreshAuthToken() {
        if (this.api === undefined || this.api.getAccessToken() === undefined) {
            return Promise.reject("Spotify not yet initialized...");
        }
        return this.api.refreshAccessToken()
            .then(result => {
                this.auth.access_token = result.body.access_token;
                this.auth.expires_at = result.body.expires_in * 1000 + new Date().getTime();

                this.api.setAccessToken(result.body.access_token);
                this.consoleInfo("Access Token:", result.body.access_token);
                this.saveTokensToFile();
            })
    }

    /**
     * Trade an authentication code in for an access/refresh token.
     * @param authCode authentication code
     * @returns {Promise<{access_token: string, refresh_token: string}>}
     */
    async receivedAuthCode(authCode) {
        // Exchange the given authorization code for an access and refresh token
        const authFlow = await this.api.authorizationCodeGrant(authCode);
        this.auth = authFlow.body;

        // Note the expiry time so that we can efficiently refresh the tokens
        this.auth.expires_at = authFlow.body.expires_in * 1000 + new Date().getTime();

        // Provide the Spotify library with the tokens
        this.api.setAccessToken(this.auth.access_token);
        this.api.setRefreshToken(this.auth.refresh_token);
        this.consoleInfo("Access Token:", this.auth.access_token);
        this.consoleInfo("Refresh Token:", this.auth.refresh_token);

        return this.auth;
    }

    // Taken from https://github.com/KRTirtho/spotube/issues/2494#issuecomment-2728511342
    async getAccessTokenUrl() {
        const secretSauce = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
        const base32FromBytes = (e) => {
            let t = 0;
            let n = 0;
            let r = "";
            for (let i = 0; i < e.length; i++) {
                n = n << 8 | e[i];
                t += 8;
                while (t >= 5) {
                    r += secretSauce[n >>> t - 5 & 31];
                    t -= 5;
                }
            }
            if (t > 0) {
                r += secretSauce[n << 5 - t & 31];
            }
            return r;
        }

        function cleanBuffer(e) {
            e = e.replace(/ /g, "");
            const t = new ArrayBuffer(e.length / 2);
            const n = new Uint8Array(t);
            for (let r = 0; r < e.length; r += 2) {
                n[r / 2] = parseInt(e.substring(r, r + 2), 16);
            }
            return n;
        };

        // 2025-07-08 see: https://github.com/librespot-org/librespot/issues/1475#issuecomment-3048400992
        // Dynamically fetch latest secret bytes from https://git.gay/thereallo/totp-secrets
        let secretCipherBytes;
        try {
            const response = await agent.get('https://git.gay/thereallo/totp-secrets/raw/branch/main/secrets/secretBytes.json')
                .set('User-Agent', USER_AGENT)
                .buffer(true);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch secret bytes: ${response.status}`);
            }
            const secrets = JSON.parse(response.text);
            const latestSecret = secrets[secrets.length - 1];
            this.consoleInfo(`Using secret bytes version ${latestSecret.version}`);
            secretCipherBytes = latestSecret.secret.map((e, t) => e ^ t % 33 + 9);
        }
        catch (error) {
            this.consoleError("Failed to fetch latest secret bytes, using fallback:", error.message);
            // Fallback to the last known working version (version 59)
            secretCipherBytes = [123,105,79,70,110,59,52,125,60,49,80,70,89,75,80,86,63,53,123,37,117,49,52,93,77,62,47,86,48,104,68,72]
                .map((e, t) => e ^ t % 33 + 9);
        }

        const secretBytes = new Uint8Array(cleanBuffer(Buffer.from(
            secretCipherBytes.join(""), "utf8").toString("hex")).buffer);

        const secret = base32FromBytes(secretBytes);

        // See https://github.com/librespot-org/librespot/issues/1475#issuecomment-2961128642
        const res = await agent.get("https://open.spotify.com/api/server-time").then(resp => JSON.parse(resp.text));
        const serverTime = res["serverTime"];
        const currentTimeMs = Date.now();
        const currentTime = Math.floor(currentTimeMs / 1000);

        // Calculate counter (current time divided by 30, floored)
        const counter = Math.floor(currentTime / 30);

        // Generate HOTP
        const hotp = TOTP.generate(secret, {
            algorithm: "SHA-1",
            digits: 6,
            counter: counter
        });

        this.consoleInfo("secretCipherBytes:", secretCipherBytes);
        this.consoleInfo("secretBytes:", secretBytes);
        this.consoleInfo("secret:", secret);
        this.consoleInfo("counter:", counter);

        const buildVer = "web-player_2025-06-11_1749647683859_b8b186b";
        const buildDate = "2025-06-11";

        const url = `https://open.spotify.com/api/token?reason=init&productType=web-player&totp=${hotp.otp}&totpServer=${hotp.otp}&totpVer=5&sTime=${serverTime}&cTime=${currentTimeMs}&buildVer=${buildVer}&buildDate=${buildDate}`;
        this.consoleInfo("url:", url);
        return url;
    }

    async search(terms, types, skip = 0, limit = 10) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        const cappedLimit = Math.min(Math.max(1, limit), 10); // Feb 2026: search limit max 10
        return this.runTask(async () => {
            const result = await this.api.search(terms, types, {offset: skip, limit: cappedLimit});

            // 2025-02-02 spotify is being wonky and returning null items?!
            if (result.body && result.body.playlists && result.body.playlists.items) {
                result.body.playlists.items = result.body.playlists.items.filter(item => item != null);
            }

            return result.body;
        });
    }

    /**
     * Get playlist items. Uses GET /playlists/{id}/items (Feb 2026: /tracks → /items, tracks.tracks.track → items.items.item).
     * Returns body normalized to legacy shape { items: [{ track }], total } for compatibility.
     */
    async getPlaylistTracks(playlistId, skip = 0, limit = 10) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const resp = await agent.get(`https://api.spotify.com/v1/playlists/${playlistId}/items`)
                .query({ offset: skip, limit })
                .set('Authorization', 'Bearer ' + this.api.getAccessToken())
                .then(r => r.body);
            // Feb 2026: response has items[].item (was items[].track); normalize to legacy shape
            const list = Array.isArray(resp.items) ? resp.items : [];
            return {
                items: list.map(it => ({ track: it.item != null ? it.item : it.track })),
                total: resp.total != null ? resp.total : list.length,
                limit: resp.limit,
                offset: resp.offset,
                href: resp.href,
                next: resp.next,
                previous: resp.previous
            };
        });
    }

    async getAlbumTracks(albumId, skip = 0, limit = 10) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const result = await this.api.getAlbum(albumId, {offset: skip, limit: limit});
            return result.body;
        });
    }

    async getPlaylist(playlistId, options) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        const fallback = (err) => ({
            name: "Unable to load",
            description: "GetPlaylist error: " + (err && err.message ? err.message : String(err)),
        });
        try {
            const resp = await this.api.getPlaylist(playlistId, options || {});
            return resp.body;
        } catch (err) {
            if (err.statusCode !== 404) {
                this.consoleError("Error on getPlaylist: " + playlistId, err);
            }
            this.consoleInfo("getPlaylist failed for " + playlistId + " (status " + (err.statusCode ?? '?') + "), trying Pathfinder fallback.");
            try {
                const body = await this.getPlaylistViaPathfinder(playlistId);
                const name = Spotify.getPlaylistNameFromPathfinderResponse(body);
                if (name) {
                    this.consoleInfo("getPlaylist Pathfinder fallback succeeded for " + playlistId + ": " + name);
                    return { name, description: "" };
                }
            } catch (err2) {
                this.consoleError("Pathfinder fallback failed for playlist: " + playlistId, err2);
            }
            return fallback(err);
        }
    }

    /**
     * Fetch playlist metadata (e.g. name) via internal Pathfinder API (api-partner.spotify.com).
     * Use when the official Web API returns 404 for some Spotify-owned/editorial playlists.
     * See PATHFINDER-PLAYLIST.md for request format. Returns raw GraphQL-style response;
     * use getPlaylistNameViaPathfinder() for just the name string.
     */
    async getPlaylistViaPathfinder(playlistId) {
        if (!this.isWebAuthTokenValid()) {
            await this.refreshWebAuthToken();
        }
        const clientToken = await this.getClientToken();
        const uri = playlistId.startsWith('spotify:playlist:') ? playlistId : `spotify:playlist:${playlistId}`;
        const body = {
            variables: { uri, offset: 0, limit: 25, enableWatchFeedEntrypoint: true },
            operationName: 'fetchPlaylist',
            extensions: {
                persistedQuery: { version: 1, sha256Hash: PATHFINDER_PLAYLIST_QUERY_HASH }
            }
        };
        return this.runTask(() =>
            agent.post(PATHFINDER_QUERY_URL)
                .set('Content-Type', 'application/json;charset=UTF-8')
                .set('Authorization', 'Bearer ' + this.web_auth.access_token)
                .set('client-token', clientToken.granted_token.token)
                .set('app-platform', 'WebPlayer')
                .set('spotify-app-version', SPOTIFY_WEB_APP_VERSION)
                .set('Origin', 'https://open.spotify.com')
                .set('Referer', 'https://open.spotify.com/')
                .set('User-Agent', USER_AGENT)
                .send(body)
                .then(resp => resp.body)
        , 1, 'getPlaylistViaPathfinder');
    }

    /**
     * Get playlist name from Pathfinder response. Handles common response shapes.
     * @param {object} pathfinderBody - Response from getPlaylistViaPathfinder()
     * @returns {string|null} Playlist name or null if not found
     */
    static getPlaylistNameFromPathfinderResponse(pathfinderBody) {
        if (!pathfinderBody || typeof pathfinderBody !== 'object') return null;
        const d = pathfinderBody.data;
        if (!d) return null;
        // playlistV2.data.name (common in Web Player)
        const pv2 = d.playlistV2?.data ?? d.playlistV2;
        if (pv2?.name) return pv2.name;
        if (d.fetchPlaylist?.name) return d.fetchPlaylist.name;
        if (d.playlist?.name) return d.playlist.name;
        return null;
    }

    async getTrack(trackId) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const result = await this.api.getTrack(trackId);
            return result.body;
        });
    }

    async getTrackByURI(uri) {
        return this.runTask(() => {
            return this.api.getTrack(uri.substring(uri.lastIndexOf(":") + 1))
                .then(track => track.body);
        });
    }

    /**
     * Fetch multiple tracks by ID. Uses GET /tracks/{id} per track (batch GET /tracks removed in Feb 2026).
     * Uses short-TTL cache to avoid re-fetching on song rollover; throttled in batches.
     */
    async getTracks(trackIds) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        const now = Date.now();
        const toFetch = [];
        const results = new Array(trackIds.length);
        for (let i = 0; i < trackIds.length; i++) {
            const id = trackIds[i];
            const entry = this._trackCache.get(id);
            if (entry && entry.expiresAt > now) {
                results[i] = entry.body;
            } else {
                toFetch.push({ id, index: i });
            }
        }
        if (toFetch.length === 0) {
            return results;
        }
        const BATCH_SIZE = 4;
        const BATCH_DELAY_MS = 150;
        const expiresAt = now + this._trackCacheTTLMs;
        return this.runTask(async () => {
            for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
                const batch = toFetch.slice(i, i + BATCH_SIZE);
                const batchResults = await Promise.all(
                    batch.map(({ id }) =>
                        this.api.getTrack(id).then(r => r.body).catch(() => null)
                    )
                );
                batch.forEach(({ id, index }, j) => {
                    const body = batchResults[j];
                    results[index] = body;
                    if (body) {
                        this._trackCache.set(id, { body, expiresAt });
                    }
                });
                if (i + BATCH_SIZE < toFetch.length) {
                    await this.sleep(BATCH_DELAY_MS);
                }
            }
            return results;
        }, 1, 'getTracks');
    }

    async getAlbum(albumId) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const result = await this.api.getAlbum(albumId);
            return result.body;
        });
    }

    async getArtist(artistId) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const result = await this.api.getArtist(artistId);
            return result.body;
        }, 1, 'getArtist');
    }

    async getArtistAlbums(artistId, skip = 0, limit = 10) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const result = await this.api.getArtistAlbums(artistId, {offset: skip, limit: limit});
            return result.body;
        });
    }

    async getMyDevices() {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.api.getMyDevices();
    }

    /**
     * Returns the current playback device (if active), otherwise returns the preferred device id.
     * @returns string device id
     */
    async getPlaybackDeviceId() {
        const activeDevice = await this.getMyDevices()
            .then(resp => resp.body.devices.find(d => d.is_active));
        if (activeDevice) {
            return activeDevice.id;
        }
        else if (process.env.PREFERRED_DEVICE_ID) {
            return process.env.PREFERRED_DEVICE_ID;
        }
        throw new Error("No playback device found.");
    }

    async transferPlaybackToDevice(deviceId, playNow) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.api.transferMyPlayback( { deviceIds: [deviceId], play: playNow });
    }

    async getPlaybackState() {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(() => {
            return this.api.getMyCurrentPlaybackState();
        }, 1, 'getPlaybackState');
    }

    async getLyrics() {
        if (!this.isWebAuthTokenValid()) {
            await this.refreshWebAuthToken();
        }
        return agent.get(`https://spclient.wg.spotify.com/color-lyrics/v2/track/${this.nowPlaying.now_playing.id}?format=json&vocalRemoval=false`)
            .auth(this.web_auth.access_token, {type: 'bearer'})
            .set('Content-Type', 'application/json')
            .set('accept', 'application/json')
            .set('User-Agent', USER_AGENT)
            .set('app-platform', 'WebPlayer')
            // .use(superdebug.default(console.info))
            .buffer(true)
            .send()
            .then(resp => JSON.parse(resp.text));
    }

    async getVolume() {
        const playbackState = await this.runTask(() => {
            return this.getPlaybackState();
        });
        if (playbackState.body.device) {
            return playbackState.body.device.volume_percent;
        }
        throw Error("No playback device found.");
    }

    async setVolume(volume) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        if (volume.trim().match(/^1?\d{0,2}$/)) {
            const v = parseInt(volume, 10);
            if (typeof v == 'number' && v <= 100) {
                return await this.runTask(() => {
                    return this.api.setVolume(v);
                });
            }
        }
        throw new Error("Volume can only be set to a whole number between 0 and 100.");
    }

    async queueTrack(trackURI) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        if (this.isTrackQueued(trackURI)) {
            throw new Error("Track already queued.");
        }
        return this.runTask(async () => {
            await this._verifyPlaybackState();
            const result = await this.api.addToQueue(trackURI);
            this.consoleInfo("Queued track response:", result);
            return result;
        });
    }

    isTrackQueued(trackUri) {
        const nowPlaying = this.getStatus();
        if (nowPlaying && nowPlaying.now_playing && nowPlaying.now_playing.uri == trackUri) {
            return true;
        }
        if (nowPlaying && nowPlaying.queued_tracks && nowPlaying.queued_tracks.length) {
            return nowPlaying.queued_tracks.filter(t => t.uri == trackUri).length > 0;
        }
        return false;
    }

    async skipTrack() {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(() => {
            return this.api.skipToNext();
        });
    }

    async prevTrack() {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(() => {
            return this.api.skipToPrevious();
        });
    }

    async getQueue() {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(() => {
            return this.api.getQueue();
        });
    }

    async togglePlay() {
        const state = await this.getPlaybackState();
        if (state && state.body && state.body.is_playing) {
            return this.pausePlayback();
        }
        return this.resumePlayback();
    }

    async pausePlayback() {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(() => {
            return this.api.pause();
        });
    }

    async resumePlayback() {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(async() => {
            return this.api.play({device_id: await this.getPlaybackDeviceId()});
        });
    }

    async setRepeat() {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(() => {
            return this.api.setRepeat("context");
        });
    }

    async setShuffle() {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(() => {
            return this.api.setShuffle(true);
        });
    }

    async play(uri) {
        this.consoleInfo("play request: ", uri);
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(async () => {
            let response;
            // official API does not support station/radio
            if (uri.indexOf(':station:') < 0 && uri.indexOf(':radio:') < 0) {
                response = await this.api.play({device_id: await this.getPlaybackDeviceId(), context_uri: uri});
            }
            else {
                response = await this._play(uri, this.fakeDeviceId, await this.getPlaybackDeviceId());
            }
            this.consoleInfo("play response:", response);
            await this.forceRepeatShuffle();
            return response;
        });
    }

    /**
     * Sends a play message to the corresponding device using the unofficial (web) API
     * @param uri e.g. spotify:radio:playlist:SPOTIFY_ID
     * @param fromDeviceId device sending this message
     * @param toDeviceId device doing the playback
     * @returns {Promise<T | *>}
     * @private
     */
    async _play(uri, fromDeviceId, toDeviceId) {
        this.consoleInfo("Request to _play: " + uri);
        if (!this.isWebAuthTokenValid()) {
            await this.refreshWebAuthToken();
        }
        return agent.post(`https://gew-spclient.spotify.com/connect-state/v1/player/command/from/${fromDeviceId}/to/${toDeviceId}`)
            .auth(this.web_auth.access_token, {type: 'bearer'})
            .set('Content-Type', 'application/json') // text/plain;charset=UTF-8 (in chrome web player)
            .set('User-Agent', USER_AGENT)
            .buffer(true)
            .send({
                "command": {
                    "context": {
                        "uri": uri,
                        "url": "context://" + uri,
                        "metadata": {}
                    },
                    "play_origin": {
                        "feature_identifier": "harmony",
                        "feature_version": "4.9.0-d242618"
                    },
                    "options": {
                        "license": "premium",
                        "skip_to": {},
                        "player_options_override": {
                            "repeating_track": false,
                            "repeating_context": true
                        }
                    },
                    "endpoint": "play"
                }
            })
            .then(resp => JSON.parse(resp.text))
            .catch(err => {
                this.consoleError("Failed to play uri: " + uri, err);
                throw err;
            });
    }

    getStatus() {
        return this.nowPlaying || {};
    }

    /**
     * Registers a fake device so we can listen for events and push our state onto the currently playing device.
     * The random device id will be stored in this.fakeDeviceId.
     * @returns {Promise<*>}
     */
    async registerFakeDevice() {
        if (!this.isWebAuthTokenValid()) {
            await this.refreshWebAuthToken();
        }
        this.fakeDeviceId = crypto.randomBytes(20).toString("hex");
        this.consoleInfo("Registering fake device id " + this.fakeDeviceId);
        return agent.post(`https://gew-spclient.spotify.com/track-playback/v1/devices`)
            .auth(this.web_auth.access_token, {type: 'bearer'})
            .set('Content-Type', 'application/json')
            .set('User-Agent', USER_AGENT)
            .buffer(true)
            .send({
                "device": {
                    "brand": "spotify",
                    "capabilities": {
                        "change_volume": true,
                        "enable_play_token": true,
                        "supports_file_media_type": true,
                        "play_token_lost_behavior": "pause",
                        "disable_connect": true,
                        "audio_podcasts": true,
                        "video_playback": true,
                        "manifest_formats": [
                            "file_urls_mp3",
                            "manifest_ids_video",
                            "file_urls_external",
                            "file_ids_mp4",
                            "file_ids_mp4_dual"
                        ]
                    },
                    "device_id": this.fakeDeviceId,
                    "device_type": "computer",
                    "metadata": {},
                    "model": "web_player",
                    "name": "Fake Jambot Player",
                    "platform_identifier": "web_player windows 10;chrome 87.0.4280.66;desktop"
                },
                "connection_id": this.spotifyConnectionId,
                "client_version": "harmony:4.11.0-af0ef98",
                "volume": 65535
            })
            .then(resp => {
                this.consoleInfo("Device registration response", resp);
                return JSON.parse(resp.text);
            })
            .catch(err => {
                this.consoleError("Failed to register fake device.", err);
                throw err;
            });
    }

    /**
     * Ask spotify to message our fake device whenever there is a state change.
     * @returns {Promise<*>}
     */
    async registerDeviceForNotifications() {
        if (!this.isWebAuthTokenValid()) {
            await this.refreshWebAuthToken();
        }
        const clientToken = await this.getClientToken();
        this.consoleInfo("Client token: ", clientToken);
        return agent.put(`https://gew-spclient.spotify.com/connect-state/v1/devices/hobs_${this.fakeDeviceId}`)
            .auth(this.web_auth.access_token, {type: 'bearer'})
            .set('Content-Type', 'application/json')
            .set('User-Agent', USER_AGENT)
            .set('X-Spotify-Connection-Id', this.spotifyConnectionId)
            .set('Client-Token', clientToken.granted_token.token)
            .buffer(true) // because content-type isn't set in the response header, we need to get the raw text rather than the (parsed) body
            .send({
                member_type: "CONNECT_STATE",
                device: {device_info: {capabilities: {can_be_player: false, hidden: true, needs_full_player_state: true}}}
            })
            .then(resp => {
                this.consoleInfo("Notification registration response", resp);
                return JSON.parse(resp.text);
            })
            .catch(err => {
                if (err.statusCode == 429) {
                    this.consoleError("Too many requests. Swallowing exception", err);
                }
                else {
                    this.consoleError("Failed to register for notifications.", err);
                    throw err;
                }
            });
    }

    async getClientToken() {
        return agent.post("https://clienttoken.spotify.com/v1/clienttoken")
            .set('Accept', 'application/json')
            .set('Content-Type', 'application/json')
            .set('User-Agent', USER_AGENT)
            .send({
                "client_data": {
                    "client_version": "1.2.66.349.gb8b186bd",
                    "client_id": this.web_auth.client_id,
                    "js_sdk_data": {
                        "device_brand": "Apple",
                        "device_model": "unknown",
                        "os": "macos",
                        "os_version": "10.15.7",
                        "device_id": this.fakeDeviceId,
                        "device_type": "computer"
                    }
                }
            })
            .then(resp => JSON.parse(resp.text))
            .catch(err => {
                this.consoleError("Failed to get client token.", err);
                throw err;
            });
    }

    async resetWebsocket() {
        if (this.ws) {
            clearInterval(this.ws.interval);
            this.ws.onclose = () => {};
            this.ws.close();
            this.ws.isAlive = false;
            this.ws = null;
            this.consoleInfo("Resetting websocket...");
        }
        return Promise.resolve("OK");
    }

    async initWebsocket() {
        this.consoleInfo("WS: Initializing websocket to Spotify.");
        if (!this.isWebAuthTokenValid()) {
            await this.refreshWebAuthToken();
        }
        this.ws = new W3CWebSocket("wss://gew1-dealer.spotify.com/?access_token=" + this.web_auth.access_token);
        this.ws.onerror = (error) => this.consoleError('WS Connect Error:', error);
        this.ws.onopen = () => {
            this.consoleInfo('WS connected');
            this.ws.isAlive = true;

            this.ws.interval = setInterval( () => {
                if(this.ws.isAlive === false) {
                    this.consoleInfo("WS: Did not receive echo back. Forcing disconnect.");
                    return this.ws.close();
                }
                this.ws.isAlive = false;
                this.consoleInfo("WS: sending ping...");
                this.ws.send(JSON.stringify({"type":"ping"}));
            }, 30000 );
        }
        this.ws.onclose = () => {
            this.consoleInfo("WS: Disconnected!");
            clearInterval(this.ws.interval);
            this.sleep(2000)
                .then(() => this.initWebsocket()) // keepalive!
                .catch(e => {
                    this.consoleError("Failed to reinitialize web socket: ", e);
                    this.ws.onclose(); // retry indefinitely
                });
        }
        this.ws.onmessage = async(event) => {
            const payload = JSON.parse(event.data);
            if(payload.type === "pong") {
                this.consoleInfo("WS: received echo back :)");
                if (this.nowPlaying && Date.now() - this.nowPlaying.last_updated > 600000) {
                    this.consoleInfo("Over 10 minutes since last update... forcing disconnect");
                    this.nowPlaying.last_updated = Date.now();
                    await this._verifyPlaybackState().catch(e => {
                        this.consoleError("Failed to verify playback state: ", e);
                    });
                } else {
                    this.ws.isAlive = true;
                }
            }
            else {
                this.consoleInfo("WS message:", payload)
                if (payload.headers['Spotify-Connection-Id']) {
                    this.spotifyConnectionId = payload.headers['Spotify-Connection-Id'];
                    this.consoleInfo("WS initialized spotify-connection-id: " + this.spotifyConnectionId);

                    // this should now trigger events
                    await this.registerFakeDevice()
                        .then(() => this.registerDeviceForNotifications())
                        .then(resp => {
                            if (resp && resp.player_state && resp.player_state.track && resp.player_state.next_tracks) {
                                return this._updateNowPlaying(resp.player_state);
                            }
                            return this._updateNowPlayingFromPlaybackState();
                        })
                        .catch(err => {
                            if (err.statusCode == 429) {
                                this.consoleError("Too many requests. Swallowing exception", err);
                            }
                            else {
                                this.consoleError("Failed to register for notifications.", err);
                                this.ws.isAlive = false; // try again by forcing connection reset
                            }
                        });
                }
                else {
                    // update what's currently playing based on the CHANGE event
                    if (payload.payloads) {
                        payload.payloads
                            .filter(p => p.update_reason === "DEVICE_STATE_CHANGED" || p.update_reason === "DEVICE_VOLUME_CHANGED")
                            .forEach(p => {
                                this._updateNowPlaying(p.cluster.player_state)
                                    .then(() => {
                                        this.nowPlaying.volume = Math.round(p.cluster.devices[p.cluster.active_device_id].volume / 65535 * 100);
                                        this.consoleInfo("Volume set to ", this.nowPlaying.volume);
                                    })
                                    .catch(e => this.consoleError("Failed to update now playing: ", e))
                            })
                    }
                }
            }
        }
    }

    /**
     * Populates this.nowPlaying from the Web API playback state when the WS registration response has no player_state.
     * @returns {Promise<void>}
     * @private
     */
    async _updateNowPlayingFromPlaybackState() {
        try {
            const playback = await this.getPlaybackState();
            if (!playback || !playback.body || !playback.body.item) {
                this.consoleInfo("No playback state or item; now playing not updated.");
                return;
            }
            const item = playback.body.item;
            this.nowPlaying = {
                last_updated: Date.now(),
                timestamp: playback.body.timestamp || Date.now(),
                is_playing: !!playback.body.is_playing,
                progress_ms: playback.body.progress_ms || 0,
                duration_ms: item.duration_ms || 0,
                now_playing: {
                    id: item.id,
                    uri: item.uri,
                    song_title: item.name,
                    artist: (item.artists || []).map(a => a.name).join(', '),
                    album: item.album ? { id: item.album.id, images: item.album.images || [], name: item.album.name } : {}
                },
                next_track: null,
                queued_tracks: [],
                playlist_tracks: [],
                context: this.nowPlaying?.context ?? null,
                context_title: this.nowPlaying?.context_title || ''
            };
            this.consoleInfo("Now Playing (from playback state):", this.nowPlaying);
        } catch (err) {
            this.consoleError("Failed to update now playing from playback state:", err);
        }
    }

    /**
     * Updates this.nowPlaying with the currently playing/queued and context.
     * Sets UI immediately from playerState so the UI stays responsive on song rollover; then enriches in background.
     * @param playerState Object
     * @returns {Promise<void>}
     * @private
     */
    async _updateNowPlaying(playerState) {
        if (!playerState || !playerState.track || !playerState.next_tracks) {
            this.consoleInfo("No track information found in player state. Now playing not updated.");
            return;
        }
        const trackDict = [];
        playerState.next_tracks.forEach(t => trackDict[t.uri] = t);
        // WebSocket/Connect payload uses ContextTrack: { uri, uid?, metadata? }. Display fields are in metadata
        // (metadata.title, metadata.artist_uri, metadata.album_title). Full Web API track has name, artists, album.
        const getTrackInfo = (track) => {
            const meta = track.metadata || {};
            const id = track.id ?? (track.uri ? track.uri.substring(track.uri.lastIndexOf(':') + 1) : null);
            const song_title = track.name ?? meta.title ?? '';
            const artist = track.artists?.length
                ? track.artists.map(a => a.name).join(', ')
                : (meta.artist_name ?? '');
            const albumName = track.album?.name ?? meta.album_title ?? '';
            const albumId = track.album?.id ?? (meta.album_uri ? meta.album_uri.substring(meta.album_uri.lastIndexOf(':') + 1) : null);
            return {
                id,
                uri: track.uri,
                song_title,
                artist,
                album: (albumName || albumId) ? { id: albumId, images: track.album?.images ?? [], name: albumName } : {},
                is_queued: trackDict[track.uri]?.metadata?.is_queued == 'true'
            };
        };
        const minimalNowPlaying = getTrackInfo(playerState.track);
        const contextTitleSuffix = (ctx) => !ctx ? '' : (ctx.name || '')
            + (ctx.type == "playlist" ? " Playlist" : "")
            + (ctx.type == "playlist radio" ? " Playlist Radio" : "")
            + (ctx.type == "album" ? " by " + (ctx.artists || '') : "")
            + (ctx.type == "track radio" ? " Track Radio" : "")
            + (ctx.type == "album radio" ? " Album Radio" : "")
            + (ctx.type == "artist radio" ? " Radio" : "");

        this._updateNowPlayingGeneration = (this._updateNowPlayingGeneration || 0) + 1;
        const gen = this._updateNowPlayingGeneration;

        this.nowPlaying = {
            last_updated: Date.now(),
            timestamp: parseInt(playerState.timestamp),
            is_playing: !playerState.is_paused,
            progress_ms: parseInt(playerState.position_as_of_timestamp),
            duration_ms: parseInt(playerState.duration),
            now_playing: minimalNowPlaying,
            next_track: null,
            queued_tracks: [],
            playlist_tracks: [],
            context: this.nowPlaying?.context ?? null,
            context_title: (this.nowPlaying?.context_title) || ''
        };
        this.consoleInfo("Now Playing:", this.nowPlaying);

        // If we have artist_uri but no artist name yet, fetch artist in background and patch (skip when rate limited)
        const meta = playerState.track.metadata || {};
        if (minimalNowPlaying.artist === '' && meta.artist_uri && Date.now() >= this._rateLimitedUntil) {
            const artistId = meta.artist_uri.substring(meta.artist_uri.lastIndexOf(':') + 1);
            this.getArtist(artistId)
                .then((artistBody) => {
                    if (this._updateNowPlayingGeneration === gen && this.nowPlaying?.now_playing) {
                        this.nowPlaying = {
                            ...this.nowPlaying,
                            now_playing: { ...this.nowPlaying.now_playing, artist: artistBody.name }
                        };
                    }
                })
                .catch(() => {});
        }

        const nextIds = playerState.next_tracks
            .filter(t => t.uri && t.uri.indexOf("spotify:track:") >= 0)
            .slice(0, 19)
            .map(t => t.uri.substring(t.uri.lastIndexOf(":") + 1));
        const trackIds = [
            playerState.track.uri.substring(playerState.track.uri.lastIndexOf(":") + 1),
            ...nextIds
        ];

        Promise.all([
            this.getTracks(trackIds),
            this._getCurrentContext(playerState.context_uri)
        ]).then(([trackBodies, playlist_context]) => {
            if (gen !== this._updateNowPlayingGeneration) return;
            const nextTracks = trackBodies.filter(Boolean).map(t => getTrackInfo(t));
            this.nowPlaying = {
                last_updated: Date.now(),
                timestamp: parseInt(playerState.timestamp),
                is_playing: !playerState.is_paused,
                progress_ms: parseInt(playerState.position_as_of_timestamp),
                duration_ms: parseInt(playerState.duration),
                now_playing: nextTracks[0] || minimalNowPlaying,
                next_track: nextTracks[1] || null,
                queued_tracks: nextTracks.slice(1).filter(t => t.is_queued),
                playlist_tracks: nextTracks.slice(1).filter(t => !t.is_queued).slice(0, 20),
                context: playlist_context,
                context_title: playlist_context ? contextTitleSuffix(playlist_context) : ''
            };
            this.consoleInfo("Now Playing (enriched):", this.nowPlaying);
        }).catch(err => {
            this.consoleError("Enrich now-playing failed (UI already updated):", err);
        });
    }

    /**
     * Checks we're still logged into Spotify and current playing something. Resumes playback if not.
     * @returns {Promise<void>}
     * @private
     */
    async _verifyPlaybackState() {

        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        if (!this.isWebAuthTokenValid()) {
            await this.refreshWebAuthToken();
        }

        // now check if it's currently playing anything... start it if not
        const playback = await this.getPlaybackState();
        if (!playback.body || false === playback.body.is_playing) {
            // do we have anything to play
            if (!playback.body || (playback.body.context == null && playback.body.item == null)) {
                await this.api.play({
                    device_id: await this.getPlaybackDeviceId(),
                    context_uri: this.nowPlaying && this.nowPlaying.context && this.nowPlaying.context.uri ?
                        this.nowPlaying.context.uri : process.env.SPOTIFY_FALLBACK_PLAYLIST_URI
                });
            } else { // resume previous context
                await this.api.play({device_id: await this.getPlaybackDeviceId()});
            }
        }
        await this.forceRepeatShuffle(playback);
    }

    /**
     * Sets shuffle and repeat mode on (if possible)
     * @param playbackState (optional) the current playback state
     * @returns {Promise<void>}
     */
    async forceRepeatShuffle(playbackState) {
        const playback = playbackState != null ? playbackState : await this.getPlaybackState();

        // force repeat/shuffle
        if (playback.body && !playback.body?.actions?.disallows?.toggling_repeat_context && playback.body.repeat_state == "off") {
            await this.setRepeat();
        }
        if (playback.body && !playback.body?.actions?.disallows?.toggling_shuffle && playback.body.shuffle_state == false) {
            await this.setShuffle();
        }
    }

    setArtistRadio(artistId) {
        return this.runTask(() => this._setContextRadio(() => this.api.getArtist(artistId)));
    }

    setAlbumRadio(albumId) {
        return this.runTask(() => this._setContextRadio(() => this.api.getAlbum(albumId)));
    }

    setPlaylistRadio(playlistId) {
        return this.runTask(() => this._setContextRadio(() => this.api.getPlaylist(playlistId)));
    }

    async _setContextRadio(fnRetrieveitem) {
        await this._verifyPlaybackState();

        const item = await fnRetrieveitem();
        this.consoleInfo(`Attempting to set ${item.body.name} ${item.body.type} radio.`);
        return await this.play(`spotify:radio:${item.body.type}:${item.body.id}`);
    }

    /**
     * Returns the currently playing context (e.g. album, track, playlist...)
     * @param contextUri spotify context URI
     * @returns {Promise<unknown>}
     * @private
     */
    async _getCurrentContext(contextUri) {
        const is_radio = contextUri.indexOf("radio") >= 0 || contextUri.indexOf("station") >= 0;
        const id = contextUri.substr(contextUri.lastIndexOf(":") + 1);
        if (contextUri.indexOf("playlist") >= 0) {
            const playlist = await this.getPlaylist(id, {fields: "name,description"})
            return {
                type: "playlist" + (is_radio ? " radio" : ""),
                name: playlist.name,
                uri: contextUri
            };
        }
        else if (contextUri.indexOf("album") >= 0) {
            const album = await this.getAlbum(id)
            return {
                type: "album" + (is_radio ? " radio" : ""),
                name: album.name,
                artists: album.artists.map(a => a.name).join(", "),
                uri: contextUri
            };
        }
        else if (contextUri.indexOf("artist") >= 0) {
            const artist = await this.getArtist(id)
            return {
                type: "artist" + (is_radio ? " radio" : ""),
                name: artist.name,
                uri: contextUri
            };
        }
        else if (contextUri.indexOf("track") >= 0) {
            const track = await this.getTrack(id)
            return {
                type: "track" + (is_radio ? " radio" : ""),
                name: track.name,
                artists: track.artists.map(a => a.name).join(', '),
                uri: contextUri
            };
        }
        this.consoleError("Unable to determine context from URI: " + contextUri)
        return Promise.resolve(null);
    }

    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    consoleInfo(...args) {
        infoLog.info(args.map(x => typeof x !== 'string' ? JSON.stringify(x) : x).join(' '));
    }

    consoleError(...args) {
        errorLog.error(args.map(x => typeof x !== 'string' ? JSON.stringify(x) : x).join(' '));
    }
}

module.exports = new Spotify();