<?php
include_once('lang.php');

if (session_status() != PHP_SESSION_ACTIVE) {
    session_start();
}

error_log("CURRENT SESSION: " . session_id());
?>
<!DOCTYPE html>
<html lang="<?=$lang;?>" class="h-screen w-screen bg-black">
<head>
    <title x-text="`${$store.player.playbackObj.item?.name} - ${$store.player.playbackObj.item?.artists[0].name}">Spotify Connect - Now Playing</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
    <meta name="description" content="NowPlaying is a smooth Spotify Connect visualizer, updating in real-time and with playback support." />
    <link rel="icon" type="image/png" href="assets/images/favicon.png">

    <script src="https://cdn.tailwindcss.com/"></script>
    <script>
      tailwind.config = {
        theme: {
          extend: {
            fontFamily: {
              'sans': ['Outfit', 'sans-serif']
            },
          }
        },
      }
    </script>

    <style>
        .custom-img-shadow {
            box-shadow:
                0 5px 10px rgba(0, 0, 0, 0.12),
                0 10px 20px rgba(0, 0, 0, 0.15),
                0 15px 28px rgba(0, 0, 0, 0.18),
                0 20px 38px rgba(0, 0, 0, 0.20);
        }

        [x-cloak] { display: none !important; }

        .clear-input-container {
            position: relative;
            display: inline-block;
        }

        .clear-input-button {
            /* button position */
            position: absolute;
            right: 8px;
            top: 10px;
            bottom: 0;
            /* button appearane */
            justify-content: center;
            align-items: center;
            width: 24px;
            height: 24px;
            appearance: none;
            border: none;
            border-radius: 50%;
            background: gray;
            margin: 0;
            padding: 2px;
            color: white;
            font-size: 18px;
            cursor: pointer;
            /* hide the button initially */
            display: none;
        }

        .clear-input-button:hover {
            background: darkgray;
        }

        .clear-input--touched:focus + .clear-input-button,
        .clear-input--touched:hover + .clear-input-button,
        .clear-input--touched + .clear-input-button:hover {
            display: inline-flex;
        }
    </style>

    <!-- Font -->
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@200..900&display=swap" rel="stylesheet">
    <script src="https://ajax.googleapis.com/ajax/libs/jquery/3.4.1/jquery.min.js"></script>

    <link href="https://unpkg.com/flickity@2/dist/flickity.css" rel="stylesheet">
    <script src="https://unpkg.com/flickity@2/dist/flickity.pkgd.min.js"></script>

    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/tw-elements/dist/css/tw-elements.min.css"/>
    <script src="https://cdn.tailwindcss.com/3.3.0"></script>

    <script src="assets/js/scripts.js?ts=<?=time ()?>"></script>
    <script src="assets/js/spotify-web-api.js"></script>
    <script src="assets/js/playing.js?ts=<?=time ()?>"></script>

    <style>
        /* external css: flickity.css */

        .carousel {
            background: black;
        }

        .carousel-cell {
            width: 70%;
            height: 430px;
            /* flex-box, center image in cell */
            display: -webkit-box;
            display: -webkit-flex;
            display:         flex;
            -webkit-box-pack: center;
            -webkit-justify-content: center;
            justify-content: center;
            -webkit-align-items: center;
            align-items: center;
        }

        .carousel-cell img {
            display: block;
            max-width: 100%;
            max-height: 100%;
            /* dim unselected */
            opacity: 0.7;
            -webkit-transform: scale(0.85);
            transform: scale(0.85);
            -webkit-filter: blur(5px);
            filter: blur(5px);
            -webkit-transition: opacity 0.3s, -webkit-transform 0.3s, transform 0.3s, -webkit-filter 0.3s, filter 0.3s;
            transition: opacity 0.3s, transform 0.3s, filter 0.3s;
        }

        /* brighten selected image */
        .carousel-cell.is-selected img {
            opacity: 1;
            -webkit-transform: scale(1);
            transform: scale(1);
            -webkit-filter: none;
            filter: none;
        }

        @media screen and ( min-width: 768px ) {
            .carousel-cell {
                height: 430px;
            }
        }

        @media screen and ( min-width: 960px ) {
            .carousel-cell {
                width: 60%;
            }
        }

        /* buttons, no circle */
        .flickity-prev-next-button {
            width: 60px;
            height: 60px;
            background: transparent;
            opacity: 0.6;
        }
        .flickity-prev-next-button:hover {
            background: transparent;
            opacity: 1;
        }
        /* arrow color */
        .flickity-prev-next-button .arrow {
            fill: white;
        }
        .flickity-prev-next-button.no-svg {
            color: white;
        }
        /* closer to edge */
        .flickity-prev-next-button.previous { left: 0; }
        .flickity-prev-next-button.next { right: 0; }
        /* hide disabled button */
        .flickity-prev-next-button:disabled {
            display: none;
        }
    </style>
</head>
<body
    x-data="{
        translations: {
            defaultTitleSong: '<?=defaultTitleSong;?>',
            defaultArtistSong: '<?=defaultArtistSong;?>',
        },
        showOverlay: true,
        timeout: null,

        deviceName: window.deviceName,

        handleMouseMove() {
            this.showOverlay = true;

            window.clearTimeout(this.timeout);
            this.timeout = setTimeout(() => {
                this.showOverlay = false;
            }, 6000);
        },
    }"
    x-init="handleMouseMove"
    @mousemove.throttle="handleMouseMove"
    class="flex h-screen w-screen overflow-hidden np_music_paused"
    :style="{
        cursor: showOverlay ? 'default' : 'none'
    }"
>
    <div
        id="background-image-div"
        class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 translate-z-0 w-[max(115vh,115vw)] h-[max(115vh,115vw)]"
    >
        <div
            class="bg-cover bg-center transition-[background] duration-[2s] ease-in-out z-[-10] h-full w-full blur-2xl transform-gpu"
            style="background-image: url('assets/images/no_song.png');"
            :style="{
                backgroundImage: `url(${$store.player.targetImg ?? 'assets/images/no_song.png'})`
            }"
        >
            <div class="h-full w-full bg-black/30"></div>
        </div>
    </div>

    <div
        x-show="showOverlay"
        x-transition:enter.duration.100ms
        x-transition:leave.duration.500ms
        id="settings-div"
        class="settings-div fadeInOut z-30 absolute top-6 left-0 right-0 flex items-center justify-center"
    >
        <div class="flex flex-row items-center gap-2 px-4 py-2 bg-white/10 border-2 border-white/40 text-white/80 rounded-full">
            <svg onclick="fullscreen()" class="cursor-pointer" width="28" height="28" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M6.66675 6.66666H13.3334V9.33332H9.33341V13.3333H6.66675V6.66666ZM18.6667 6.66666H25.3334V13.3333H22.6667V9.33332H18.6667V6.66666ZM22.6667 18.6667H25.3334V25.3333H18.6667V22.6667H22.6667V18.6667ZM13.3334 22.6667V25.3333H6.66675V18.6667H9.33341V22.6667H13.3334Z" fill="white"/>
            </svg>
        </div>
    </div>

    <div class="h-full w-full overflow-y-auto flex align-center justify-center z-20">
        <div class="flex flex-col landscape:flex-row lg:flex-row gap-6 lg:gap-12 justify-center items-center px-6 lg:px-12 xl:px-0 w-full xl:w-5/6">
            <div class="relative w-[20rem] landscape:w-[20rem] landscape:lg:w-[30rem] md:w-[30rem] flex-shrink-0">
                <img
                    src="assets/images/no_song.png"
                    :src="$store.player.targetImg ?? 'assets/images/no_song.png'"
                    class="rounded-2xl h-auto w-full custom-img-shadow"
                >

                <!-- Web playback SDK -->

                <button
                    x-cloak
                    @click="$store.webPlayback.togglePlay()"
                    x-show="$store.webPlayback?.isAvailable && showOverlay"
                    x-transition:enter.duration.100ms
                    x-transition:leave.duration.150ms
                    class="absolute bottom-6 right-6 z-30 p-3 bg-black/20 border-2 border-white/60 text-white rounded-full backdrop-blur-lg active:scale-95 transition"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-10 w-10" fill="currentColor" x-show="$store.player.playbackObj?.is_playing"><path d="M14,19H18V5H14M6,19H10V5H6V19Z" /></svg>
                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-10 w-10" fill="currentColor" x-show="!$store.player.playbackObj?.is_playing"><path d="M8,5.14V19.14L19,12.14L8,5.14Z" /></svg>
                </button>

                <div
                    x-cloak
                    x-show="$store.webPlayback?.isAvailable && showOverlay"
                    x-transition:enter.duration.100ms
                    x-transition:leave.duration.150ms
                    class="absolute bottom-6 left-6 z-30 flex flex-row bg-black/20 border-2 border-white/60 text-white rounded-full backdrop-blur-lg"
                >
                    <button class="px-3 py-1 active:scale-95 transition" @click="$store.webPlayback.previousTrack()">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-6 w-6" fill="currentColor"><path d="M6,18V6H8V18H6M9.5,12L18,6V18L9.5,12Z" /></svg>
                    </button>
                    <button class="px-3 py-1 active:scale-95 transition" @click="$store.webPlayback.nextTrack()">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-6 w-6" fill="currentColor"><path d="M16,18H18V6H16M6,18L14.5,12L6,6V18Z" /></svg>
                    </button>
                </div>
            </div>

            <div class="flex flex-col lg:gap-1 xl:gap-2 w-full text-white">
                <h1
                    x-text="$store.player.playbackObj.item?.name ?? translations.defaultTitleSong"
                    id="song-title"
                    class="text-4xl lg:text-7xl font-bold text-pretty">
                </h1>
                <h2
                    x-text="$store.player.playbackObj.item?.artists?.map(artist => artist.name).join(', ') ?? translations.defaultArtistSong"
                    id="song-artist"
                    class="text-2xl lg:text-5xl font-bold text-pretty">
                </h2>
                <h3
                    x-text="$store.player.playbackObj?.item?.album?.name"
                    id="song-album"
                    class="text-xl lg:text-4xl font-semibold opacity-80 text-pretty">
                </h3>

                <div class="flex flex-col gap-2 lg:gap-3 mt-4 lg:mt-8 w-full">
                    <div class="text-xl flex flex-row justify-between w-full font-semibold" id="progress-time">
                        <span
                            x-show="$store.player.playbackObj?.progress_ms"
                            x-text="msToTime($store.player.playbackObj?.progress_ms)"
                            x-cloak
                            id="progress-time-now"
                        ></span>
                        <span
                            x-show="$store.player.playbackObj?.item?.duration_ms"
                            x-text="msToTime($store.player.playbackObj?.item?.duration_ms)"
                            x-cloak
                            id="progress-time-total"
                        ></span>
                    </div>

                    <div class="h-3 w-full rounded-full overflow-hidden bg-white/30">
                        <div
                            id="progressbar"
                            class="h-full bg-white"
                            :class="{
                                'transition-all duration-1000 ease-linear': Math.abs($store.player.playbackObj?.progress_ms - $store.player.lastPlaybackObj?.progress_ms) < 5000
                            }"
                            :style="{
                                width: `${($store.player.playbackObj?.progress_ms / $store.player.playbackObj?.item?.duration_ms) * 100}%`
                            }"
                        ></div>
                    </div>

                    <div x-show="$store.player.playbackObj?.nextUp" class="flex flex-row gap-3 items-center" id="player-controls">
                        <div>
                            <svg width="28" height="28" data-encore-id="icon" role="img" aria-hidden="true" viewBox="0 0 16 16" style="vector-effect: non-scaling-stroke; fill: currentcolor;"><path d="M15 15H1v-1.5h14V15zm0-4.5H1V9h14v1.5zm-14-7A2.5 2.5 0 0 1 3.5 1h9a2.5 2.5 0 0 1 0 5h-9A2.5 2.5 0 0 1 1 3.5zm2.5-1a1 1 0 0 0 0 2h9a1 1 0 1 0 0-2h-9z"></path></svg>
                        </div>

                        <span class="text-xl font-bold">
                            Next Up:
                            <span x-text="$store.player.playbackObj?.nextUp"></span>
                        </span>
                    </div>

                    <div class="z-30 flex flex-row justify-end">
                        <!-- Button trigger modal -->
                        <button class="z-30 flex flex-row items-center gap-2 px-4 py-1 bg-white/10 border border-white/40 text-white/80 rounded-full"
                                data-te-toggle="modal"
                                data-te-target="#queueModal"
                                data-te-ripple-init
                                data-te-ripple-color="light">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="h-6 w-6" fill="currentColor"><path d="M16.5 3H21.5C22.3 3 23 3.7 23 4.5V7.5C23 8.3 22.3 9 21.5 9H18L15 12V4.5C15 3.7 15.7 3 16.5 3M3 3C1.9 3 1 3.9 1 5V19C1 20.1 1.9 21 3 21H11C12.1 21 13 20.1 13 19V5C13 3.9 12.1 3 11 3H3M7 5C8.1 5 9 5.9 9 7S8.1 9 7 9 5 8.1 5 7 5.9 5 7 5M7 11C9.2 11 11 12.8 11 15S9.2 19 7 19 3 17.2 3 15 4.8 11 7 11M7 13C5.9 13 5 13.9 5 15S5.9 17 7 17 9 16.1 9 15 8.1 13 7 13" /></svg>
                            <span>Queue a Song</span>
                        </button>
                    </div>

                </div>
            </div>
        </div>
    </div>

    <!-- Modal -->
    <div data-te-modal-init class="fixed left-0 top-10 z-[1055] px-1 py-1 hidden h-full w-full overflow-y-auto overflow-x-hidden outline-none"
         id="queueModal" tabindex="-1" aria-labelledby="queueModalLabel" aria-hidden="true">
        <div data-te-modal-dialog-ref class="pointer-events-none relative w-auto translate-y-[-50px] opacity-0 transition-all duration-300 ease-in-out min-[576px]:mx-auto min-[576px]:mt-7 min-[576px]:max-w-[500px]">
            <div class="min-[576px]:shadow-[0_0.5rem_1rem_rgba(#000, 0.15)] pointer-events-auto relative flex w-full flex-col rounded-md border-none bg-clip-padding text-current shadow-lg outline-none bg-slate-800">
                <div class="flex flex-shrink-0 items-center justify-between rounded-t-md border-b-2 border-neutral-100 border-opacity-100 p-4 dark:border-opacity-50">
                    <!--Modal title-->
                    <h5 class="text-xl font-medium leading-normal text-neutral-200" id="queueModalLabel">
                        Choose a Song
                    </h5>
                    <!--Close button-->
                    <button type="button"
                            class="box-content rounded-none border-none text-white hover:no-underline hover:opacity-75 focus:opacity-100 focus:shadow-none focus:outline-none"
                            data-te-modal-dismiss aria-label="Close">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor" class="h-6 w-6">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <!--Modal body-->
                <!--alpinejs example: https://alpinejs.codewithhugo.com/fetch-data/ -->
                <!-- https://dberri.com/lets-build-an-ajax-form-with-alpine-js/ -->
                <!-- https://ember.2038.io/slider.html -->
                <div x-data="spotifySearch()" x-init="$watch('searchResults', value => resetCarousel())" class="relative flex-auto p-2" data-te-modal-body-ref>
                    <div class="flex flex-row gap-2 py-1">
                        <!-- https://nikitahl.com/input-clear-button -->
                        <div class="clear-input-container flex w-2/3">
                            <input type="text" name="spotifySearchInput" x-model="spotifySearchInput" x-on:keyup="doSearch();" class="clear-input w-full bg-white focus:outline-none focus:shadow-outline border border-gray-300 rounded-lg p-2 appearance-none leading-normal">
                            <button class="clear-input-button" aria-label="Clear input" title="Clear input">
                                &times;
                            </button>
                        </div>
                        <button type="button" @click="doSearch()" class="ml-1 inline-block rounded bg-primary bg-sky-800 px-6 pb-2 pt-2.5 text-xs font-medium uppercase leading-normal text-white shadow-[0_4px_9px_-4px_#3b71ca] transition duration-150 ease-in-out hover:bg-primary-600 hover:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.3),0_4px_18px_0_rgba(59,113,202,0.2)] focus:bg-primary-600 focus:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.3),0_4px_18px_0_rgba(59,113,202,0.2)] focus:outline-none focus:ring-0 active:bg-primary-700 active:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.3),0_4px_18px_0_rgba(59,113,202,0.2)] dark:shadow-[0_4px_9px_-4px_rgba(59,113,202,0.5)] dark:hover:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.2),0_4px_18px_0_rgba(59,113,202,0.1)] dark:focus:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.2),0_4px_18px_0_rgba(59,113,202,0.1)] dark:active:shadow-[0_8px_9px_-4px_rgba(59,113,202,0.2),0_4px_18px_0_rgba(59,113,202,0.1)]"
                                :class="[ isLoading ? 'opacity-50 cursor-not-allowed' : 'active:bg-primary-700 hover:bg-primary-600' ]" :disabled="isLoading"
                                data-te-ripple-init data-te-ripple-color="light">
                            Search
                        </button>
                    </div>
                    <div x-cloak x-show="message" class="flex flex-row gap-2 py-1 pl-4 text-sm"
                         x-transition:enter.duration.100ms
                         x-transition:leave.duration.500ms>
                        <span x-text="message" :class="isError ? 'text-red-500' : 'text-yellow-300'"></span>
                    </div>
                    <div class="carousel js-flickity" data-flickity='{ "draggable": true, "pageDots": false }'>
                        <template x-if="searchResults">
                            <template x-for="track in searchResults.tracks.items" :key="track.uri">
                                <div class="carousel-cell">
                                    <div class="text-sm justify-center flex flex-col">
                                        <template x-for="image in track.album.images">
                                            <template x-if="image.height == 300">
                                                <img :src="image.url">
                                            </template>
                                        </template>
                                        <h3 class="text-white text-base font-bold leading-none mb-2" x-text="track.name"></h3>
                                        <h4 class="text-slate-300 text-sm font-bold leading-none mb-2" x-text="track.artist_names"></h4>
                                        <div class="flex flex-row justify-center">
                                            <button @click="queueTrack(track.uri)" class="flex bg-gray-200 rounded-full px-3 py-1 text-sm font-semibold text-gray-700">Queue Track</button>
                                        </div>
                                    </div>
                                </div>
                            </template>
                        </template>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script src="//unpkg.com/alpinejs" defer></script>
    <script src="https://sdk.scdn.co/spotify-player.js"></script>
    <script>
    window.deviceName = 'CRH JamBot #' + localStorage.getItem('deviceId');

    const waitForSpotify = new Promise((resolve, reject) => {
        window.onSpotifyWebPlaybackSDKReady = () => {
            resolve();
        };
    });
    const waitForAlpine = new Promise((resolve, reject) => {
        document.addEventListener('alpine:init', () => {
            resolve();
        });
    });

    Promise.all([waitForSpotify, waitForAlpine]).then(() => {
        // const token = readCookie('accessToken');

        // let player;
        Alpine.store('webPlayback', {
            isAvailable: <?=isset($_SESSION["showPlaybackControls"]) && $_SESSION["showPlaybackControls"] == 'true'?>,
            isConnected: false,
            isPlaying: false,

            togglePlay() {
                Alpine.store('player').togglePlay().then(result => {
                    console.log("togglePlay: ", result);
                });
            },

            nextTrack() {
                Alpine.store('player').nextTrack();
            },

            previousTrack() {
                Alpine.store('player').prevTrack();
            },

            init() {
                // player = new Spotify.Player({
                //     name: window.deviceName,
                //     getOAuthToken: cb => { cb(token); }
                // });
                //
                // // Error handling
                // player.addListener('initialization_error', ({ message }) => {
                //     this.isAvailable = false;
                //     console.error(message);
                // });
                // player.addListener('authentication_error', ({ message }) => {
                //     this.isAvailable = false;
                //     console.error(message);
                // });
                // player.addListener('account_error', ({ message }) => {
                //     this.isAvailable = false;
                //     console.error(message);
                // });
                // player.addListener('playback_error', ({ message }) => {
                //     this.isAvailable = false;
                //     console.error(message);
                // });

                // Playback status updates
//                 player.addListener('player_state_changed', () => {
//                     player.getCurrentState().then(state => {
// console.log("PLAYBACK STATE CHANGED: ", state);
//                         this.isConnected = (state !== null && (state.playback_id && state.playback_id !== ""));
//                         this.isPlaying = state !== null ? state.paused === false : false;
//                     });
//                 });

                // the following event only occurs if the player is local
                // it won't ever fire if we're playing on a different device
                // player.addListener('player_state_changed', ({
                //                                                 position,
                //                                                 duration,
                //                                                 track_window: { current_track }
                //                                             }) => {
                //     console.log('Currently Playing', current_track);
                //     console.log('Position in Song', position);
                //     console.log('Duration of Song', duration);
                // });
                // player.on('player_state_changed', state => {
                //     console.log("player_state_changed:", state);
                // });
                //
                // // Ready
                // player.addListener('ready', ({ device_id }) => {
                //     this.isAvailable = true;
                //     console.log('Ready with Device ID', device_id);
                // });
                //
                // // Not Ready
                // player.addListener('not_ready', ({ device_id }) => {
                //     this.isAvailable = false;
                //     console.log('Device ID has gone offline', device_id);
                // });
                //
                // // Connect to the player
                // player.connect();
            },
        });
    });

    function spotifySearch() {
        return {
            spotifySearchInput: "",
            searchResults: null,
            isLoading: false,
            searchTimeout: null,
            message: null,
            isError: false,
            doSearch() {
                // on first load, remove the empty "template" element so it doesn't render a blank page dot
                // if (this.spotifySearchInput.length == 0 && $('.carousel').data('flickity').cells) {
                //     $('.carousel').data('flickity').cells.shift();
                //     $('.carousel').flickity('resize');
                //     console.log("done spotifySearch() RESET");
                // }

                // Clear the timeout if it has already been set.
                // This will prevent the previous task from executing
                // if it has been less than <MILLISECONDS>
                clearTimeout(this.searchTimeout);
                this.isLoading = true;
                let this_instance = this; // keep a reference to this scope so it's accessible below

                // Make a new timeout set to go off in 2 sec
                this.searchTimeout = setTimeout(function () {
                    if (this_instance.spotifySearchInput.length) {
                        fetch(`spotify.php?c=search&q=${this_instance.spotifySearchInput}`)
                            .then((res) => res.json())
                            .then((data) => {
                                this_instance.isLoading = false;
                                this_instance.searchResults = data;
                            })
                    }
                }, 2000);
            },
            resetCarousel() {
                console.log("RESETTING CAROUSEL");
                $('.carousel').flickity('reloadCells');
                // bit of a hack; the two "template" elements appear as additional cells at the start of the cells array
                // so remove the two extra elements
                $('.carousel').data('flickity').cells.shift();
                $('.carousel').data('flickity').cells.shift();
                $('.carousel')
                    .flickity('resize')
                    .flickity('selectCell', 0);
            },
            queueTrack(trackUri) {
                console.log("QUEUE TRACK " + trackUri);
                if (trackUri) {
                    fetch(`spotify.php?c=queue&uri=${trackUri}`)
                        .then((res) => res.json())
                        .then((data) => {
                            if (data.message) {
                                this.message = data.message;
                                this.isError = data.error;
                                setTimeout( () => {
                                    this.message = null;
                                    this.isError = false;
                                }, 5000 );
                            }
                            console.log("response: ", data.message);
                        })
                }
            }
        };
    }

    const input = document.querySelector(".clear-input")
    const clearButton = document.querySelector(".clear-input-button")

    const handleInputChange = (e) => {
        if (e.target.value && !input.classList.contains("clear-input--touched")) {
            input.classList.add("clear-input--touched")
        } else if (!e.target.value && input.classList.contains("clear-input--touched")) {
            input.classList.remove("clear-input--touched")
        }
    }

    const handleButtonClick = (e) => {
        input.value = ''
        input.focus()
        input.classList.remove("clear-input--touched")
    }

    clearButton.addEventListener("click", handleButtonClick)
    input.addEventListener("input", handleInputChange)
    </script>

    <!-- TW Elements is free under AGPL, with commercial license required for specific uses. See more details: https://tw-elements.com/license/ and contact us for queries at tailwind@mdbootstrap.com -->
    <script src="https://cdn.jsdelivr.net/npm/tw-elements/dist/js/tw-elements.umd.min.js"></script>
</body>
</html>
