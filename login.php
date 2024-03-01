<?php
session_start();
require_once 'vendor/autoload.php';
require_once 'spotify_tokenizer.php';

$options = [
    'scope' => [
        'user-read-currently-playing',
        'user-read-playback-state'
    ],
];

if (isset($_GET['allowPlaybackControl']) && $_GET['allowPlaybackControl'] == 'true') {
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

header('Location: ' . (new SpotifyTokenizer())->getAuthorizeUrl($options));
die();
