const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
const hbs = require('hbs');
const spotify = require("./spotify");
const path = require("path");
const bodyParser = require("body-parser");
const favicon = require('serve-favicon');
process.env.UV_THREADPOOL_SIZE = 128; // prevent ETIMEDOUT, ESOCKETTIMEDOUT

const app = express();
app.use(bodyParser.json());
app.use('/assets', express.static('assets'))
app.use(favicon(path.join(__dirname, 'assets', 'images', 'favicon.ico')));

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
                state.show_playback_controls = process.env.SHOW_PLAYBACK_CONTROLS === "true";
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

// uses the cookies to retrieve a (web) access token
// use that token to initialize a websocket connection to spotify and listen in for change events
app.post('/save-cookies', (request, response) => {
    if (request.body && request.body.data) {
        spotify.refreshWebAuthToken(request.body.data)
            .then(() => spotify.resetWebsocket())
            .then(() => spotify.initWebsocket())
            // Perform other start-up tasks, now that we have access to the api
            .then(() => spotify.initialized())
            .then(() => response.status(200).send({status: "OK"}))
            .catch(err => response.status(500).send({error: err.message}));
    }
    else {
        response.status(400).send({error: "Missing data."})
    }
});

app.get("/search-all", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    const types = req.query.types ? req.query.types.split(',') : ['track', 'album', 'artist', 'playlist'];
    const skip = req.query.skip ? parseInt(req.query.skip) : 0;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
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
    // in case we we've just started up and the api hasn't been initialized yet...
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
    spotify.transferPlaybackToDevice( req.query.deviceId, "true" === req.query.playNow )
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/queue-track", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.queueTrack(req.query.trackUri)
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/play", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.play( req.query.contextUri )
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
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

app.get("/toggle-play", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.togglePlay()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/next-track", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.skipTrack()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/prev-track", async (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Access-Control-Allow-Origin', '*');
    spotify.prevTrack()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

(async function initSpotify() {
    // await spotify.initializeAuthToken()
    //     .catch(e => console.error("Error during initialization: ", e));
})();
