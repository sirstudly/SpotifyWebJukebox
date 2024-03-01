let spotifyApi;

const useSmallAlbumCover = window.playerConfig?.useSmallAlbumCover ?? false;

document.addEventListener('alpine:init', x => {
  Alpine.store('player', {
    init() {
      spotifyApi = new SpotifyWebApi();
      this.pollingLoop();
    },

    playbackObj: {},
    lastPlaybackObj: {},

    targetImg: 'assets/images/no_song.png',

    async pollingLoop() {
      setInterval(async () => {
        await this.fetchState();
      }, 1000)
    },

    async fetchState() {
      const response = await spotifyApi.getMyCurrentPlaybackState();
      if (response) {
        response.currentQueue = await spotifyApi.getMyCurrentQueue();
        this.handleChange(response);
      }
      return response;
    },

    async nextTrack() {
        return await spotifyApi.skipToNext();
    },

    async prevTrack() {
      return await spotifyApi.skipToPrevious();
    },

    async togglePlay() {
      return await spotifyApi.togglePlay();
    },

    handleChange(obj) {
      this.lastPlaybackObj = this.playbackObj;
      this.playbackObj = obj;

      if (this.playbackObj?.currentQueue?.queue) {
        this.playbackObj.nextUp = this.playbackObj?.currentQueue?.queue[0]?.name + ' by ' + this.playbackObj?.currentQueue?.queue[0]?.artists?.map(artist => artist.name).join(', ');
      }

      if (this.playbackObj.item?.name) {
        document.title = `Playing ${this.playbackObj.item?.name} - ${this.playbackObj.item?.artists[0].name}`;
      }

      // Fetch album art
      const imgsArr = this.playbackObj.item?.album?.images;
      const targetImg = (useSmallAlbumCover) ? imgsArr[imgsArr.length - 2]?.url : imgsArr[0]?.url;

      const lastImgsArr = this.lastPlaybackObj.item?.album?.images;
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