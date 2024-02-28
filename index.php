<?php
session_start();
require 'vendor/autoload.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

// these variables are required in order to proceed
if (!isset($_ENV['ACCESS_TOKEN']) || !isset($_ENV['REFRESH_TOKEN'])) {
    header('Location: tokens.php');
    die();
}
setcookie('accessToken', $_ENV['ACCESS_TOKEN'], time() + 3600);
setcookie('refreshToken', $_ENV['REFRESH_TOKEN'], time() + (3600 * 365));
setcookie('refreshTime', time() + 1000, time() + (3600 * 365)); // refresh token after a secnod
$_SESSION["showPlaybackControls"] = isset($_ENV['SHOW_PLAYBACK_CONTROLS']) && $_ENV['SHOW_PLAYBACK_CONTROLS'] == 'true';

header('Location: playing.php');
die();
