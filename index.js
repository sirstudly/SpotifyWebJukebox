const dotenv = require("dotenv");
dotenv.config();
const express = require("express");
// const messenger = require("./messenger");
const hbs = require('hbs');
const spotify = require("./spotify");
const path = require("path");
const bodyParser = require("body-parser");
process.env.UV_THREADPOOL_SIZE = 128; // prevent ETIMEDOUT, ESOCKETTIMEDOUT

const app = express();
app.use(bodyParser.json());
app.use('/assets', express.static('assets'))

app.set('view engine', 'hbs'); // handlebars template engine
app.set('views', path.join(__dirname, 'views'));
hbs.registerPartials(path.join(__dirname, 'views/partials'));

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server available on port ${port}`);
});

app.get("/", async (req, res) => {
    if (spotify.isAuthTokenValid() === false) {
        res.redirect("/tokens");
    }
    else {
        let state = await spotify.getPlaybackState();
        if (state.body) {
            state = state.body;
        }
        state.show_playback_controls = process.env.SHOW_PLAYBACK_CONTROLS === "true";
console.log("playback state:", state);
        res.render("playing", state);
    }
});

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

app.post("/webhook", (req, res) => {
    // Checks this is an event from a page subscription
    if (req.body.object === "page") {
        // Iterates over each entry - there may be multiple if batched
        req.body.entry.forEach(entry => {
            // entry.messaging is an array, but
            // will only ever contain one message, so we get index 0
            const event = entry.messaging[0];
            const senderId = event.sender.id;

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

app.get("/spotify", (req, res) => {
    spotify.receivedAuthCode(req.query.code)
        //.then((result) => res.render("authentication_success", result))
        .then((result) => res.redirect("/"))
        .catch(err => res.status(500).send({error: err.message}));

    // Perform other start-up tasks, now that we have access to the api
    spotify.initialized()
        .catch(err => console.error("Error during initialization: ", err));
});

app.get('/tokens', (request, response) => {
    response.render('tokens');
});

app.get('/authenticate', (request, response) => {
    response.redirect(spotify.getAuthorizeUrl());
});

app.get("/search", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.searchTracks(req.query.terms, 0, 20)
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/search-all", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    const types = req.query.types ? req.query.types.split(',') : ['track', 'album', 'artist', 'playlist'];
    const skip = req.query.skip ? parseInt(req.query.skip) : 0;
    const limit = req.query.limit ? parseInt(req.query.limit) : 20;
    spotify.search(req.query.terms, types, skip, limit)
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/now-playing", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    res.status(200).send(spotify.getStatus());
});

app.get("/get-devices", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.getMyDevices()
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/transfer-playback", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.transferPlaybackToDevice( req.query.deviceId, "true" === req.query.playNow )
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/queue-track", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.queueTrack(req.query.trackUri)
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/play", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.play( req.query.contextUri )
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/get-playback-state", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.getPlaybackState()
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/get-queue", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.getQueue()
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/get-connect-state", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify._getConnectState()
        .then(state => res.status(200).send(state))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/toggle-play", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.togglePlay()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/next-track", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.skipTrack()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/prev-track", async (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Access-Control-Allow-Origin', '*');
    spotify.prevTrack()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/dump-screenshot", async (req, res) => {
    spotify.saveScreenshot("screenshot.png")
        .then(() => res.sendFile(path.join(__dirname, 'screenshot.png')))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/dump-webpage", async (req, res) => {
    spotify.savePageSource("currentpage.html")
        .then(() => res.sendFile(path.join(__dirname, 'currentpage.html')))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/dump-ngrok", async (req, res) => {
    spotify.takeScreenshot("http://localhost:" + process.env.NGROK_PORT + "/status", "currentpage.png")
        .then(() => res.sendFile(path.join(__dirname, 'currentpage.png')))
        .catch(err => res.status(500).send({error: err.message}));
});

app.get("/register-messenger-endpoint", async (req, res) => {
    spotify.updateMessengerCallback()
        .then(() => res.status(200).send({status: "OK"}))
        .catch(err => res.status(500).send({error: err.message}));
});

(async function initSpotify() {
    // await spotify.initializeAuthToken()
    //     .catch(e => console.error("Error during initialization: ", e));
})();
