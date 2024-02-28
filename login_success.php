<?php
if (!isset($_COOKIE['refreshToken']) || $_COOKIE['refreshTime'] < time()) {
    header('Location: login.php?generateMiniPlayer=true');
    die();
}

if(isset($_GET)){
    if(isset($_GET['lang']) && !empty($_GET['lang'])){
        setcookie('lang', $_GET['lang'], time() + 60*60*24*30);
    }
}

include_once('lang.php');

if(isset($_GET['lang'])){
    header('Location: '.$_SERVER['PHP_SELF']);
}

?>

<!DOCTYPE html>
<html lang="<?=$lang;?>" class="bg-[#000020] text-white">
<head>
	<title>Spotify Jukebox - Access Tokens</title>
	<link rel="icon" type="image/png" href="assets/images/favicon.png">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<meta name="description" content="Use these generate access tokens to access Spotify." />

	<meta name="twitter:card" content="summary" />
	<meta name="twitter:creator" content="@busybox11" />
	<meta name="twitter:image" content="https://<?=$_SERVER['SERVER_NAME'];?>/assets/images/favicon.png" />

	<meta property="og:title" content="NowPlaying" />
	<meta property="og:type" content="website" />
	<meta property="og:description" content="Use these generate access tokens to access Spotify." />
	<meta property="og:image" content="https://<?=$_SERVER['SERVER_NAME'];?>/assets/images/favicon.png" />

	<meta name="theme-color" content="#23a92a" />

	<link href="https://fonts.googleapis.com/icon?family=Material+Icons" rel="stylesheet">
	<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@200..900&display=swap" rel="stylesheet">

	<script src="https://cdn.tailwindcss.com"></script>
	<script>
		tailwind.config = {
			theme: {
				extend: {
					fontFamily: {
						'sans': ['Outfit', 'sans-serif']
					},
				}
			}
		}
	</script>

  <script>
    const refreshToken = '<?=$_COOKIE['refreshToken'];?>';
    const accessToken = '<?=$_COOKIE['accessToken'];?>';
    const currentUrl = window.location.origin + window.location.pathname.slice(0, window.location.pathname.lastIndexOf('/'));
  </script>
</head>

<body x-data="generateTokenData" class="flex flex-col h-screen px-4 py-auto gap-8 items-center justify-center text-center">
	<div class="flex flex-col items-center justify-center w-full">
    <div class="flex flex-row gap-6 items-center justify-center">
      <a href="/">
        <img src="assets/images/favicon.png" alt="Logo" width="100px" height="100px">
      </a>

      <div>
		    <h1 class="text-3xl lg:text-4xl font-bold">Here are your generated tokens!</h1>
            <h2 class="text-2xl lg:text-3xl font-bold">Paste them into your .env file.</h2>

        <div class="flex flex-row gap-2 mt-2">
            <?php include 'assets/links.php'; ?>
        </div>
      </div>
    </div>

        <div x-show="messageText" class="flex flex-row mt-1"
             x-transition:enter.duration.500ms
             x-transition:leave.duration.500ms
        >
            <div class="bg-white/10 rounded-l-lg w-full" x-text="messageText">
            </div>
        </div>

        <div class="flex flex-row items-center mt-3">
            <div class="min-w-32">Access Token:</div>
            <div class="bg-white/10 rounded-l-lg w-full">
                <input type="text" class="w-full border-0 focus:ring-[#15883D] focus:ring-2 focus:ring-inset rounded-l-lg py-2 px-3 bg-transparent outline-none" :value="getAccessToken()" readonly>
            </div>
            <button class="bg-[#15883D] py-2 px-3 rounded-r-lg" @click="navigator.clipboard.writeText(getAccessToken()); setCopiedToClipboard()">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-6 w-6"><path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z" /></svg>
            </button>
        </div>

        <div class="flex flex-row items-center mt-3">
            <div class="min-w-32">Refresh Token:</div>
            <div class="bg-white/10 rounded-l-lg w-full">
                <input type="text" class="w-full border-0 focus:ring-[#15883D] focus:ring-2 focus:ring-inset rounded-l-lg py-2 px-3 bg-transparent outline-none" :value="getRefreshToken()" readonly>
            </div>
            <button class="bg-[#15883D] py-2 px-3 rounded-r-lg" @click="navigator.clipboard.writeText(getRefreshToken()); setCopiedToClipboard()">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="h-6 w-6"><path d="M19,21H8V7H19M19,5H8A2,2 0 0,0 6,7V21A2,2 0 0,0 8,23H19A2,2 0 0,0 21,21V7A2,2 0 0,0 19,5M16,1H4A2,2 0 0,0 2,3V17H4V3H16V1Z" /></svg>
            </button>
        </div>

    <div class="flex flex-row items-center text-left bg-red-800/50 px-4 py-2 rounded-lg gap-4 mt-8 w-4/5">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-8 w-8 flex-shrink-0" fill="currentColor"><path d="M13,13H11V7H13M13,17H11V15H13M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2Z" /></svg>
        NOTE: If you post the access token on a website, be aware that it can subsequently be used to control your Spotify account!
    </div>
	</div>

  <script src="//unpkg.com/alpinejs" defer></script>
  <script>
      document.addEventListener('alpine:init', () => {
          Alpine.data('generateTokenData', () => ({
              messageText : null,
              setCopiedToClipboard() {
                  this.messageText = "Token copied to clipboard.";
                  setTimeout( () => {
                      this.messageText = null;
                  }, 5000);
              },
              getAccessToken() {
                  return accessToken;
              },
              getRefreshToken() {
                  return refreshToken;
              },
          }));
      })
  </script>
</body>
</html>
