// Copyright 2026 Team endue. Licensed under the Apache License, Version 2.0.
//
// Each decoded frame as the worker takes it (decode.c decodes them): a video frame's planes stay
// where the decoder put them and the worker copies them out; audio is converted here to float
// planar, averaged down when its rate is above MAX_RATE; output before a seek's target is dropped.
#include "decode.h"
#include <libavutil/pixdesc.h>

/** The rate audio frames come at: DSD and other rates above MAX_RATE are divided by a whole factor. */
int dk_factor(int rate) {
  int factor = 1;
  while (rate / factor > MAX_RATE) factor++;
  return factor;
}
int dk_audio_rate(Media *m) {
  int rate = m->audio.codec ? m->audio.codec->sample_rate : 0;
  return rate / dk_factor(rate);
}
int dk_audio_channels(Media *m) { return m->audio.codec ? m->audio.codec->ch_layout.nb_channels : 0; }
const char *dk_video_codec(Media *m) { return m->video.codec ? m->video.codec->codec->name : ""; }
const char *dk_audio_codec(Media *m) { return m->audio.codec ? m->audio.codec->codec->name : ""; }

/**
 * A frame's time in seconds from the container's start; `d->next` when it has none, and for audio
 * also when it would start inside the frame before (RealMedia gives every frame of a packet the
 * packet's time). A jump of more than a quarter second is a real gap and kept.
 */
static double time_of(Media *m, Decoder *d, AVFrame *f, int audio) {
  int64_t ts = f->best_effort_timestamp;
  if (ts == AV_NOPTS_VALUE) return d->next < 0 ? m->target : d->next;
  AVRational base = m->fmt->streams[d->index]->time_base;
  double time = (double)ts * base.num / base.den - (double)m->start / AV_TIME_BASE;
  if (audio && d->next >= 0 && time < d->next && time > d->next - 0.25) return d->next;
  return time;
}

static int planar_yuv(enum AVPixelFormat format) {
  switch (format) {
  case AV_PIX_FMT_YUV420P: case AV_PIX_FMT_YUVJ420P: case AV_PIX_FMT_YUV422P:
  case AV_PIX_FMT_YUVJ422P: case AV_PIX_FMT_YUV444P: case AV_PIX_FMT_YUVJ444P:
  case AV_PIX_FMT_YUV411P: case AV_PIX_FMT_YUVJ411P: case AV_PIX_FMT_YUV410P:
  case AV_PIX_FMT_YUV440P: case AV_PIX_FMT_YUVJ440P: case AV_PIX_FMT_GRAY8:
    return 1;
  default:
    return 0;
  }
}

int dk_take_video(Media *m) {
  AVFrame *f = m->frame;
  double time = time_of(m, &m->video, f, 0);
  double step = f->duration > 0 ? f->duration * av_q2d(m->fmt->streams[m->video.index]->time_base)
                                 : 1.0 / 25;
  m->video.next = time + step;
  if (time + step / 2 < m->target) return 0;
  if (!planar_yuv(f->format)) {
    char message[128];
    snprintf(message, sizeof message, "The player cannot show video in the pixel format %s",
             av_get_pix_fmt_name(f->format) ? av_get_pix_fmt_name(f->format) : "unknown");
    return dk_fail(m, DK_DECODE, message, 0);
  }
  m->time = time;
  return DK_VIDEO;
}

int dk_frame_width(Media *m) { return m->frame->width; }
int dk_frame_height(Media *m) { return m->frame->height; }
int dk_planes(Media *m) { return m->frame->format == AV_PIX_FMT_GRAY8 ? 1 : 3; }
uint8_t *dk_plane(Media *m, int i) { return m->frame->data[i]; }
int dk_linesize(Media *m, int i) { return m->frame->linesize[i]; }
int dk_plane_width(Media *m, int i) {
  const AVPixFmtDescriptor *d = av_pix_fmt_desc_get(m->frame->format);
  return i == 0 ? m->frame->width : AV_CEIL_RSHIFT(m->frame->width, d->log2_chroma_w);
}
int dk_plane_height(Media *m, int i) {
  const AVPixFmtDescriptor *d = av_pix_fmt_desc_get(m->frame->format);
  return i == 0 ? m->frame->height : AV_CEIL_RSHIFT(m->frame->height, d->log2_chroma_h);
}
int dk_full_range(Media *m) {
  enum AVPixelFormat f = m->frame->format;
  return m->frame->color_range == AVCOL_RANGE_JPEG || f == AV_PIX_FMT_YUVJ420P ||
         f == AV_PIX_FMT_YUVJ422P || f == AV_PIX_FMT_YUVJ444P || f == AV_PIX_FMT_YUVJ411P ||
         f == AV_PIX_FMT_YUVJ440P || f == AV_PIX_FMT_GRAY8;
}
int dk_bt709(Media *m) {
  enum AVColorSpace space = m->frame->colorspace;
  if (space == AVCOL_SPC_BT709) return 1;
  if (space == AVCOL_SPC_BT470BG || space == AVCOL_SPC_SMPTE170M) return 0;
  return m->frame->height >= 720;
}

/** One sample of channel `c` at `i` as a float, whatever the decoder's sample format. */
static float sample(const AVFrame *f, int c, int i, int channels) {
  enum AVSampleFormat format = f->format;
  int planar = av_sample_fmt_is_planar(format);
  const uint8_t *base = f->extended_data[planar ? c : 0];
  int at = planar ? i : i * channels + c;
  switch (av_get_packed_sample_fmt(format)) {
  case AV_SAMPLE_FMT_U8: return (base[at] - 128) / 128.0f;
  case AV_SAMPLE_FMT_S16: return ((const int16_t *)base)[at] / 32768.0f;
  case AV_SAMPLE_FMT_S32: return (float)(((const int32_t *)base)[at] / 2147483648.0);
  case AV_SAMPLE_FMT_S64: return (float)(((const int64_t *)base)[at] / 9223372036854775808.0);
  case AV_SAMPLE_FMT_FLT: return ((const float *)base)[at];
  case AV_SAMPLE_FMT_DBL: return (float)((const double *)base)[at];
  default: return 0;
  }
}

int dk_take_audio(Media *m) {
  AVFrame *f = m->frame;
  int channels = f->ch_layout.nb_channels;
  int rate = f->sample_rate > 0 ? f->sample_rate : m->audio.codec->sample_rate;
  if (channels <= 0 || rate <= 0 || f->nb_samples <= 0) return 0;
  double time = time_of(m, &m->audio, f, 1);
  m->audio.next = time + (double)f->nb_samples / rate;
  int factor = dk_factor(rate);
  int skip = 0;
  if (time < m->target) {
    skip = (int)((m->target - time) * rate);
    if (skip >= f->nb_samples) return 0;
    time = m->target;
  }
  int count = (f->nb_samples - skip) / factor;
  if (count <= 0) return 0;
  if (count * channels > m->samples_cap) {
    av_freep(&m->samples);
    m->samples_cap = count * channels;
    m->samples = av_malloc_array(m->samples_cap, sizeof(float));
    if (!m->samples) {
      m->samples_cap = 0;
      return dk_fail(m, DK_DECODE, "Out of memory", 0);
    }
  }
  for (int c = 0; c < channels; c++) {
    float *out = m->samples + (size_t)c * count;
    for (int i = 0; i < count; i++) {
      float sum = 0;
      for (int k = 0; k < factor; k++) sum += sample(f, c, skip + i * factor + k, channels);
      out[i] = sum / factor;
    }
  }
  m->count = count;
  m->channels = channels;
  m->rate = rate / factor;
  m->time = time;
  return DK_AUDIO;
}

float *dk_samples(Media *m) { return m->samples; }
int dk_sample_count(Media *m) { return m->count; }
int dk_sample_channels(Media *m) { return m->channels; }
int dk_sample_rate(Media *m) { return m->rate; }
double dk_time(Media *m) { return m->time; }
