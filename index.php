<?php
session_start();
require 'vendor/autoload.php';
require_once 'spotify_tokenizer.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

try {
    $tokenizer = new SpotifyTokenizer();
    $tokenizer->loadTokens();

    error_log("access token: " . $tokenizer->getAccessToken());
    error_log("refresh token: " . $tokenizer->getRefreshToken());

    setcookie('accessToken', $tokenizer->getAccessToken(), time() + 3600);
    setcookie('refreshToken', $tokenizer->getRefreshToken(), time() + 3600);
    setcookie('refreshTime', $tokenizer->getExpirationTime(), time() + 3600);
}
catch(Exception $ex) {
    error_log("Exception loading spotify tokens. " . var_export($ex, true));
    echo "Hmmm... computer says no. Maybe try again later.";
    die();
}

header('Location: playing.php');
die();
