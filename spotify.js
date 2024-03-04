const SpotifyWebApi = require("spotify-web-api-node");
const W3CWebSocket = require('websocket').w3cwebsocket;
const agent = require('superagent').agent();
// const superdebug = require('superagent-debugger');
const fs = require("fs");
const dotenv = require("dotenv");
dotenv.config();

class Spotify {

    // (re)attempt a task, a given number of times
    async runTask(task, limit = 5) {
        return task().catch(async(e) => {
            this.consoleError(`Attempt failed, ${limit} tries remaining.`, e);
            if (e.message == "Unauthorized") {
                await this.initializeAuthToken();
            }
            if (limit <= 0) {
                this.consoleError("Too many attempts. Giving up.");
                throw e;
            }
            return this.runTask(task, limit - 1);
        })
    }

    async initializeAuthToken() {
        // Initialise connection to Spotify
        this.api = new SpotifyWebApi({
            clientId: process.env.SPOTIFY_CLIENT_ID,
            clientSecret: process.env.SPOTIFY_CLIENT_SECRET,
            redirectUri: process.env.REDIRECT_URI
        });

        // Generate a Url to authorize access to Spotify (requires login credentials)
        const scopes = ["user-modify-playback-state", "user-read-currently-playing", "user-read-playback-state", "streaming"];
        const authorizeUrl = this.api.createAuthorizeURL(scopes, "default-state");
        this.consoleInfo(`Authorization required. Going to ${authorizeUrl}`);
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
     * Takes the cookies from the cURL command given. In Chrome dev tools (F12), under the Network tab,
     * right click, Copy, Copy as cURL.
     * @param curlCommand the copied cURL command
     * @returns {Promise} cookie string or Exception if not found
     */
    stripCookiesFromCurl(curlCommand) {
        const cookieLine = curlCommand.split("\n").filter(line => line.indexOf("cookie:") >= 0);
        if (cookieLine.length == 0) {
            return Promise.reject(new Error("Unable to find any cookies?"));
        }
        const firstIndex = cookieLine[0].indexOf("cookie:") + "cookie:".length + 1;
        const lastIndex = cookieLine[0].lastIndexOf("'");
        if (lastIndex < firstIndex) {
            return Promise.reject(new Error("Unable to find the proper cookie header"));
        }
        return Promise.resolve(cookieLine[0].substring(firstIndex, lastIndex));
    }

    /**
     * Calls #refreshWebAuthToken with the cookies extracted from the cURL command
     * @param curlCommand
     * @returns {Promise<void>}
     */
    async refreshWebAuthTokenFromCurl(curlCommand) {
        return this.stripCookiesFromCurl(curlCommand)
            .then(cookies => this.refreshWebAuthToken(cookies));
    }

    /**
     * Web token is used as bearer authorization for certain (unpublished) API requests.
     */
    async refreshWebAuthToken(cookies = null) {
        if (cookies == null) {
            cookies = this.web_auth.cookies;
        }
        this.web_auth = await agent.get("https://open.spotify.com/get_access_token")
            .query({reason: "transport", productType: "web_player"})
            .set('Content-Type', 'application/json')
            .set('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/78.0.3904.97 Safari/537.36')
            .set('Cookie', cookies)
            // .use(superdebug.default(console.info))
            .then(resp => {
                // isAnonymous should be false (Spotify should be able to identify who's account it is)
                if (resp.body.isAnonymous) {
                    throw new Error("Unable to retrieve access token");
                }
                return {
                    access_token: resp.body.accessToken,
                    expires_at: resp.body.accessTokenExpirationTimestampMs
                }
            });
        this.web_auth.cookies = cookies;
        this.consoleInfo("Web Access Token:", this.web_auth.access_token);
        return Promise.resolve('OK');
    }

    isAuthTokenValid() {
        if (this.auth == undefined || this.auth.expires_at == undefined) {
            return false;
        }
        else if (this.auth.expires_at < new Date()) {
            return false;
        }
        return true;
    }

    isWebAuthTokenValid() {
        if (this.web_auth == undefined || this.web_auth.expires_at == undefined) {
            return false;
        }
        else if (this.web_auth.expires_at < new Date()) {
            return false;
        }
        return true;
    }

    async initialized() {
        this.consoleInfo("Spotify is ready!");
        return Promise.resolve('OK');
    }

    async refreshAuthToken() {
        const result = await this.api.refreshAccessToken();

        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + result.body.expires_in);
        this.auth.access_token = result.body.access_token;
        this.auth.expires_at = expiresAt;

        this.api.setAccessToken(result.body.access_token);
        this.consoleInfo("Access Token:", result.body.access_token);
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
        const expiresAt = new Date();
        expiresAt.setSeconds(expiresAt.getSeconds() + authFlow.body.expires_in);
        this.auth.expires_at = expiresAt;

        // Provide the Spotify library with the tokens
        this.api.setAccessToken(this.auth.access_token);
        this.api.setRefreshToken(this.auth.refresh_token);
        this.consoleInfo("Access Token:", this.auth.access_token);
        this.consoleInfo("Refresh Token:", this.auth.refresh_token);

        return {
            access_token: this.auth.access_token,
            refresh_token: this.auth.refresh_token
        };
    }

    async searchTracks(terms, skip = 0, limit = 10) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const result = await this.api.searchTracks(terms, {offset: skip, limit: limit});
            return result.body;
        });
    }

    async search(terms, types, skip = 0, limit = 10) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const result = await this.api.search(terms, types, {offset: skip, limit: limit});
            return result.body;
        });
    }

    async getPlaylistTracks(playlistId, skip = 0, limit = 10) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const result = await this.api.getPlaylistTracks(playlistId, {offset: skip, limit: limit});
            return result.body;
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
        return this.runTask(async () => {
            const result = await this.api.getPlaylist(playlistId, options);
            return result.body;
        });
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

    async getTracks(trackIds) {
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return this.runTask(async () => {
            const result = await this.api.getTracks(trackIds);
            return result.body.tracks;
        });
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
        });
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
        });
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
        return this.runTask(async () => {
            await this._verifyPlaybackState();
            const result = await this.api.addToQueue(trackURI);
            this.consoleInfo("Queued track response:", result);
            return result;
        });
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
        return await this.runTask(() => {
            return this.api.play({device_id: process.env.PREFERRED_DEVICE_ID});
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
        if (!this.isAuthTokenValid()) {
            await this.refreshAuthToken();
        }
        return await this.runTask(async () => {
            let response;
            // official API does not support station/radio
            if (uri.indexOf('station') < 0 && uri.indexOf('radio') < 0) {
                response = await this.api.play({device_id: process.env.PREFERRED_DEVICE_ID, context_uri: uri});
            } else {
                const webPlayerId = await this._getWebPlayerId();
                response = await this._play(uri, webPlayerId, process.env.PREFERRED_DEVICE_ID);
            }
            this.consoleInfo("play response:", response);
            await this.forceRepeatShuffle();
            return response;
        });
    }

    async _getWebPlayerId() {
        let devices = await this.getMyDevices();
        const fn_filter_web_player = dev => dev.name == "Web Player (Chrome)";
        devices = devices.body.devices.filter(fn_filter_web_player);
        if (devices.length == 0) {
            devices = await this.getMyDevices();
            devices = devices.body.devices.filter(fn_filter_web_player);
            if (devices.length == 0) {
                throw new ReferenceError("Error looking up device. Please try again later.");
            }
        }
        return devices[0].id;
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
        if (!this.isWebAuthTokenValid()) {
            await this.refreshWebAuthToken();
        }
        return agent.post(`https://gew-spclient.spotify.com/connect-state/v1/player/command/from/${fromDeviceId}/to/${toDeviceId}`)
            .auth(this.web_auth.access_token, {type: 'bearer'})
            .set('Content-Type', 'application/json') // text/plain;charset=UTF-8 (in chrome web player)
            .set('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/78.0.3904.97 Safari/537.36')
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
                this.consoleError("Failed to play radio.", err);
                throw err;
            });
    }

    getStatus() {
        return this.nowPlaying;
    }

    async _getConnectState() {
        if (!this.isWebAuthTokenValid()) {
            await this.refreshWebAuthToken();
        }
        if (!this.spotifyConnectionId) {
            throw new ReferenceError("Spotify connection not initialized.");
        }
        const webPlayerDeviceId = await this._getWebPlayerId();
        return agent.put("https://gew-spclient.spotify.com/connect-state/v1/devices/hobs_" + webPlayerDeviceId.substr(0, 35))
            .auth(this.web_auth.access_token, {type: 'bearer'})
            // .use(superdebug.default(console.info))
            .set('Content-Type', 'application/json')
            .set('User-Agent', 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/78.0.3904.97 Safari/537.36')
            .set('X-Spotify-Connection-Id', this.spotifyConnectionId)
            .buffer(true) // because content-type isn't set in the response header, we need to get the raw text rather than the (parsed) body
            .send({
                member_type: "CONNECT_STATE",
                device: {device_info: {capabilities: {can_be_player: false, hidden: true}}}
            })
            .then(resp => JSON.parse(resp.text))
            .catch(err => {
                this.consoleError("Failed to retrieve connection state.", err);
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

    async _initWebsocket() {
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
                .then(() => this._initWebsocket()) // keepalive!
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
                    try {
                        this.spotifyConnectionId = payload.headers['Spotify-Connection-Id'];
                        this.consoleInfo("WS initialized spotify-connection-id: " + this.spotifyConnectionId);

                        // this should now trigger events
                        let resp = await this._getConnectState();
                        this.consoleInfo("WS connection state response: ", resp);
                        await this._updateNowPlaying(resp.player_state);
                    }
                    catch (ex) {
                        this.consoleError("Failed to register new connection id:", ex);
                        this.ws.isAlive = false; // try again by forcing connection reset
                    }
                }
                else {
                    // update what's currently playing based on the CHANGE event
                    if (payload.payloads) {
                        const activeDevices = payload.payloads.filter(p => p.devices_that_changed && p.devices_that_changed.includes(process.env.PREFERRED_DEVICE_ID));
                        if (activeDevices.length) {
                            await this._updateNowPlaying(activeDevices[0].cluster.player_state);
                        }
                    }
                }
            }
        }
    }

    /**
     * Updates this.nowPlaying with the currently playing/queued and context.
     * @param playerState Object
     * @returns {Promise<void>}
     * @private
     */
    async _updateNowPlaying(playerState) {
        if(playerState && playerState.track && playerState.next_tracks) {
            // for efficiency, get all track info in one request
            let trackIds = [playerState.track.uri];
            trackIds.push(...playerState.next_tracks
                .filter(t => t.metadata && t.metadata.is_queued == 'true')
                .map(t => t.uri));
            trackIds = trackIds.slice(0, 50) // API allows for max of 50
                .map(uri => uri.substring(uri.lastIndexOf(":") + 1));
            const tracks = await this.getTracks(trackIds);
            const getTrackInfo = (track) => {
                return {
                    id: track.id,
                    song_title: track.name,
                    artist: track.artists.map(a => a.name).join(', '),
                    album: track.album
                }
            };
            this.nowPlaying = {
                last_updated: Date.now(), // FIXME: this is duplicated with timestamp, do we need both?
                timestamp: parseInt(playerState.timestamp),
                is_playing: !playerState.is_paused,
                progress_ms: parseInt(playerState.position_as_of_timestamp),
                duration_ms: parseInt(playerState.duration),
                now_playing: getTrackInfo(tracks[0]),
                next_track: playerState.next_tracks ? getTrackInfo(await this.getTrackByURI(playerState.next_tracks[0].uri)) : null,
                queued_tracks: tracks.slice(1).map(t => getTrackInfo(t)),
                context: await this._getCurrentContext(playerState.context_uri)
            };
            this.consoleInfo("Now Playing:", this.nowPlaying);
        }
        else {
            this.consoleInfo("No track information found in player state. Now playing not updated.");
        }
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
                    device_id: process.env.PREFERRED_DEVICE_ID,
                    context_uri: this.nowPlaying && this.nowPlaying.context && this.nowPlaying.context.uri ?
                        this.nowPlaying.context.uri : process.env.SPOTIFY_FALLBACK_PLAYLIST_URI
                });
            } else { // resume previous context
                await this.api.play({device_id: process.env.PREFERRED_DEVICE_ID});
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
        return this.webqueue(() => this._setContextRadio(() => this.api.getArtist(artistId)));
    }

    setAlbumRadio(albumId) {
        return this.webqueue(() => this._setContextRadio(() => this.api.getAlbum(albumId)));
    }

    setPlaylistRadio(playlistId) {
        return this.webqueue(() => this._setContextRadio(() => this.api.getPlaylist(playlistId)));
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
        const arg_copy = [...args];
        arg_copy.splice(0, 0, new Date().toLocaleString())
        console.info(...arg_copy);
    }

    consoleError(...args) {
        const arg_copy = [...args];
        arg_copy.splice(0, 0, new Date().toLocaleString())
        console.error(...arg_copy);
    }
}

module.exports = new Spotify();