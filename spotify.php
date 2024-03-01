<?php
require 'vendor/autoload.php';
require_once 'spotify_tokenizer.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

$tokenizer = new SpotifyTokenizer();
$tokenizer->loadTokens();

$session = new SpotifyWebAPI\Session(
    $tokenizer->getClientId()
);

// Fetch the saved access token from somewhere. A session for example.
$session->setAccessToken($tokenizer->getAccessToken());
$session->setRefreshToken($tokenizer->getRefreshToken());

$options = [
    'auto_refresh' => true,
];

$api = new SpotifyWebAPI\SpotifyWebAPI($options, $session);

header("Content-Type: application/json");
if (isset($_GET['c']) && $_GET['c'] == 'queue' && isset($_GET['uri']) && !empty($_GET['uri'])) {
    $results = $api->getMyQueue();
    if (!empty($results)) {
        if ($_GET['uri'] == $results->currently_playing->uri) {
            echo json_encode(['message' => 'Track is already queued.', 'error' => true]);
            return;
        }
        foreach ($results->queue as $track) {
            if ($_GET['uri'] == $track->uri) {
                echo json_encode(['message' => 'Track is already queued.', 'error' => true]);
                return;
            }
        }
    }
    try {
        if ($api->queue($_GET['uri'])) {
            echo json_encode(['message' => 'Track queued.']);
        }
        else {
            echo json_encode(['message' => 'Operation failed.', 'error' => true]);
        }
    }
    catch (Exception $ex) {
        echo json_encode(['message' => $ex->getMessage(), 'error' => true]);
    }
}

elseif (isset($_GET['c']) && $_GET['c'] == 'search' && isset($_GET['q']) && !empty($_GET['q'])) {
    $results = $api->search($_GET['q'], 'track');

    // flatten artists so it can be displayed in a single line
    foreach ($results->tracks->items as &$track) {
        $track->artist_names = join(", ", array_map(fn($artist) => $artist->name, $track->artists));
    }
    unset($track);

    echo json_encode($results);
}

elseif (isset($_GET['c']) && $_GET['c'] == 'getPlaybackState') {
    $results = $api->getMyCurrentPlaybackInfo();
    if (empty($results)) {
        echo json_encode(['message' => 'No playback state.', 'error' => true]);
    }
    else {
        echo json_encode($results);
    }
}

elseif (isset($_GET['c']) && $_GET['c'] == 'getQueue') {
    $results = $api->getMyQueue();
    if (empty($results)) {
        echo json_encode(['message' => 'Nothing returned.', 'error' => true]);
    }
    else {
        echo json_encode($results);
    }
}

elseif (isset($_GET['c']) && $_GET['c'] == 'getMyCurrentPlaybackState') {
    $results = $api->getMyCurrentPlaybackInfo();
    if (empty($results)) {
        echo json_encode(['message' => 'Nothing returned.', 'error' => true]);
    }
    else {
        echo json_encode($results);
    }
}

elseif (isset($_GET['c']) && $_GET['c'] == 'getMyCurrentQueue') {
    $results = $api->getMyQueue();
    if (empty($results)) {
        echo json_encode(['message' => 'Nothing returned.', 'error' => true]);
    }
    else {
        echo json_encode($results);
    }
}

elseif (isset($_GET['c']) && $_GET['c'] == 'nextTrack') {
    $results = $api->next();
    if (empty($results)) {
        echo json_encode(['message' => 'Operation SKIP failed.', 'error' => true]);
    }
    else {
        echo json_encode(['message' => 'Track skipped.']);
    }
}

elseif (isset($_GET['c']) && $_GET['c'] == 'prevTrack') {
    $state = $api->getMyCurrentPlaybackInfo();
    $results = $state->progress_ms > 5000 ? $api->seek(['position_ms' => 0]) : $api->previous();

    if (empty($results)) {
        echo json_encode(['message' => 'Operation SKIP BACK failed.', 'error' => true]);
    }
    else {
        echo json_encode(['message' => 'Skipped back.']);
    }
}

elseif (isset($_GET['c']) && $_GET['c'] == 'togglePlay') {
    $state = $api->getMyCurrentPlaybackInfo();
    $results = $state->is_playing ? $api->pause() : $api->play(false, ["some_option" => false]);

    if (empty($results)) {
        echo json_encode(['message' => 'Operation TOGGLE PLAY failed.', 'error' => true]);
    }
    else {
        echo json_encode(['message' => 'Operation successful.']);
    }
}

else {
    echo json_encode(['message' => "I'm not sure what you want me to do.", 'error' => true]);
}
