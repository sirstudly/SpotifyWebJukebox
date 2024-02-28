<?php
session_start();
require_once 'vendor/autoload.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

$session = new SpotifyWebAPI\Session(
    $CLIENT_ID = $_ENV['CLIENT_ID'],
    $CLIENT_SECRET = $_ENV['CLIENT_SECRET'],
    $REDIRECT_URI = $_ENV['REDIRECT_URI'],
);

$options = [
    'scope' => [
        'user-read-currently-playing',
        'user-read-playback-state'
    ],
];

if (isset($_GET['generateMiniPlayer']) && $_GET['generateMiniPlayer'] == 'true') {
    $_SESSION['generateMiniPlayer'] = true;
}
elseif(isset($_GET['allowPlaybackControl']) && $_GET['allowPlaybackControl'] == 'true') {
    $_SESSION['allowPlaybackControl'] = true;
    $options = [
        'scope' => [
            'user-modify-playback-state',
            'user-read-currently-playing',
            'user-read-email',
            'user-read-playback-state',
            'user-read-playback-position',
            'user-read-private',
            'user-read-recently-played',
            'user-library-read',
            'playlist-read-private',
            'playlist-read-collaborative',
            'streaming',
        ],
    ];
}
else {
    $_SESSION['generateMiniPlayer'] = false;
}

header('Location: ' . $session->getAuthorizeUrl($options));
die();
?>

