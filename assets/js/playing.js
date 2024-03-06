const useSmallAlbumCover = window.playerConfig?.useSmallAlbumCover ?? false;

document.addEventListener('alpine:init', x => {
    Alpine.store('player', {
        init() {
            this.pollingLoop();
        },

        playbackObj: {},
        lastPlaybackObj: {},

        targetImg: 'assets/images/no_song.png',

        async pollingLoop() {
            setInterval(() => {
                this.fetchState();
            }, 1000)
        },

        fetchState() {
            return fetch("/now-playing")
                .then(res => res.json())
                .then(json => this.handleChange(json))
                .catch(ex => console.log(ex));
        },

        async nextTrack() {
            return await fetch("/next-track")
                .then((res) => res.json());
        },

        async prevTrack() {
            return await fetch("/prev-track")
                .then((res) => res.json());
        },

        async togglePlay() {
            return await fetch("/toggle-play")
                .then((res) => res.json());
        },

        handleChange(obj) {
            this.lastPlaybackObj = this.playbackObj;
            this.playbackObj = obj;

            if (this.playbackObj.now_playing) {
                document.title = `Playing ${this.playbackObj.now_playing?.song_title} - ${this.playbackObj.now_playing?.artist}`;
            }

            // recalculate progress_ms based on the timestamp and the current time
            if (this.playbackObj.is_playing) {
                this.playbackObj.progress_ms += Date.now() - this.playbackObj.timestamp;

                // you can't overplay the track length
                if (this.playbackObj.progress_ms > this.playbackObj.duration_ms) {
                    this.playbackObj.progress_ms = this.playbackObj.duration_ms;
                }
            }

            // Fetch album art
            const imgsArr = this.playbackObj?.now_playing?.album?.images;
            if (imgsArr === undefined) {
                return;
            }
            const targetImg = (useSmallAlbumCover) ? imgsArr[imgsArr.length - 2]?.url : imgsArr[0]?.url;

            const lastImgsArr = this.lastPlaybackObj?.now_playing?.album?.images;
            if (lastImgsArr === undefined) {
                this.targetImg = targetImg;
                return;
            }
            const lastTargetImg = (useSmallAlbumCover) ? lastImgsArr[lastImgsArr.length - 2]?.url : lastImgsArr[0]?.url;

            if (targetImg !== lastTargetImg) {
                // Load image in new element and then set it on the target
                const img = new Image();
                img.src = (targetImg !== undefined) ? targetImg : 'assets/images/no_song.png'
                img.onload = () => {
                    this.targetImg = img.src;
                }
            }

            // Set DOM classes
            document.querySelector('body').classList.toggle('np_music_playing', this.playbackObj.is_playing);
            document.querySelector('body').classList.toggle('np_music_paused', !this.playbackObj.is_playing);
        }
    })
})