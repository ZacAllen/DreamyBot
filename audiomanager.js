const { Player } = require("./player.js");
const EventEmitter = require("events");
const constants = require("../util/constants.js");
const ytstream = require("yt-stream");
const youtubedl = require("youtube-dl-exec");
const { ValueSaver } = require("valuesaver");

var globals = {};

class AudioManager extends EventEmitter {
  constructor(options) {
    super();
    if (typeof options !== "object" || Array.isArray(options) || options === null) options = {};
    this.ffmpeg = true;
    if (typeof options.ffmpeg === "boolean") {
      if (options.ffmpeg === false) {
        this.ffmpeg = false;
      }
    }
  }
  play(channel, stream, options, playShuffle) {
    if (!channel || !stream) throw new Error(constants.ERRORMESSAGES.AM_REQUIRED_PARAMETERS);
    if (typeof channel !== "object") throw new Error(constants.ERRORMESSAGES.INVALID_CHANNEL_PARAMETER);
    if (typeof stream === "undefined" || stream === undefined || stream === "")
      throw new Error(constants.ERRORMESSAGES.INVALID_STREAM_PARAMETER);

    const settings = {
      quality: "high",
      audiotype: "arbitrary",
      volume: 10,
    };

    if (options) {
      if (typeof options.quality === "string")
        settings["quality"] = options.quality.toLowerCase() === "low" ? options.quality : "high";
      if (typeof options.audiotype === "string") settings["audiotype"] = options.audiotype;
      if (typeof options.volume === "number") settings["volume"] = options.volume;
    } else options = {};
    const yturl = ytstream.validateVideoURL(stream);
    const playlisturl = ytstream.validatePlaylistURL(stream);

    const isUnavailable = async (track) => {
      let hasError = false;
      if (track.title.includes("Private video") && track.title.includes("Deleted video")) {
        return true;
      } else {
        try {
          await ytstream.getInfo(track.url).catch((err) => {
            console.log("*** isUnavailable error", err, " - ", track.title);
            hasError = true;
          });
        } catch (err) {
          hasError = true;
        }
      }
      return hasError;
    };

    const getYtdlPlaylist = async (stream) => {
      let ytdlPlaylist = [];
      await youtubedl(stream, {
        dumpSingleJson: true,
        yesPlaylist: true,
        flatPlaylist: true,
        playlistRandom: playShuffle ? true : new Boolean(false), // why need cast?
        skipUnavailableFragments: true,
        forceIpv6: true,
        noCheckCertificates: true,
        noWarnings: true,
        preferFreeFormats: true,
        addHeader: ["referer:youtube.com", "user-agent:googlebot"],
      })
        .then(async (output) => {
          let newArray = []; //create new array for filtered songs
          // resolve all ytstream song checks (ytdl cannot verify if video is unavailable consistently)
          await Promise.all(
            output.entries.map((track) => {
              return isUnavailable(track);
            })
          )
            .then((result) => {
              console.log("*** Resulting songs", result.length);
              if (result) {
                newArray = output.entries.filter((track, index) => result[index] === false);
              }
            })
            .catch((err) => {
              console.log("*** PromiseErr", err);
            });
          const filteredEntries = newArray;
          ytdlPlaylist = { ...output, entries: filteredEntries };
        })
        .catch((err) => console.log(err));
      return ytdlPlaylist;
    };

    return new Promise(async (resolve, reject) => {
      if (globals[channel.id] instanceof ValueSaver) {
        globals[channel.id].set(`started`, false);
        if (typeof options.volume === "number") {
          globals[channel.id].set(`volume`, options.volume / 10);
        }
        var queue = globals[channel.id].get(`queue`);
        let loopType = globals[channel.id].get(`loop`);
        if (yturl === true) {
          try {
            var info = await ytstream.getInfo(stream);
            queue.push({
              url: stream,
              quality: settings["quality"],
              audiotype: settings["audiotype"],
              info: info,
              volume: settings["volume"],
              started: 0,
              paused: false,
              pauses: [],
              loopType: loopType,
            });
          } catch {
            queue.push({
              url: stream,
              quality: settings["quality"],
              audiotype: settings["audiotype"],
              info: undefined,
              volume: settings["volume"],
              started: 0,
              paused: false,
              pauses: [],
              loopType: loopType,
            });
          }
        } else if (playlisturl === true) {
          try {
            var ytdlPlaylist = await getYtdlPlaylist(stream);
            // var playlistInfo = playlist.videos.map(v => {
            //   return {url: v.video_url, quality: settings['quality'], audiotype: settings['audiotype'], info: v, volume: settings['volume'], started: 0, paused: false, pauses: [], loopType: loopType};
            // });
            // queue.push(...playlistInfo);
            var ytdlPlaylistInfo = ytdlPlaylist.entries.map((v) => {
              return {
                url: v.url,
                quality: settings["quality"],
                audiotype: settings["audiotype"],
                info: v,
                volume: settings["volume"],
                started: 0,
                paused: false,
                pauses: [],
                loopType: 0,
              };
            });
            queue.push(...ytdlPlaylistInfo);
          } catch {
            reject(`The parsed url is an invalid playlist url`);
          }
        } else
          queue.push({
            url: stream,
            quality: settings["quality"],
            audiotype: settings["audiotype"],
            info: undefined,
            volume: settings["volume"],
            started: 0,
            paused: false,
            pauses: [],
            loopType: loopType,
          });
        if (globals[channel.id] instanceof ValueSaver) {
          globals[channel.id].set(`queue`, queue);
          this.emit(`queue_add`, stream);
          resolve(true);
        } else {
          this.play(channel, stream, options).then(resolve).catch(reject);
        }
      } else {
        globals[channel.id] = new ValueSaver();
        globals[channel.id].set(`queue`, []);
        globals[channel.id].set(`previous`, []);
        globals[channel.id].set(`loop`, 0);
        globals[channel.id].set(`started`, true);
        if (typeof options.volume === "number") {
          globals[channel.id].set(`volume`, options.volume / 10);
        }

        var queue = globals[channel.id].get(`queue`);

        const player = new Player(channel, {
          ffmpeg: Boolean(this.ffmpeg),
        });

        if (yturl === true) {
          try {
            var info = await ytstream.getInfo(stream);
            queue.push({
              url: stream,
              quality: settings["quality"],
              audiotype: settings["audiotype"],
              info: info,
              volume: settings["volume"],
              started: 0,
              paused: false,
              pauses: [],
              loopType: 0,
            });
          } catch {
            queue.push({
              url: stream,
              quality: settings["quality"],
              audiotype: settings["audiotype"],
              info: undefined,
              volume: settings["volume"],
              started: 0,
              paused: false,
              pauses: [],
              loopType: 0,
            });
          }
        } else if (playlisturl === true) {
          try {
            // var playlist = await ytstream.getPlaylist(stream);
            // var playlistInfo = playlist.videos.map(v => {
            //   return {url: v.video_url, quality: settings['quality'], audiotype: settings['audiotype'], info: v, volume: settings['volume'], started: 0, paused: false, pauses: [], loopType: 0};
            // });
            var ytdlPlaylist = await getYtdlPlaylist(stream);
            var ytdlPlaylistInfo = ytdlPlaylist.entries.map((v) => {
              return {
                url: v.url,
                quality: settings["quality"],
                audiotype: settings["audiotype"],
                info: v,
                volume: settings["volume"],
                started: 0,
                paused: false,
                pauses: [],
                loopType: 0,
              };
            });
            queue.push(...ytdlPlaylistInfo);
          } catch {
            reject(`The parsed url is an invalid playlist url`);
          }
        } else
          queue.push({
            url: stream,
            quality: settings["quality"],
            audiotype: settings["audiotype"],
            info: undefined,
            volume: settings["volume"],
            started: 0,
            paused: false,
            pauses: [],
            loopType: 0,
          });
        queue[0].started = new Date().getTime();
        globals[channel.id].set(`queue`, queue);
        player
          .play(queue[0].url, {
            autoleave: false,
            selfDeaf: true,
            selfMute: false,
            audiotype: settings["audiotype"],
            quality: settings["quality"],
            volume: globals[channel.id].get(`volume`) || settings["volume"] / 10,
          })
          .then(() => {
            this.emit(`play`, channel, stream);

            player.on("stop", () => {
              if (!(globals[channel.id] instanceof ValueSaver)) return;
              queue = globals[channel.id].get(`queue`);
              let previous = globals[channel.id].get(`previous`);
              if (globals[channel.id].get(`loop`) === 0) {
                queue[0].started = 0;
                previous.push(queue[0]);
                queue.shift();
              } else if (globals[channel.id].get(`loop`) === 2) {
                queue[0].started = 0;
                queue[0].pauses = [];
                queue[0].paused = false;
                queue.push(queue[0]);
                previous.push(queue[0]);
                queue.shift();
              }
              if (queue.length > 0) {
                queue[0].started = new Date().getTime();
                player
                  .play(queue[0].url, {
                    autoleave: false,
                    selfDeaf: true,
                    selfMute: false,
                    audiotype: queue[0].audiotype,
                    quality: queue[0].quality,
                    volume: globals[channel.id].get(`volume`) || settings["volume"] / 10,
                  })
                  .catch((err) => {});

                globals[channel.id].set(`queue`, queue);
                globals[channel.id].set(`previous`, previous);
              } else {
                player.destroy();
                globals[channel.id] = undefined;
                this.emit(`end`, channel);
              }
            });

            globals[channel.id].set(`connection`, player);
            resolve(false);
          })
          .catch((err) => {
            if (globals[channel.id].get(`started`) === true) delete globals[channel.id];
            reject(err);
          });

        player.once(constants.EVENTS.AUDIO_CONNECTION_DISCONNECT, (channelId) => {
          if (globals[channelId].get(`connection`)) globals[channelId].get(`connection`).destroy();
          this.emit(`connection_destroy`, channel);
          delete globals[channelId];
        });
      }
    });
  }
  loop(channel, loop) {
    if (!channel || typeof loop !== "number") throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETERS_LOOP);
    if (isNaN(loop)) throw new Error(constants.ERRORMESSAGES.LOOP_PARAMETER_NAN);
    if (loop < 0 || loop > 2) throw new Error(constants.ERRORMESSAGES.LOOP_PARAMETER_INVALID);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    let queue = globals[channel.id].get(`queue`);
    queue = queue.map((i) => {
      return {
        ...i,
        loopType: loop,
      };
    });
    globals[channel.id].set(`queue`, queue);
    globals[channel.id].set(`loop`, loop);
  }
  looptypes = {
    off: 0,
    loop: 1,
    queueloop: 2,
  };
  stop(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    globals[channel.id].get(`connection`).destroy();
    this.emit(`connection_destroy`, channel);
    globals[channel.id] = undefined;
  }
  skip(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    const queue = globals[channel.id].get(`queue`);
    const player = globals[channel.id].get(`connection`);
    return new Promise((resolve, reject) => {
      let previous = globals[channel.id].get(`previous`);
      if (globals[channel.id].get(`loop`) === 0) {
        queue[0].started = 0;
        previous.push(queue[0]);
        globals[channel.id].set(`previous`, previous);
        queue.shift();
        if (queue.length === 0) {
          resolve();
          return this.stop(channel);
        }
        queue[0].started = new Date().getTime();
        player
          .play(queue[0].url, {
            quality: queue[0].quality,
            autoleave: false,
            selfDeaf: true,
            selfMute: false,
            audiotype: queue[0].audiotype,
          })
          .then(() => {
            resolve();
          })
          .catch((err) => {
            reject(err);
          });
      } else if (globals[channel.id].get(`loop`) === 2) {
        queue[0].started = 0;
        queue[0].pauses = [];
        queue[0].paused = false;
        previous.push(queue[0]);
        globals[channel.id].set(`previous`, previous);
        queue.push(queue[0]);
        queue.shift();
        queue[0].started = new Date().getTime();
        player
          .play(queue[0].url, {
            quality: queue[0].quality,
            autoleave: false,
            selfDeaf: true,
            selfMute: false,
            audiotype: queue[0].audiotype,
          })
          .then(() => {
            resolve();
          })
          .catch((err) => {
            reject(err);
          });
      } else if (globals[channel.id].get(`loop`) === 1) {
        queue[0].started = new Date().getTime();
        player
          .play(queue[0].url, {
            quality: queue[0].quality,
            autoleave: false,
            selfDeaf: true,
            selfMute: false,
            audiotype: queue[0].audiotype,
          })
          .then(() => {
            resolve();
          })
          .catch((err) => {
            reject(err);
          });
      }
    });
  }
  previous(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    const queue = globals[channel.id].get(`queue`);
    const player = globals[channel.id].get(`connection`);
    return new Promise((resolve, reject) => {
      const previous = globals[channel.id].get(`previous`);
      const previousSong = previous.length > 0 ? previous[previous.length - 1] : queue[0];
      previousSong.started = new Date().getTime();
      previousSong.pauses = [];
      if (previousSong.loopType === 2) {
        if (previous.length > 0) {
          queue.splice(queue.length - 1, 1);
          queue.splice(0, 0, previousSong);
          previous.shift();
        }
        globals[channel.id].set(`previous`, previous);
        globals[channel.id].set(`queue`, queue);
        globals[channel.id].set(`loop`, 2);
        player
          .play(previousSong.url, {
            quality: previousSong.quality,
            autoleave: false,
            selfDeaf: true,
            selfMute: false,
            audiotype: previousSong.audiotype,
          })
          .then(() => {
            resolve();
          })
          .catch(reject);
      } else if (previousSong.loopType === 1) {
        if (previous.length > 0) {
          queue.splice(0, 0, previousSong);
          previous.shift();
        }
        globals[channel.id].set(`previous`, previous);
        globals[channel.id].set(`queue`, queue);
        globals[channel.id].set(`loop`, 1);
        player
          .play(previousSong.url, {
            quality: previousSong.quality,
            autoleave: false,
            selfDeaf: true,
            selfMute: false,
            audiotype: previousSong.audiotype,
          })
          .then(() => {
            resolve();
          })
          .catch(reject);
      } else if (previousSong.loopType === 0) {
        if (previous.length > 0) {
          queue.splice(0, 0, previousSong);
          previous.shift();
        }
        globals[channel.id].set(`previous`, previous);
        globals[channel.id].set(`queue`, queue);
        globals[channel.id].set(`loop`, 0);
        player
          .play(previousSong.url, {
            quality: previousSong.quality,
            autoleave: false,
            selfDeaf: true,
            selfMute: false,
            audiotype: previousSong.audiotype,
          })
          .then(() => {
            resolve();
          })
          .catch(reject);
      }
    });
  }
  pause(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    const player = globals[channel.id].get(`connection`);
    const queue = globals[channel.id].get(`queue`);
    if (!queue[0].paused) {
      queue[0].paused = true;
      queue[0].pauses.push({ started: new Date().getTime(), ended: null });
      globals[channel.id].set(`queue`, queue);
    }
    player.pause();
  }
  resume(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    const player = globals[channel.id].get(`connection`);
    const queue = globals[channel.id].get(`queue`);
    if (queue[0].paused) {
      queue[0].paused = false;
      queue[0].pauses[0].ended = new Date().getTime();
      globals[channel.id].set(`queue`, queue);
    }
    player.resume();
  }
  queue(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    const queue = globals[channel.id].get(`queue`);
    const audioqueue = queue.reduce((total, item) => {
      var title = item.info ? item.info.title : null;
      total.push({ url: item.url, title: title });
      return total;
    }, []);
    return audioqueue;
  }
  clearqueue(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    globals[channel.id].set(`queue`, []);
  }
  deletequeue(channel, stream) {
    if (!channel || !stream) throw new Error(constants.ERRORMESSAGES.AM_REQUIRED_PARAMETERS);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    return new Promise((resolve, reject) => {
      const queue = globals[channel.id].get(`queue`);
      const song = queue.filter((song) => song.url === stream);
      if (!song[0]) return reject(constants.ERRORMESSAGES.DELETE_QUEUE_SONG_NOT_EXISTS);
      const index = queue.indexOf(song[0]);
      if (index >= 0) {
        queue.splice(index, 1);
        resolve();
        this.emit(`queue_remove`, stream);
      } else return reject(constants.ERRORMESSAGES.DELETE_QUEUE_SONG_NOT_EXISTS);
    });
  }
  diagnostic(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    const queue = globals[channel.id].get(`queue`);
    const audioqueue = queue.reduce((total, item) => {
      // var title = item.info ? item.info.title : null;
      total.push({ ...item });
      return total;
    }, []);
    return audioqueue;
  }
  shuffle(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    var queue = [...globals[channel.id].get(`queue`)];
    const firstSong = queue[0];
    queue.shift();
    for (var i = 0; i < queue.length; i++) {
      const queueVal = queue[i];
      const randIndex = Math.round(Math.random() * (queue.length - 1));
      const replaceVal = queue[randIndex];
      queue[i] = replaceVal;
      queue[randIndex] = queueVal;
    }
    queue = [firstSong, ...queue];
    globals[channel.id].set(`queue`, queue);
  }
  destroy() {
    for (const global in globals) {
      globals[global].get(`connection`).destroy();
    }
    globals = {};
    this.emit(`destroy`);
  }
  volume(channel, volume) {
    if (this.ffmpeg === false) return false;
    if (!channel || !volume) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETERS_VOLUME);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    if (isNaN(volume)) throw new Error(constants.ERRORMESSAGES.AM_NAN_VOLUME);
    if (volume < 1 || volume > 10) throw new Error(constants.ERRORMESSAGES.AM_INVALID_VOLUME);
    const player = globals[channel.id].get(`connection`);
    globals[channel.id].set(`volume`, volume / 10);
    player.volume(`${volume}/10`);
  }
  getCurrentSong(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    var queue = [...globals[channel.id].get(`queue`)];
    const firstSong = queue[0];
    return {
      url: firstSong.url,
      title: firstSong.info ? firstSong.info.title : null,
      started: firstSong.started,
      ytInfo: firstSong.info ?? null,
      paused: firstSong.paused,
      pauses: [...firstSong.pauses],
      loop: globals[channel.id].get(`loop`),
    };
  }
  getVolume(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    return globals[channel.id].get(`volume`) * 10;
  }
  setFilter(channel, ...filters) {
    return new Promise((resolve, reject) => {
      if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
      if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
      const player = globals[channel.id].get(`connection`);
      player
        .setFilter(...filters)
        .then(() => {
          const queue = globals[channel.id].get(`queue`);
          queue[0].started = new Date().getTime();
          queue[0].paused = false;
          queue[0].pauses = [];
          globals[channel.id].set(`queue`, queue);
          resolve();
        })
        .catch(reject);
    });
  }
  removeFilter(channel, ...filters) {
    return new Promise((resolve, reject) => {
      if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
      if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
      const player = globals[channel.id].get(`connection`);
      player
        .removeFilter(...filters)
        .then(() => {
          const queue = globals[channel.id].get(`queue`);
          queue[0].started = new Date().getTime();
          queue[0].paused = false;
          queue[0].pauses = [];
          globals[channel.id].set(`queue`, queue);
          resolve();
        })
        .catch(reject);
    });
  }
  getFilters(channel) {
    if (!channel) throw new Error(constants.ERRORMESSAGES.REQUIRED_PARAMETER_CHANNEL);
    if (!globals[channel.id]) throw new Error(constants.ERRORMESSAGES.PLAY_FUNCTION_NOT_CALLED);
    const player = globals[channel.id].get(`connection`);
    return player.getFilters();
  }
}

module.exports = { AudioManager };
