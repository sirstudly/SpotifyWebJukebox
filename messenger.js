const spotify = require("./spotify");
const agent = require('superagent').agent();
const errorLog = require('./logger').errorlogger;
const infoLog = require('./logger').infoLogger;

const Commands = {
    ADD_TRACK: "ADD_TRACK",
    SEARCH_MORE: "SEARCH_MORE",
    SEARCH_PLAYLISTS: "SEARCH_PLAYLISTS",
    SEARCH_ALBUMS: "SEARCH_ALBUMS",
    SEARCH_ARTISTS: "SEARCH_ARTISTS",
    STATUS: "STATUS",
    GET_STARTED: "GET_STARTED",
    VIEW_TRACKS: "VIEW_TRACKS",
    VIEW_ALBUMS: "VIEW_ALBUMS",
    SET_PLAYLIST: "SET_PLAYLIST",
    SET_PLAYLIST_RADIO: "SET_PLAYLIST_RADIO",
    PLAY_ALBUM: "PLAY_ALBUM",
    PLAY_ALBUM_RADIO: "PLAY_ALBUM_RADIO",
    PLAY_ARTIST: "PLAY_ARTIST",
    PLAY_ARTIST_RADIO: "PLAY_ARTIST_RADIO"
}

class Messenger {
    receivedMessage(event) {
        // Inform the user that we've read their message 
        this.sendReadReceipt(event.sender.id);

        // for traceability, debugging
        this.logEvent(event);

        // Here I'm just treating quick-reply buttons as postback buttons, to avoid repeating code
        if (event.message.quick_reply != null) {
            return this.receivedPostback({ sender: event.sender, postback: event.message.quick_reply });
        }
        else if (typeof event.message.text == 'undefined' || event.message.text.toLowerCase() === 'status'
            || event.message.text.toLowerCase().replace("'", '')
                .replace('’', '').startsWith('whats playing')) {
            this.getStatus(event.sender.id);
        }
        else if (event.message.text.startsWith(':')) {
            const command = event.message.text.toLowerCase().substr(1)
                .split(/\s+/)
                .filter(text => text.length);
            if (command.length && false == this.isSenderOnBlacklist(event.sender.id)) {
                switch (command[0]) {
                    case 'volume':
                        this.postVolume(event.sender.id, command.length == 1 ? null : command[1]);
                        break;
                    case 'skip':
                        this.skipTrack(event.sender.id);
                        break;
                    case 'play':
                        this.resumePlayback(event.sender.id);
                        break;
                    case 'pause':
                        this.pausePlayback(event.sender.id);
                        break;
                    default:
                        this.sendMessage(event.sender.id, {text: "Unrecognized command: " + command[0]});
                }
            }
        }
        else if (event.message.text.toLowerCase().startsWith('%')) {
            // see if we received a URL, retrieve type and id (remove any extra params)
            // it could also be a spotify URI, eg. spotify:playlist or spotify:user:playlist
            const runMatches = (searchTerm) => {
                const regexMatch = searchTerm.match(/^.*spotify\.com\/(.*)\/(.*?)(\?.*)?$/);
                return regexMatch ? regexMatch : searchTerm.match(/^.*:(.*):(.*)$/);
            }
            const matches = runMatches(event.message.text.substr(1));
            if(matches && matches.length) {
                if(matches[1] == 'playlist') {
                    spotify.getPlaylist(matches[2])
                        .then(ps => this.collatePlaylistResults({items: [ps], total: 1}))
                        .then(message => this.sendMessage(event.sender.id, message));
                }
                else if(matches[1] == 'album') {
                    spotify.getAlbum(matches[2])
                        .then(ps => this.collateAlbumResults({items: [ps], total: 1}))
                        .then(message => this.sendMessage(event.sender.id, message));
                }
                else if(matches[1] == 'artist') {
                    spotify.getArtist(matches[2])
                        .then(ps => this.collateArtistResults({items: [ps], total: 1}))
                        .then(message => this.sendMessage(event.sender.id, message));
                }
                else {
                    this.showSearchSelectButtons(event.sender.id, event.message.text.substr(1));
                }
            }
            else {
                this.showSearchSelectButtons(event.sender.id, event.message.text.substr(1));
            }
        }
        else {
            this.searchMusic(event.sender.id, event.message.text);
            if (process.env.VOLUME_ADJUST_DISABLED !== 'true' && event.message.text.toLowerCase().indexOf('volume') !== -1) {
                this.sendMessage(event.sender.id, {
                    text: "If you wanted to change the volume, type :volume to check" +
                        " the current level. :volume 50 will set it to 50% or :volume 100 will set it to 100%."
                });
            }
        }
    }

    async receivedPostback(event) {
        this.logEvent(event); // for traceability, debugging
        const payload = JSON.parse(event.postback.payload);
        switch (payload.command) {
            case Commands.GET_STARTED: {
                this.sendMessage(event.sender.id, {text: "What would you like to hear?"});
                break;
            }
            case Commands.ADD_TRACK: {
                // Add the track (contained in the payload) to the Spotify queue.
                // Note: We created this payload data when we created the button in searchMusic()
                if (this.isSenderOnBlacklist(event.sender.id)) {
                    break;
                }
                else if (this.isTrackQueued(payload.track)) {
                    await this.getStatus(event.sender.id); // sends current queue
                    await this.sendMessage(event.sender.id, {text: "This track has already been queued."});
                    break;
                }
                else if (await this.isTrackBlacklisted(payload.track)) {
                    if (process.env.USER_WARNLIST && process.env.USER_WARNLIST.includes(event.sender.id)) {
                        await this.sendMessage(event.sender.id, {text: "Haha.. nice one."});
                        this.consoleError("Blacklisting user " + event.sender.id);
                        process.env.USER_BLACKLIST += "," + event.sender.id;
                    }
                    else {
                        await this.sendMessage(event.sender.id, {text: "Do you want to get banned? This is how you get banned..."});
                        process.env.USER_WARNLIST += "," + event.sender.id
                    }
                    break;
                }
                this.sendTypingIndicator(event.sender.id, true);
                await spotify.queueTrack("spotify:track:" + payload.track).then( () => {
                    this.sendMessage(event.sender.id, {text: "Thanks! Your track has been submitted."});
                }).catch( error => {
                    this.consoleError("Failed to add track", error);
                    this.sendMessage(event.sender.id, { text: error instanceof ReferenceError ?
                            error.message : "Oops.. Computer says no. Maybe try again later."
                    });
                }).finally( () => {
                    this.sendTypingIndicator(event.sender.id, false);
                });
                break;
            }
            case Commands.SEARCH_MORE: {
                // Call the search method again with the parameters in the payload
                this.searchMusic(event.sender.id, payload.terms, payload.skip, payload.limit);
                break;
            }
            case Commands.SEARCH_PLAYLISTS: {
                // Show tracks within the selected playlist
                this.searchOther(event.sender.id, payload.terms, ['playlist'], payload.skip, payload.limit);
                break;
            }
            case Commands.SEARCH_ALBUMS: {
                // Show tracks within the selected playlist
                this.searchOther(event.sender.id, payload.terms, ['album'], payload.skip, payload.limit);
                break;
            }
            case Commands.SEARCH_ARTISTS: {
                // Show tracks within the selected playlist
                this.searchOther(event.sender.id, payload.terms, ['artist'], payload.skip, payload.limit);
                break;
            }
            case Commands.VIEW_TRACKS: {
                if(payload.playlist) {
                    this.getPlaylistTracks(event.sender.id, payload.playlist, payload.skip, payload.limit);
                }
                if(payload.album) {
                    this.getAlbumTracks(event.sender.id, payload.album, payload.skip, payload.limit);
                }
                break;
            }
            case Commands.SET_PLAYLIST: {
                if (this.isSenderOnBlacklist(event.sender.id)) {
                    break;
                }
                this.setPlaylist(event.sender.id, payload.playlist);
                break;
            }
            case Commands.SET_PLAYLIST_RADIO: {
                if (this.isSenderOnBlacklist(event.sender.id)) {
                    break;
                }
                this.setPlaylistRadio(event.sender.id, payload.playlist);
                break;
            }
            case Commands.PLAY_ALBUM: {
                if (this.isSenderOnBlacklist(event.sender.id)) {
                    break;
                }
                this.setAlbum(event.sender.id, payload.album);
                break;
            }
            case Commands.PLAY_ALBUM_RADIO: {
                if (this.isSenderOnBlacklist(event.sender.id)) {
                    break;
                }
                this.setAlbumRadio(event.sender.id, payload.album);
                break;
            }
            case Commands.VIEW_ALBUMS: {
                this.getArtistAlbums(event.sender.id, payload.artist, payload.skip, payload.limit);
                break;
            }
            case Commands.PLAY_ARTIST: {
                if (this.isSenderOnBlacklist(event.sender.id)) {
                    break;
                }
                this.setArtist(event.sender.id, payload.artist);
                break;
            }
            case Commands.PLAY_ARTIST_RADIO: {
                if (this.isSenderOnBlacklist(event.sender.id)) {
                    break;
                }
                this.setArtistRadio(event.sender.id, payload.artist);
                break;
            }
            case Commands.STATUS: {
                this.getStatus(event.sender.id);
                break;
            }
        }
    }

    isSenderOnBlacklist(sender) {
        if (process.env.USER_BLACKLIST && process.env.USER_BLACKLIST.includes(sender)) {
            this.sendMessage(sender, {text: "Yeah, nah... I don't think so. You're a bit of a twat."});
            return true;
        }
        return false;
    }

    async isTrackBlacklisted(trackId) {
        if (process.env.TRACK_BLACKLIST_REGEX) {
            const track = await spotify.getTrack(trackId);
            if (new RegExp(process.env.TRACK_BLACKLIST_REGEX, 'i').test(track.name)) {
                return true;
            }
        }
        return false;
    }

    isTrackQueued(trackId) {
        let nowPlaying = spotify.getStatus();
        if (nowPlaying && nowPlaying.queued_tracks && nowPlaying.queued_tracks.length) {
            return nowPlaying.queued_tracks.filter(t => t.id == trackId).length > 0;
        }
        return false;
    }

    async showSearchSelectButtons(sender, terms) {
        const message = {
            attachment: {
                type: "template",
                payload: {
                    template_type: "button",
                    text: "What are you looking for?",
                    buttons: [{
                        "type": "postback",
                        "title": "Search for Playlists",
                        "payload": JSON.stringify({
                            command: Commands.SEARCH_PLAYLISTS,
                            terms: terms,
                            skip: 0,
                            limit: 10
                        })},
                        {
                            "type": "postback",
                            "title": "Search for Albums",
                            "payload": JSON.stringify({
                                command: Commands.SEARCH_ALBUMS,
                                terms: terms,
                                skip: 0,
                                limit: 10
                            })
                        },
                        {
                            "type": "postback",
                            "title": "Search for Artists",
                            "payload": JSON.stringify({
                                command: Commands.SEARCH_ARTISTS,
                                terms: terms,
                                skip: 0,
                                limit: 10
                            })
                        }]
                }
            }
        };
        await this.sendMessage(sender, message);
    }

    async searchMusic(sender, terms, skip = 0, limit = 10) {
        // Begin a 'typing' indicator to show that we're working on a response
        await this.sendTypingIndicator(sender, true);

        // We want to pull results from Spotify 'paginated' in batches of $limit.
        await spotify.search(terms, ['track'], skip, limit)
            .then( result => {
                if (result.tracks.items.length === 0) {
                    this.sendMessage(sender, { text: "Sorry, we couldn't find that." });
                }
                else if (result.tracks.items.length > 0) {
                    // If there are enough remaining results, we can give the user
                    // a 'More' button to pull further results
                    const remainingResults = result.tracks.total - limit - skip;
                    const showMoreButton = (remainingResults > 0);

                    // Sort the results by popularity
                    result.tracks.items.sort((a, b) => (b.popularity - a.popularity));

                    const message = {
                        attachment: {
                            type: "template",
                            payload: {
                                template_type: "generic",
                                elements: [],
                            }
                        }
                    };

                    // Add the more button if there were enough results. We provide the button
                    // with all of the data it needs to be able to call this search function again and
                    // get the next batch of results
                    if (showMoreButton) {
                        message.quick_replies = [{
                            content_type: "text",
                            title: "More Results",
                            payload: JSON.stringify({
                                command: Commands.SEARCH_MORE,
                                terms: terms,
                                skip: skip + limit,
                                limit: limit
                            })
                        }];
                    }

                    // Build a list of buttons for each result track
                    message.attachment.payload.elements = result.tracks.items.map((track) => {
                        this.sortTrackArtwork(track);
                        return {
                            title: track.name,
                            subtitle: track.artists.map(a => a.name).join(", "),
                            buttons: this.generateTrackViewButtons(track),
                            image_url: track.album.images.length > 0 ? track.album.images[0].url : ""
                        };
                    });

                    // Send the finished result to the user
                    this.sendMessage(sender, message);
                }
            })
            .catch( err => {
                this.consoleError("Error searching for " + terms, err);
                this.sendMessage(sender, { text: "Oops.. Computer says no. Maybe try again later." });
            });

        // Cancel the 'typing' indicator
        await this.sendTypingIndicator(sender, false);
    }

    async searchOther(sender, terms, types = ['album', 'artist', 'playlist'], skip, limit) {
        // Begin a 'typing' indicator to show that we're working on a response
        await this.sendTypingIndicator(sender, true);

        if(terms.trim().length === 0) {
            await this.sendMessage(sender, {text: "You haven't specified any search criteria. If you have a Spotify playlist link, just paste it after the %"});
        }
        else {
            // We want to pull results from Spotify 'paginated' in batches of $limit.
            await spotify.search(terms, types, skip, limit).then(async (result) => {
                if ((!result.albums || result.albums.total === 0)
                    && (!result.artists || result.artists.total === 0)
                    && (!result.playlists || result.playlists.total === 0)) {
                        await this.sendMessage(sender, {text: "No matches found."});
                }
                else {
                    if (result.playlists && result.playlists.total > 0) {
                        await this.collatePlaylistResults(result.playlists, terms, skip, limit)
                            .then(message => this.sendMessage(sender, message));
                    }
                    if (result.albums && result.albums.total > 0) {
                        await this.collateAlbumResults(result.albums, terms, skip, limit)
                            .then(message => this.sendMessage(sender, message));
                    }
                    if (result.artists && result.artists.total > 0) {
                        await this.collateArtistResults(result.artists, terms, skip, limit)
                            .then(message => this.sendMessage(sender, message));
                    }
                }
            }).catch(err => {
                this.consoleError("Error searching for " + terms, err);
                this.sendMessage(sender, {text: "Oops.. Computer says no. Maybe try again later."});
            });
        }

        // Cancel the 'typing' indicator
        await this.sendTypingIndicator(sender, false);
    }

    /**
     * Takes the (playlist) search result and builds a message object to be sent back to messenger.
     *
     * @param result search result array (non-null)
     * @param terms search terms
     * @param skip
     * @param limit
     * @returns {Promise<{attachment: {payload: {elements: [], template_type: string}, type: string}}>}
     */
    async collatePlaylistResults(result, terms = null, skip = 0, limit = 10) {

        if (result.items.length > 0) {
            // If there are enough remaining results, we can give the user
            // a 'More' button to pull further results
            const remainingResults = result.total - limit - skip;
            const showMoreButton = (remainingResults > 0);

            const message = {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: [],
                    }
                }
            };

            // Add the more button if there were enough results. We provide the button
            // with all of the data it needs to be able to call this search function again and
            // get the next batch of results
            if (showMoreButton) {
                message.quick_replies = [{
                    content_type: "text",
                    title: "More Results",
                    payload: JSON.stringify({
                        command: Commands.SEARCH_PLAYLISTS,
                        terms: terms,
                        skip: skip + limit,
                        limit: limit
                    })
                }];
            }

            // Build a list of buttons for each result track
            message.attachment.payload.elements = result.items.map((playlist) => {
                this.sortImagesArtwork(playlist);
                return {
                    title: playlist.name,
                    subtitle: playlist.description,
                    buttons: [
                        this.generatePostbackButton("View Tracks", {
                            command: Commands.VIEW_TRACKS,
                            playlist: playlist.id
                        }),
                        this.generatePostbackButton("Set Playlist", {
                            command: Commands.SET_PLAYLIST,
                            playlist: playlist.id
                        }),
                        this.generatePostbackButton("Set Playlist Radio", {
                            command: Commands.SET_PLAYLIST_RADIO,
                            playlist: playlist.id
                        })],
                    image_url: playlist.images.length > 0 ? playlist.images[0].url : ""
                };
            });
            return message;
        }
        throw Error("No playlist results found."); // shouldn't ever get here
    }

    /**
     * Takes the (album) search result and builds a message object to be sent back to messenger.
     *
     * @param result search result array (non-null)
     * @param terms search terms
     * @param skip
     * @param limit
     * @returns {Promise<{attachment: {payload: {elements: [], template_type: string}, type: string}}>}
     */
    async collateAlbumResults(result, terms = null, skip = 0, limit = 10) {

        if (result.items.length > 0) {
            // If there are enough remaining results, we can give the user
            // a 'More' button to pull further results
            const remainingResults = result.total - limit - skip;
            const showMoreButton = (remainingResults > 0);

            const message = {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: [],
                    }
                }
            };

            // Add the more button if there were enough results. We provide the button
            // with all of the data it needs to be able to call this search function again and
            // get the next batch of results
            if (showMoreButton) {
                message.quick_replies = [{
                    content_type: "text",
                    title: "More Results",
                    payload: JSON.stringify({
                        command: Commands.SEARCH_ALBUMS,
                        terms: terms,
                        skip: skip + limit,
                        limit: limit
                    })
                }];
            }

            // Build a list of buttons for each result track
            message.attachment.payload.elements = result.items.map((album) => {
                this.sortImagesArtwork(album);
                return {
                    title: album.name,
                    subtitle: album.artists.map(a => a.name).join(", "),
                    buttons: [
                        this.generatePostbackButton("View Tracks", {
                            command: Commands.VIEW_TRACKS,
                            album: album.id
                        }),
                        this.generatePostbackButton("Play Album", {
                            command: Commands.PLAY_ALBUM,
                            album: album.id
                        }),
                        this.generatePostbackButton("Play Album Radio", {
                            command: Commands.PLAY_ALBUM_RADIO,
                            album: album.id
                        })],
                    image_url: album.images.length > 0 ? album.images[0].url : ""
                };
            });
            return message;
        }
        throw Error("No album results found."); // shouldn't ever get here
    }

    /**
     * Takes the (artist) search result and builds a message object to be sent back to messenger.
     *
     * @param result search result array (non-null)
     * @param terms search terms
     * @param skip
     * @param limit
     * @returns {Promise<{attachment: {payload: {elements: [], template_type: string}, type: string}}>}
     */
    async collateArtistResults(result, terms = null, skip = 0, limit = 10) {

        if (result.items.length > 0) {
            // If there are enough remaining results, we can give the user
            // a 'More' button to pull further results
            const remainingResults = result.total - limit - skip;
            const showMoreButton = (remainingResults > 0);

            // Sort the results by popularity
            result.items.sort((a, b) => (b.popularity - a.popularity));

            const message = {
                attachment: {
                    type: "template",
                    payload: {
                        template_type: "generic",
                        elements: [],
                    }
                }
            };

            // Add the more button if there were enough results. We provide the button
            // with all of the data it needs to be able to call this search function again and
            // get the next batch of results
            if (showMoreButton) {
                message.quick_replies = [{
                    content_type: "text",
                    title: "More Results",
                    payload: JSON.stringify({
                        command: Commands.SEARCH_ARTISTS,
                        terms: terms,
                        skip: skip + limit,
                        limit: limit
                    })
                }];
            }

            // Build a list of buttons for each result track
            message.attachment.payload.elements = result.items.map((artist) => {
                this.sortImagesArtwork(artist);
                return {
                    title: artist.name,
                    buttons: [
                        this.generatePostbackButton("View Albums", {
                            command: Commands.VIEW_ALBUMS,
                            artist: artist.id
                        }),
                        this.generatePostbackButton("Play Artist", {
                            command: Commands.PLAY_ARTIST,
                            artist: artist.id
                        }),
                        this.generatePostbackButton("Play Artist Radio", {
                            command: Commands.PLAY_ARTIST_RADIO,
                            artist: artist.id
                        })],
                    image_url: artist.images.length > 0 ? artist.images[0].url : ""
                };
            });
            return message;
        }
        throw Error("No artist results found."); // shouldn't ever get here
    }

    async getPlaylistTracks(sender, playlistId, skip = 0, limit = 10) {
        // Begin a 'typing' indicator to show that we're working on a response
        await this.sendTypingIndicator(sender, true);

        // We want to pull results from Spotify 'paginated' in batches of $limit.
        await spotify.getPlaylistTracks(playlistId, skip, limit)
            .then( result => {
                if (result.items.length === 0) {
                    this.sendMessage(sender, { text: "Sorry, unable to load tracks." });
                }
                else if (result.items.length > 0) {
                    // If there are enough remaining results, we can give the user
                    // a 'More' button to pull further results
                    const remainingResults = result.total - limit - skip;
                    const showMoreButton = (remainingResults > 0);

                    const message = {
                        attachment: {
                            type: "template",
                            payload: {
                                template_type: "generic",
                                elements: [],
                            }
                        }
                    };

                    // Add the more button if there were enough results. We provide the button
                    // with all of the data it needs to be able to call this search function again and
                    // get the next batch of results
                    if (showMoreButton) {
                        message.quick_replies = [{
                            content_type: "text",
                            title: "View More Tracks",
                            payload: JSON.stringify({
                                command: Commands.VIEW_TRACKS,
                                playlist: playlistId,
                                skip: skip + limit,
                                limit: limit
                            })
                        }];
                    }

                    // Build a list of buttons for each result track
                    message.attachment.payload.elements = result.items
                        .filter(item => item.track)
                        .map(item => item.track)
                        .map(track => {
                            this.sortTrackArtwork(track);
                            return {
                                title: track.name,
                                subtitle: track.artists.map(a => a.name).join(", "),
                                buttons: this.generateTrackViewButtons(track),
                                image_url: track.album.images.length > 0 ? track.album.images[0].url : ""
                            };
                        });

                    // Send the finished result to the user
                    this.sendMessage(sender, message);
                }
            })
            .catch( err => {
                this.consoleError("Error viewing playlist tracks:", err);
                this.sendMessage(sender, { text: "Oops.. Computer says no. Maybe try again later." });
            });

        // Cancel the 'typing' indicator
        await this.sendTypingIndicator(sender, false);
    }

    async getAlbumTracks(sender, albumId, skip = 0, limit = 10) {
        // Begin a 'typing' indicator to show that we're working on a response
        await this.sendTypingIndicator(sender, true);

        // We want to pull results from Spotify 'paginated' in batches of $limit.
        await spotify.getAlbumTracks(albumId, skip, limit)
            .then( result => {
                if (result.tracks.items.length === 0) {
                    this.sendMessage(sender, { text: "Sorry, unable to load tracks." });
                }
                else if (result.tracks.items.length > 0) {
                    // If there are enough remaining results, we can give the user
                    // a 'More' button to pull further results
                    const remainingResults = result.tracks.total - limit - skip;
                    const showMoreButton = (remainingResults > 0);

                    const message = {
                        attachment: {
                            type: "template",
                            payload: {
                                template_type: "generic",
                                elements: [],
                            }
                        }
                    };

                    // Add the more button if there were enough results. We provide the button
                    // with all of the data it needs to be able to call this search function again and
                    // get the next batch of results
                    if (showMoreButton) {
                        message.quick_replies = [{
                            content_type: "text",
                            title: "View More Tracks",
                            payload: JSON.stringify({
                                command: Commands.VIEW_TRACKS,
                                album: albumId,
                                skip: skip + limit,
                                limit: limit
                            })
                        }];
                    }

                    // Build a list of buttons for each result track
                    message.attachment.payload.elements = result.tracks.items.slice(skip, skip + limit)
                        .map(track => {
                            this.sortImagesArtwork(result);
                            return {
                                title: track.name,
                                subtitle: track.artists.map(a => a.name).join(", "),
                                buttons: this.generateTrackViewButtons(track),
                                image_url: result.images.length > 0 ? result.images[0].url : ""
                            };
                        });

                    // Send the finished result to the user
                    this.sendMessage(sender, message);
                }
            })
            .catch( err => {
                this.consoleError("Error viewing album tracks:", err);
                this.sendMessage(sender, { text: "Oops.. Computer says no. Maybe try again later." });
            });

        // Cancel the 'typing' indicator
        await this.sendTypingIndicator(sender, false);
    }

    async getArtistAlbums(sender, artistId, skip = 0, limit = 10) {
        // Begin a 'typing' indicator to show that we're working on a response
        await this.sendTypingIndicator(sender, true);

        // We want to pull results from Spotify 'paginated' in batches of $limit.
        await spotify.getArtistAlbums(artistId, skip, limit)
            .then( result => {
                if (result.items.length === 0) {
                    this.sendMessage(sender, { text: "Sorry, unable to load albums." });
                }
                else if (result.items.length > 0) {
                    // If there are enough remaining results, we can give the user
                    // a 'More' button to pull further results
                    const remainingResults = result.total - limit - skip;
                    const showMoreButton = (remainingResults > 0);

                    const message = {
                        attachment: {
                            type: "template",
                            payload: {
                                template_type: "generic",
                                elements: [],
                            }
                        }
                    };

                    // Add the more button if there were enough results. We provide the button
                    // with all of the data it needs to be able to call this search function again and
                    // get the next batch of results
                    if (showMoreButton) {
                        message.quick_replies = [{
                            content_type: "text",
                            title: "View More Albums",
                            payload: JSON.stringify({
                                command: Commands.VIEW_ALBUMS,
                                artist: artistId,
                                skip: skip + limit,
                                limit: limit
                            })
                        }];
                    }

                    // Build a list of buttons for each result track
                    message.attachment.payload.elements = result.items
                        .map(album => {
                            this.sortImagesArtwork(album);
                            return {
                                title: album.name,
                                subtitle: album.artists.map(a => a.name).join(", "),
                                buttons: [
                                    this.generatePostbackButton("View Tracks", {
                                        command: Commands.VIEW_TRACKS,
                                        album: album.id
                                    }),
                                    this.generatePostbackButton("Play Album", {
                                        command: Commands.PLAY_ALBUM,
                                        album: album.id
                                    }),
                                    this.generatePostbackButton("Play Album Radio", {
                                        command: Commands.PLAY_ALBUM_RADIO,
                                        album: album.id
                                    })
                                ],
                                image_url: album.images.length > 0 ? album.images[0].url : ""
                            };
                        });

                    // Send the finished result to the user
                    this.sendMessage(sender, message);
                }
            })
            .catch( err => {
                this.consoleError("Error viewing artist albums:", err);
                this.sendMessage(sender, { text: "Oops.. Computer says no. Maybe try again later." });
            });

        // Cancel the 'typing' indicator
        await this.sendTypingIndicator(sender, false);
    }

    async getStatus(sender) {
        await this.sendTypingIndicator(sender, true);
        const status = spotify.getStatus();
        try {
            let message = "";
            if (status.now_playing) {
                message = "Now Playing: " + status.now_playing.song_title + " by " + status.now_playing.artist + "\n";
            }
            if (status.queued_tracks && status.queued_tracks.length) {
                message += "Queued Tracks:\n";
                for (let i = 1; i <= status.queued_tracks.length; i++) {
                    const track = status.queued_tracks[i - 1];
                    message += i + ": " + track.song_title + " by " + track.artist + "\n";
                }
            } else {
                message += "There are no queued tracks.\n";
            }
            if (status.context) {
                if (status.context.type == "playlist") {
                    message += "Current playlist: " + status.context.name;
                } else if (status.context.type == "album") {
                    message += "Current album: " + status.context.name + " by " + status.context.artists;
                } else if (status.context.name) {
                    message += "Current context: " + status.context.name +
                        (status.context.artists ? " by " + status.context.artists : "") + " " + status.context.type;
                }
            }
            await this.sendMessage(sender, {text: message.trim().substr(0, 2000)}); // hard-limit set by messenger

        } catch (error) {
            this.consoleError("Failed to get status", error);
            await this.sendMessage(sender, {text: "Oops.. Computer says no. Maybe try again later."});
        }
        await this.sendTypingIndicator(sender, false);
        return status;
    }

    async postVolume(sender, volume) {
        await this.sendTypingIndicator(sender, true);
        if(!volume || !volume.trim()) {
            await spotify.getVolume()
                .then(resp => this.sendMessage(sender, {text: "Volume: " + resp}))
                .catch(error => {
                    this.consoleError("Failed to get volume.", error);
                    this.sendMessage(sender, {text: "Unable to get volume: " + error.message});
                });
        }
        else {
            if (process.env.VOLUME_ADJUST_DISABLED === 'true') {
                await this.sendMessage(sender, {text: "Volume adjustment is currently disabled."});
            }
            else {
                await spotify.setVolume(volume)
                    .then(resp => {
                        this.consoleInfo("Volume response:", resp);
                        this.sendMessage(sender, {text: "Volume set."});
                    })
                    .catch(error => {
                        this.consoleError("Failed to set volume.", error);
                        this.sendMessage(sender, {text: "Unable to set volume: " + error.message});
                    });
            }
        }
        await this.sendTypingIndicator(sender, false);
    }

    async skipTrack(sender) {
        await spotify.skipTrack()
            .then(() => this.sendMessage(sender, {text: "As you wish master."}))
            .catch(error => {
                this.consoleError("Failed to skip track.", error);
                this.sendMessage(sender, {text: "Unable to skip track: " + error.message});
            });
    }

    async pausePlayback(sender) {
        await spotify.pausePlayback()
            .then(() => this.sendMessage(sender, {text: "As you wish master."}))
            .catch(error => {
                this.consoleError("Failed to pause playback.", error);
                this.sendMessage(sender, {text: "Unable to pause playback: " + error.message});
            });
    }

    async resumePlayback(sender) {
        await spotify.resumePlayback()
            .then(() => this.sendMessage(sender, {text: "As you wish master."}))
            .catch(error => {
                this.consoleError("Failed to resume playback.", error);
                this.sendMessage(sender, {text: "Unable to resume playback: " + error.message});
            });
    }

    async setPlaylist(sender, playlistId) {
        await spotify.play("spotify:playlist:" + playlistId)
            .then(() => this.sendMessage(sender, {text: "You da boss."}))
            .catch(error => {
                this.consoleError("Failed to set playlist.", error);
                this.sendMessage(sender, {text: "Oopsie, unable to set playlist: " + error.message});
            });
    }

    async setPlaylistRadio(sender, playlistId) {
        await spotify.setPlaylistRadio(playlistId)
            .then(() => this.sendMessage(sender, {text: "You da boss."}))
            .catch(error => {
                this.consoleError("Failed to set playlist radio.", error);
                this.sendMessage(sender, {text: "Oopsie, unable to set playlist radio: " + error.message});
            });
    }

    async setAlbum(sender, albumId) {
        await spotify.play("spotify:album:" + albumId)
            .then(() => this.sendMessage(sender, {text: "You da boss."}))
            .catch(error => {
                this.consoleError("Failed to set album.", error);
                this.sendMessage(sender, {text: "Oopsie, unable to set album: " + error.message});
            });
    }

    async setAlbumRadio(sender, albumId) {
        await spotify.setAlbumRadio(albumId)
            .then(() => this.sendMessage(sender, {text: "You da boss."}))
            .catch(error => {
                this.consoleError("Failed to set album radio.", error);
                this.sendMessage(sender, {text: "Oopsie, unable to set album radio: " + error.message});
            });
    }

    async setArtist(sender, artistId) {
        await spotify.play("spotify:artist:" + artistId)
            .then(() => this.sendMessage(sender, {text: "You da boss."}))
            .catch(error => {
                this.consoleError("Failed to set artist.", error);
                this.sendMessage(sender, {text: "Oopsie, unable to play artist: " + error.message});
            });
    }

    async setArtistRadio(sender, artistId) {
        await spotify.setArtistRadio(artistId)
            .then(() => this.sendMessage(sender, {text: "You da boss."}))
            .catch(error => {
                this.consoleError("Failed to set artist radio.", error);
                this.sendMessage(sender, {text: "Oopsie, unable to play radio: " + error.message});
            });
    }

    generatePostbackButton(title, payload) {
        return {
            type: "postback",
            title: title,
            payload: JSON.stringify(payload)
        };
    }

    generatePreviewLink(title, url) {
        return {
            type: "web_url",
            title: title,
            url: url
        };
    }

    generateTrackViewButtons(track) {
        const buttons = [];
        if (track.preview_url) {
            buttons.push(this.generatePreviewLink("Listen to Sample", track.preview_url));
        }
        buttons.push(this.generatePostbackButton("Queue Track", {command: Commands.ADD_TRACK, track: track.id}));
        return buttons;
    }

    sortTrackArtwork(track) {
        // Sort the album images by size order ascending
        track.album.images.sort((a, b) => {
            return b.width - a.width;
        });
    }

    sortImagesArtwork(item) {
        // Sort the images by size order ascending
        item.images.sort((a, b) => {
            return b.width - a.width;
        });
    }

    getSendOptions(recipient) {
        const result = {
            uri: "https://graph.facebook.com/v20.0/me/messages",
            qs: {
                access_token: process.env.MESSENGER_ACCESS_TOKEN
            },
            body: {
                recipient: {
                    id: recipient
                }
            },
            json: true
        };
        return result;
    }

    sendTypingIndicator(recipient, typing) {
        const options = this.getSendOptions(recipient);
        options.body.sender_action = typing ? "typing_on" : "typing_off";
        return this.send(options);
    }

    sendReadReceipt(recipient) {
        const options = this.getSendOptions(recipient);
        options.body.sender_action = "mark_seen";
        return this.send(options);
    }

    sendMessage(recipient, message) {
        const options = this.getSendOptions(recipient);
        options.body.message = message;

        return this.send(options);
    }

    async send(payload) {
        return this.attemptSend(payload.uri, payload.qs, payload.body, 5);
    }

    async attemptSend(uri, params, message, attemptsRemaining) {
        if(attemptsRemaining > 0) {
            this.consoleInfo(`POST: ${uri} message: ` + JSON.stringify(message))
            await agent.post(uri)
                .query(params)
                .set('Content-Type', 'application/json')
                .send(message)
                .then(resp => this.consoleInfo(`POST response ${resp.status}: ${resp.text}`))
                .catch(error => {
                    this.consoleError(`Delivery to Facebook failed (${error}), ${attemptsRemaining} attempts remaining.`);
                    this.attemptSend(uri, params, message, attemptsRemaining - 1);
                });
        }
        else {
            this.consoleError("Unable to deliver message. Giving up.");
        }
    }

    logEvent(event) {
        const msg = event.message && event.message.text ? `"${event.message.text}"` :
            event.postback && event.postback.payload ? `"${event.postback.payload}"` : JSON.stringify( event );
        // Additional permission now required to query fields
        // Promise.resolve(Request({
        //     uri: `https://graph.facebook.com/${event.sender.id}?fields=first_name,last_name&access_token=${process.env.MESSENGER_ACCESS_TOKEN}`,
        //     json: true })
        // .then(resp => {
        //     this.consoleInfo(`Received ${msg} from ${resp.first_name} ${resp.last_name} (${event.sender.id})`)
        // })
        // .catch(error => this.consoleError(`Failed to log event (${error}) from ${event.sender.id}: ${msg}`)));
        this.consoleInfo(`Received ${msg} from ${event.sender.id}`);
    }

    consoleInfo(...args) {
        infoLog.info(args.map(x => typeof x !== 'string' ? JSON.stringify(x) : x).join(' '));
    }

    consoleError(...args) {
        errorLog.error(args.map(x => typeof x !== 'string' ? JSON.stringify(x) : x).join(' '));
    }
}

module.exports = new Messenger();