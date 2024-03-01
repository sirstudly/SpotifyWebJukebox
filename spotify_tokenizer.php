<?php
use SpotifyWebAPI\Session;
require 'vendor/autoload.php';

$dotenv = Dotenv\Dotenv::createImmutable(__DIR__);
$dotenv->load();

class SpotifyTokenizer {

    private Session $session;
    private int $expirationTime = 0; // not visible in Session so duplicate it here

    function __construct()
    {
        $this->session = new SpotifyWebAPI\Session(
            $_ENV['CLIENT_ID'],
            $_ENV['CLIENT_SECRET'],
            $_ENV['REDIRECT_URI'],
        );
    }

    /**
     * Load previously authorized tokens from ini file.
     * @return void
     * @throws Exception
     */
    function loadTokens(): void
    {
        $tokens = parse_ini_file($_ENV['TOKEN_FILE']);
        if ($tokens === false) {
            throw new Exception("Failed to load " . $_ENV['TOKEN_FILE']);
        }
        if (!isset($tokens['ACCESS_TOKEN']) || !isset($tokens['REFRESH_TOKEN']) || !isset($tokens['EXPIRATION_TIME'])) {
            $this->refreshTokens();
        }
        else {
            // set from tokens file if we have them already
            $this->session->setAccessToken($tokens['ACCESS_TOKEN']);
            $this->session->setRefreshToken($tokens['REFRESH_TOKEN']);
            $this->expirationTime = intval($tokens['EXPIRATION_TIME']);
        }
    }

    function getAuthorizeUrl(array $options): string
    {
        return $this->session->getAuthorizeUrl($options);
    }

    function requestAccessToken(string $code): bool
    {
        return $this->session->requestAccessToken($code);
    }

    function getExpirationTime(): int
    {
        return $this->expirationTime;
    }

    function getClientId(): string
    {
        return $this->session->getClientId();
    }

    /**
     * @throws Exception
     */
    function getAccessToken(): string
    {
        if ($this->getExpirationTime() < time()) {
            error_log("Access token expired.. refreshing.");
            $this->refreshTokens();
        }
        return $this->session->getAccessToken();
    }

    /**
     * @throws Exception
     */
    function getRefreshToken() : string
    {
        if ($this->getExpirationTime() < time()) {
            error_log("Refresh token expired.. refreshing.");
            $this->refreshTokens();
        }
        return $this->session->getRefreshToken();
    }

    /**
     * Refreshes the access/refresh tokens in the tokens file.
     * @param bool $forceUpdate true to force update of tokens, default false
     * @throws Exception
     */
    function refreshTokens(bool $forceUpdate = false): void
    {
        $prevToken = $this->session->getAccessToken();
        if ($this->session->refreshAccessToken() === false) {
            throw new Exception("Failed to refresh access token.");
        }
        if ($forceUpdate || $this->session->getAccessToken() !== $prevToken) {
            error_log("Access token has changed. Updating " . $_ENV['TOKEN_FILE']);
            if (shell_exec("./update_env.sh ACCESS_TOKEN " . $this->session->getAccessToken() . " " . $_ENV['TOKEN_FILE']) === false) {
                throw new Exception("Error writing access token to " . $_ENV['TOKEN_FILE']);
            }
        }
        if (shell_exec("./update_env.sh REFRESH_TOKEN " . $this->session->getRefreshToken() . " " . $_ENV['TOKEN_FILE']) === false) {
            throw new Exception("Error writing refresh token to " . $_ENV['TOKEN_FILE']);
        }
        if (shell_exec("./update_env.sh EXPIRATION_TIME " . $this->session->getTokenExpiration() . " " . $_ENV['TOKEN_FILE']) === false) {
            throw new Exception("Error writing token expiration to " . $_ENV['TOKEN_FILE']);
        }
        $this->expirationTime = $this->session->getTokenExpiration();
    }
}