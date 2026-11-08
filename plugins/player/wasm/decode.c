// Copyright 2026 Team endue. Licensed under the Apache License, Version 2.0.
//
// endue.player's decode API over FFmpeg's libavformat and libavcodec (LGPL 2.1, ADR 0050). The
// worker (ui/software/worker.js) opens a file whose bytes it reads itself: FFmpeg asks through
// dk_read, an import, at the offsets it wants. Each call to dk_next decodes up to one video frame
// (8-bit planar YUV, left where the decoder put it) or one audio frame (converted here to float
// planar, frames.c). scripts/vendor-ffmpeg.sh links these files with FFmpeg into
// ui/vendor/ffmpeg/ffmpeg.wasm.
#include "decode.h"
#include <string.h>

int dk_fail(Media *m, int code, const char *message, int err) {
  char why[96] = "";
  if (err < 0) av_strerror(err, why, sizeof why);
  m->code = code;
  if (err < 0)
    snprintf(m->error, sizeof m->error, "%s (%s).", message, why);
  else
    snprintf(m->error, sizeof m->error, "%s.", message);
  return DK_ERROR;
}

static int read_packet(void *opaque, uint8_t *buf, int size) {
  Media *m = opaque;
  if (m->pos >= m->size) return AVERROR_EOF;
  if (size > m->size - m->pos) size = (int)(m->size - m->pos);
  int got = dk_read(m->id, (double)m->pos, buf, size);
  if (got < 0) {
    m->read_failed = 1;
    return AVERROR(EIO);
  }
  if (got == 0) return AVERROR_EOF;
  m->pos += got;
  return got;
}

static int64_t seek_io(void *opaque, int64_t offset, int whence) {
  Media *m = opaque;
  if (whence & AVSEEK_SIZE) return m->size;
  whence &= ~AVSEEK_FORCE;
  int64_t to = whence == SEEK_SET   ? offset
               : whence == SEEK_CUR ? m->pos + offset
               : whence == SEEK_END ? m->size + offset
                                    : -1;
  if (to < 0) return AVERROR(EINVAL);
  m->pos = to;
  return to;
}

/** The first stream of `type` with a decoder here, the default one first; covers are skipped. */
static int pick(Media *m, enum AVMediaType type, const AVCodec **found, int *missing) {
  int best = -1, best_default = 0;
  for (unsigned i = 0; i < m->fmt->nb_streams; i++) {
    AVStream *st = m->fmt->streams[i];
    if (st->codecpar->codec_type != type) continue;
    if (st->disposition & AV_DISPOSITION_ATTACHED_PIC) continue;
    const AVCodec *codec = avcodec_find_decoder(st->codecpar->codec_id);
    if (!codec) {
      if (*missing == AV_CODEC_ID_NONE) *missing = st->codecpar->codec_id;
      continue;
    }
    int is_default = !!(st->disposition & AV_DISPOSITION_DEFAULT);
    if (best < 0 || (is_default && !best_default)) {
      best = (int)i;
      best_default = is_default;
      *found = codec;
    }
  }
  return best;
}

static int open_decoder(Media *m, Decoder *d, enum AVMediaType type) {
  const AVCodec *codec = NULL;
  int missing = AV_CODEC_ID_NONE;
  // FFmpeg's own choice first: it prefers streams that carried frames while the file was probed
  // (a RealMedia SureStream file lists a dozen streams, and only one of each kind has packets).
  d->index = av_find_best_stream(m->fmt, type, -1, -1, &codec, 0);
  if (d->index < 0 || !codec ||
      (m->fmt->streams[d->index]->disposition & AV_DISPOSITION_ATTACHED_PIC))
    d->index = pick(m, type, &codec, &missing);
  if (d->index < 0) {
    if (missing == AV_CODEC_ID_NONE) return 0;
    char message[160];
    snprintf(message, sizeof message, "The player's decoders cannot decode %s",
             avcodec_get_name(missing));
    return dk_fail(m, DK_OPEN, message, 0);
  }
  AVStream *st = m->fmt->streams[d->index];
  d->codec = avcodec_alloc_context3(codec);
  if (!d->codec) return dk_fail(m, DK_OPEN, "Out of memory", 0);
  int err = avcodec_parameters_to_context(d->codec, st->codecpar);
  if (err >= 0) {
    d->codec->pkt_timebase = st->time_base;
    d->codec->thread_count = 1;
    err = avcodec_open2(d->codec, codec, NULL);
  }
  if (err < 0) return dk_fail(m, DK_OPEN, "The decoder could not start", err);
  st->discard = AVDISCARD_DEFAULT;
  return 0;
}

Media *dk_open(int id, double size, int want_video, int want_audio) {
  Media *m = av_mallocz(sizeof *m);
  if (!m) return NULL;
  m->id = id;
  m->size = (int64_t)size;
  m->video.index = m->audio.index = -1;
  m->video.next = m->audio.next = -1;
  m->packet = av_packet_alloc();
  m->frame = av_frame_alloc();
  uint8_t *buffer = av_malloc(IO_BUFFER);
  m->io = buffer ? avio_alloc_context(buffer, IO_BUFFER, 0, m, read_packet, NULL, seek_io) : NULL;
  m->fmt = avformat_alloc_context();
  if (!m->packet || !m->frame || !m->io || !m->fmt) {
    if (!m->io) av_free(buffer);
    dk_fail(m, DK_OPEN, "Out of memory", 0);
    return m;
  }
  m->fmt->pb = m->io;
  m->fmt->flags |= AVFMT_FLAG_CUSTOM_IO;
  m->fmt->probesize = 8 << 20;
  m->fmt->max_analyze_duration = 5 * AV_TIME_BASE;
  int err = avformat_open_input(&m->fmt, NULL, NULL, NULL);
  if (err < 0) {
    dk_fail(m, m->read_failed ? DK_READ : DK_OPEN,
         m->read_failed ? "The file could not be read" : "FFmpeg does not recognise this file", err);
    return m;
  }
  err = avformat_find_stream_info(m->fmt, NULL);
  if (err < 0 && m->read_failed) {
    dk_fail(m, DK_READ, "The file could not be read", err);
    return m;
  }
  for (unsigned i = 0; i < m->fmt->nb_streams; i++) m->fmt->streams[i]->discard = AVDISCARD_ALL;
  m->start = m->fmt->start_time == AV_NOPTS_VALUE ? 0 : m->fmt->start_time;
  if (want_video && open_decoder(m, &m->video, AVMEDIA_TYPE_VIDEO) < 0) return m;
  if (want_audio && open_decoder(m, &m->audio, AVMEDIA_TYPE_AUDIO) < 0) return m;
  if (m->video.index < 0 && m->audio.index < 0)
    dk_fail(m, DK_OPEN, want_video ? "The file has no stream the player can decode"
                                : "The file has no audio the player can decode", 0);
  return m;
}

int dk_code(Media *m) { return m ? m->code : DK_OPEN; }
const char *dk_error(Media *m) { return m ? m->error : "Out of memory."; }
double dk_duration(Media *m) {
  return m->fmt && m->fmt->duration > 0 ? m->fmt->duration / (double)AV_TIME_BASE : 0;
}
int dk_has_video(Media *m) { return m->video.codec != NULL; }
int dk_has_audio(Media *m) { return m->audio.codec != NULL; }
int dk_video_width(Media *m) { return m->video.codec ? m->video.codec->width : 0; }
int dk_video_height(Media *m) { return m->video.codec ? m->video.codec->height : 0; }
/** A frame from `d` when it has one: DK_VIDEO or DK_AUDIO, 0 for none yet, DK_ERROR. */
static int receive(Media *m, Decoder *d, int kind) {
  if (!d->codec || d->done) return 0;
  for (;;) {
    int err = avcodec_receive_frame(d->codec, m->frame);
    if (err == AVERROR(EAGAIN)) return 0;
    if (err == AVERROR_EOF) {
      d->done = 1;
      return 0;
    }
    if (err < 0) return dk_fail(m, DK_DECODE, "The decoder failed", err);
    int got = kind == DK_VIDEO ? dk_take_video(m) : dk_take_audio(m);
    if (got != 0) return got;
    av_frame_unref(m->frame);
  }
}

int dk_next(Media *m) {
  if (m->code) return DK_ERROR;
  av_frame_unref(m->frame);
  for (;;) {
    int got = receive(m, &m->video, DK_VIDEO);
    if (got == 0) got = receive(m, &m->audio, DK_AUDIO);
    if (got != 0) return got;
    if (m->eof) {
      if (!m->flushed) {
        if (m->video.codec) avcodec_send_packet(m->video.codec, NULL);
        if (m->audio.codec) avcodec_send_packet(m->audio.codec, NULL);
        m->flushed = 1;
        continue;
      }
      return DK_END;
    }
    int err = av_read_frame(m->fmt, m->packet);
    if (err < 0) {
      if (m->read_failed) return dk_fail(m, DK_READ, "The file could not be read", err);
      m->eof = 1;
      continue;
    }
    Decoder *d = m->packet->stream_index == m->video.index   ? &m->video
                 : m->packet->stream_index == m->audio.index ? &m->audio
                                                             : NULL;
    if (d) {
      err = avcodec_send_packet(d->codec, m->packet);
      if (err < 0 && err != AVERROR(EAGAIN) && ++m->bad > MAX_BAD_PACKETS) {
        av_packet_unref(m->packet);
        return dk_fail(m, DK_DECODE, "The stream is damaged", err);
      }
      if (err >= 0) m->bad = 0;
    }
    av_packet_unref(m->packet);
  }
}

/** Seek to the keyframe at or before `seconds`; output before `seconds` is dropped. */
int dk_seek(Media *m, double seconds) {
  if (m->code == DK_DECODE) m->code = DK_OK;
  if (m->code) return DK_ERROR;
  if (seconds < 0) seconds = 0;
  int64_t ts = m->start + (int64_t)(seconds * AV_TIME_BASE);
  int err = avformat_seek_file(m->fmt, -1, INT64_MIN, ts, ts, 0);
  if (err < 0) err = av_seek_frame(m->fmt, -1, ts, AVSEEK_FLAG_BACKWARD);
  if (err < 0) err = avformat_seek_file(m->fmt, -1, INT64_MIN, ts, INT64_MAX, 0);
  if (err < 0) {
    // No index and no way to find one: decode from the start and drop up to the target.
    err = avformat_seek_file(m->fmt, -1, INT64_MIN, m->start, m->start, AVSEEK_FLAG_BYTE);
    if (err < 0) err = avio_seek(m->io, 0, SEEK_SET) < 0 ? -1 : 0;
  }
  if (m->read_failed) return dk_fail(m, DK_READ, "The file could not be read", err);
  if (m->video.codec) avcodec_flush_buffers(m->video.codec);
  if (m->audio.codec) avcodec_flush_buffers(m->audio.codec);
  m->video.done = m->audio.done = 0;
  m->video.next = m->audio.next = -1;
  m->eof = m->flushed = m->bad = 0;
  m->target = seconds;
  return err < 0 ? DK_ERROR : 0;
}

/** Skip frames nothing refers to (B-frames): the way to catch up when decoding falls behind. */
void dk_skip_nonref(Media *m, int on) {
  if (m->video.codec) m->video.codec->skip_frame = on ? AVDISCARD_NONREF : AVDISCARD_DEFAULT;
}

void dk_close(Media *m) {
  if (!m) return;
  avcodec_free_context(&m->video.codec);
  avcodec_free_context(&m->audio.codec);
  avformat_close_input(&m->fmt);
  if (m->io) av_freep(&m->io->buffer);
  avio_context_free(&m->io);
  av_packet_free(&m->packet);
  av_frame_free(&m->frame);
  av_freep(&m->samples);
  av_free(m);
}

void dk_quiet(int level) { av_log_set_level(level); }
