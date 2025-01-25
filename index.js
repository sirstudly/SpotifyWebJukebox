const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const hbs = require('hbs');
const messenger = require("./messenger");
const spotify = require("./spotify");
const path = require("path");
const bodyParser = require("body-parser");
const favicon = require('serve-favicon');
const sessions = require('express-session');
process.env.UV_THREADPOOL_SIZE = 128; // prevent ETIMEDOUT, ESOCKETTIMEDOUT

const app = express();
app.use(bodyParser.json());
app.use('/assets', express.static('assets'))
app.use(favicon(path.join(__dirname, 'assets', 'images', 'favicon.ico')));
app.use(sessions({
    secret: "spotify-web-jukebox-secret",
    saveUninitialized: true,
    cookie: {maxAge: 1000 * 60 * 60 * 24 * 90}, // 3 months
    resave: false
}));

app.set('view engine', 'hbs'); // handlebars template engine
app.set('views', path.join(__dirname, 'views'));
hbs.registerPartials(path.join(__dirname, 'views/partials'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server available on port ${port}`);
});

app.get("/", async (req, res) => {
    const renderPlaybackState = () => {
        spotify.getPlaybackState()
            .then(state => {
                if (state.body) {
                    state = state.body;
                }
                state.show_playback_controls = process.env.SHOW_PLAYBACK_CONTROLS ?? "true";
                res.render("playing", state);
            })
    }

    if (spotify.api === undefined) {
        spotify.initializeTokensFromFile()
            .then(() => spotify.resetWebsocket()
                    .then(() => spotify.initWebsocket())
                    .then(() => spotify.initialized())
                    .then(() => renderPlaybackState())
                    .catch(err => res.status(500).send({error: err.message}))
                ,
                // failed initializeTokensFromFile()
                err => {
                    spotify.consoleError("Failed to initialize tokens.", err);
                    res.redirect("/tokens");
                })
    }
    else if (spotify.isAuthTokenValid() === false) {
        spotify.refreshAuthToken()
            .catch(err => {
                spotify.consoleError("Failed to refresh auth token.", err);
                res.redirect("/tokens");
            });
    }
    else if (spotify.isWebAuthTokenValid() === false) {
        spotify.refreshWebAuthToken()
            .catch(err => {
                spotify.consoleError("Failed to refresh web auth token.", err);
                res.redirect("/authenticate-web")
            });
    }
    else {
        renderPlaybackState();
    }
});

app.get("/spotify", (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: received spotify auth code ${req.query.code}`);
    spotify.receivedAuthCode(req.query.code)
        .then((tokens) => res.redirect("/authenticate-web"))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get('/tokens', (request, response) => {
    response.render('tokens');
});

app.get('/authenticate', (request, response) => {
    response.redirect(spotify.getAuthorizeUrl());
});

app.get('/authenticate-web', (request, response) => {
    if (spotify.isAuthTokenValid() === false) {
        response.redirect("/tokens");
    }
    else {
        response.render("authentication");
    }
});

// fb messenger webhook
app.get("/webhook", (req, res) => {
    // Your verify token. Should be a random string.
    const VERIFY_TOKEN = process.env.MESSENGER_VERIFY_TOKEN;

    // Parse the query params
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];

    // Checks if a token and mode is in the query string of the request
    if (mode && token) {
        // Checks the mode and token sent is correct
        if (mode === "subscribe" && token === VERIFY_TOKEN) {
            // Responds with the challenge token from the request
            console.log("Responded to Facebook verification request");
            return res.status(200).send(challenge);
        }
    }
    // Responds with '403 Forbidden' if verify tokens do not match
    res.sendStatus(403);
});

// fb messenger webhook
app.post("/webhook", (req, res) => {
    // Checks this is an event from a page subscription
    if (req.body.object === "page") {
        // Iterates over each entry - there may be multiple if batched
        req.body.entry.forEach(entry => {
            // entry.messaging is an array, but
            // will only ever contain one message, so we get index 0
            const event = entry.messaging[0];

            // Check if the event is a message or postback and
            // pass the event to the appropriate handler function
            if (event.message) {
                messenger.receivedMessage(event);
            }
            else if (event.postback) {
                messenger.receivedPostback(event);
            }
        });

        // Returns a '200 OK' response to all requests
        res.sendStatus(200);
    } else {
        // Returns a '404 Not Found' if event is not from a page subscription
        res.sendStatus(404);
    }
});

// uses the cookies to retrieve a (web) access token
// use that token to initialize a websocket connection to spotify and listen in for change events
app.post('/save-cookies', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: save cookies=${req.body.data}`);
    if (req.body && req.body.data) {
        spotify.refreshWebAuthToken(req.body.data)
            .then(() => spotify.resetWebsocket())
            .then(() => spotify.initWebsocket())
            // Perform other start-up tasks, now that we have access to the api
            .then(() => spotify.initialized())
            .then(() => res.status(200).send({status: "OK"}))
            .catch(err => res.status(500).send({error: err.message}));
    }
    else {
        res.status(400).send({error: "Missing data."})
    }
});

app.get("/search-all", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: search types=${req.query.types} terms=${req.query.terms}`);
    const types = req.query.types ? req.query.types.split(',') : ['track', 'album', 'artist', 'playlist'];
    const skip = req.query.skip ? parseInt(req.query.skip) : 0;
    const limit = req.query.limit ? parseInt(req.query.limit) : 40;
    spotify.search(req.query.terms, types, skip, limit)
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/now-playing", async (req, res) => {
    const nowPlaying = () => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.status(200).send(spotify.getStatus());
    }
    // in case we've just started up and the api hasn't been initialized yet...
    if (spotify.api === undefined) {
        spotify.initializeTokensFromFile()
            .then(() => spotify.resetWebsocket())
            .then(() => spotify.initWebsocket())
            .then(() => spotify.initialized())
            .then(() => nowPlaying())
            .catch(err => res.status(500).send({error: err.message}))
    }
    else {
        nowPlaying();
    }
});

app.get("/get-devices", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.getMyDevices()
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/transfer-playback", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: requested transfer playback to device ${req.query.deviceId}`);
    spotify.transferPlaybackToDevice( req.query.deviceId, "true" === req.query.playNow )
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/queue-track", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: queueing track ${req.query.trackUri}`);
    if (process.env.DISABLED && 'true' === process.env.DISABLED.toLowerCase()) {
        res.status(503).send({error: "This function is currently disabled."})
    }
    else {
        spotify.queueTrack(req.query.trackUri)
            .then(state => res.status(200).send(state))
            .catch(err => res.status(500).send({error: err.message}));
    }
});

app.get("/play", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: requested play ${req.query.contextUri}`);
    if (process.env.DISABLED && 'true' === process.env.DISABLED.toLowerCase()) {
        res.status(503).send({error: "This function is currently disabled."})
    }
    else {
        spotify.play(req.query.contextUri)
            .then(state => res.status(200).send(state))
            .catch(err => res.status(500).send({error: err.message}));
    }
});

app.get("/get-playback-state", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.getPlaybackState()
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/get-queue", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.getQueue()
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/get-lyrics", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.getLyrics()
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/toggle-play", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: toggled play`);
    spotify.togglePlay()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/next-track", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: toggled skip track`);
    spotify.skipTrack()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/prev-track", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: toggled prev track`);
    spotify.prevTrack()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

app.post('/set-volume', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: set volume=${req.body.data}`);
    spotify.setVolume(req.body.data)
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get('/reload-config', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.consoleInfo( `[${req.sessionID}]: reload-config`);
    const result = dotenv.config();
    if (result.error) {
        res.status(500).send({error: result.error})
    }
    else {
        res.status(200).send({status: "OK"})
    }
});

(async function initSpotify() {
    // await spotify.initializeAuthToken()
    //     .catch(e => console.error("Error during initialization: ", e));
})();
