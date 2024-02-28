<?php
require 'vendor/autoload.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

$session = new SpotifyWebAPI\Session(
    $_ENV['CLIENT_ID'],
    $_ENV['CLIENT_SECRET']
);

// Fetch the saved access token from somewhere. A session for example.
$session->setAccessToken($_ENV['ADMIN_ACCESS_TOKEN']);
$session->setRefreshToken($_ENV['ADMIN_REFRESH_TOKEN']);

$options = [
    'auto_refresh' => true,
];

$api = new SpotifyWebAPI\SpotifyWebAPI($options, $session);

// Remember to grab the tokens afterwards, they might have been updated
$newAccessToken = $session->getAccessToken();
$newRefreshToken = $session->getRefreshToken();

if ($_ENV['ADMIN_ACCESS_TOKEN'] != $newAccessToken) {
    error_log("NEW accessToken: $newAccessToken");
}
if ($_ENV['ADMIN_REFRESH_TOKEN'] != $newRefreshToken) {
    error_log("NEW refreshToken: $newRefreshToken");
}

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

else {
    echo json_encode(['message' => "I'm not sure what you want me to do.", 'error' => true]);
}
