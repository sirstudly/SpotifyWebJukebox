<?php
session_start();
require 'vendor/autoload.php';
require_once 'spotify_tokenizer.php';

// This page gets loaded immediately after the user has confirmed access to their Spotify account
$tokenizer = new SpotifyTokenizer();
if (!isset($_GET['action'])) {
    $tokenizer->requestAccessToken($_GET['code']);
    $tokenizer->refreshTokens(true);
}
else {
    // load tokens from file
    $tokenizer->loadTokens();
}

error_log("accessToken: " . $tokenizer->getAccessToken());
error_log("refreshToken: " . $tokenizer->getRefreshToken());
error_log("refreshTime: " . $tokenizer->getExpirationTime());

setcookie('accessToken', $tokenizer->getAccessToken(), time() + 3600);
setcookie('refreshToken', $tokenizer->getRefreshToken(), time() + 3600);

// not used but left in for debugging
if (isset($_GET['response']) && $_GET['response'] == "data") {
    echo json_encode(array(
        'accessToken' => $tokenizer->getAccessToken(),
        'refreshToken' => $tokenizer->getRefreshToken(),
        'refreshTime' => $tokenizer->getExpirationTime(),
    ));
    die();
}

header('Location: login_success.php');
die();
