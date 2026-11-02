// Copyright 2026 Team endue. Licensed under the Apache License, Version 2.0.
//
// What decode.c (opening, reading packets, seeking) and frames.c (each decoded frame as the worker
// takes it) share: the open file and its two decoders. See decode.c.
#ifndef DK_DECODE_H
#define DK_DECODE_H

#include <libavcodec/avcodec.h>
#include <libavformat/avformat.h>
#include <libavutil/pixdesc.h>
#include <stdint.h>
#include <string.h>

// Reads `length` bytes at `offset` of file `id` into `into`: the count read, 0 at the end, -1 when
// the file cannot be read.
__attribute__((import_module("env"), import_name("dk_read"))) extern int dk_read(
    int id, double offset, uint8_t *into, int length);

#define IO_BUFFER (64 * 1024)
#define MAX_RATE 192000
#define MAX_BAD_PACKETS 200

enum { DK_OK = 0, DK_OPEN = 1, DK_READ = 2, DK_DECODE = 3 };
enum { DK_END = 0, DK_VIDEO = 1, DK_AUDIO = 2, DK_ERROR = -1 };

typedef struct {
  AVCodecContext *codec;
  int index;
  int done;   // the decoder answered AVERROR_EOF after the flush
  double next; // the time the next frame starts when it has none of its own
} Decoder;

typedef struct {
  int id;
  int64_t size, pos;
  int read_failed;
  AVFormatContext *fmt;
  AVIOContext *io;
  AVPacket *packet;
  AVFrame *frame;
  Decoder video, audio;
  int64_t start; // the container's start, in AV_TIME_BASE units: times count from it
  int eof, flushed, bad;
  double target; // after a seek, output before this time is dropped
  double time;
  // The audio frame, as float planar: channel c at samples + c * count.
  float *samples;
  int samples_cap, count, channels, rate;
  int code;
  char error[256];
} Media;

int dk_fail(Media *m, int code, const char *message, int err);
int dk_take_video(Media *m);
int dk_take_audio(Media *m);
int dk_factor(int rate);

#endif
