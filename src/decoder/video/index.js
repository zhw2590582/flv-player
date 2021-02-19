import { calculationRate } from '../../utils';

export default class VideoSuperDecoder {
    constructor(flv, decoder) {
        this.flv = flv;
        const { options, player, debug } = flv;

        this.ready = false;
        this.playing = false;
        this.playIndex = 0;
        this.videoframes = [];
        this.timestamps = [];
        this.videoInputLength = 0;
        this.videoOutputLength = 0;
        this.decoding = false;
        this.byteSize = 0;
        this.loaded = 0;

        this.decoderRate = calculationRate(rate => {
            flv.emit('decoderRate', rate);
        });

        this.drawRate = calculationRate(rate => {
            flv.emit('drawRate', rate);
        });

        flv.on('destroy', () => {
            this.videoframes = [];
            this.timestamps = [];
            this.decoderWorker.terminate();
            this.decoderWorker = null;
            this.stop();
        });

        flv.on('befoerdecoding', timestamp => {
            if (options.live && options.hasAudio && !this.playing && this.timestamps.length >= player.frameRate) {
                this.timestamps.shift();
            }
            this.timestamps.push(timestamp);
            this.decoding = true;
            this.videoInputLength += 1;
        });

        flv.on('decoding', (message, byteSize) => {
            if (options.live && options.hasAudio && !this.playing && this.timestamps.length >= player.frameRate) {
                this.videoframes.shift();
            }
            this.videoframes.push(message);
            this.byteSize += byteSize;
            this.videoOutputLength += 1;
            this.decoding = this.videoInputLength !== this.videoOutputLength;
            this.loaded = this.videoOutputLength / player.frameRate;
            flv.emit('videoLoaded', this.loaded);
            this.decoderRate(1);
            if (!this.ready && this.videoOutputLength === 1) {
                this.ready = true;
                if (options.live) {
                    decoder.currentTime = this.timestamps[0] / 1000;
                }
                flv.emit('ready');
            }
        });

        flv.on('timeupdate', currentTime => {
            const index = this.playIndex;
            const timestamp = this.timestamps[index];
            if (timestamp !== undefined && currentTime * 1000 >= timestamp) {
                if (this.draw(index)) {
                    const framesSize = this.getFramesSize(index);
                    if (
                        (options.live || !options.cache) &&
                        framesSize >= options.videoChunk * 64 &&
                        this.videoframes.length - 1 >= index &&
                        this.timestamps.length - 1 > index
                    ) {
                        this.playIndex = 0;
                        this.videoframes.splice(0, index + 1);
                        this.timestamps.splice(0, index + 1);
                        decoder.currentTime = this.timestamps[0] / 1000;
                        debug.log('free-video-memory', {
                            total: this.byteSize,
                            yuv: framesSize,
                            index,
                        });
                        flv.emit('freeVideoMemory', framesSize, index);
                    } else {
                        this.playIndex += 1;
                    }
                } else {
                    if (!options.live) {
                        this.stop();
                    }
                }
            }
        });
    }

    draw(index) {
        const videoframe = this.videoframes[index];
        if (!videoframe) return false;
        this.renderer.drawFrame(videoframe);
        this.drawRate(1);
        return true;
    }

    play(startTime = 0) {
        this.playing = true;
        if (this.flv.options.live) {
            this.playIndex = 0;
            this.flv.decoder.currentTime = (this.timestamps[0] || 0) / 1000;
        } else {
            this.playIndex = this.timestamps.findIndex(timestamp => {
                return timestamp >= startTime * 1000;
            });
        }
    }

    stop() {
        this.playing = false;
        if (this.flv.options.live) {
            this.playIndex = 0;
        }
    }
}
