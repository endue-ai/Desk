// Codec names people read, from the ids each container writes: MP4 sample entries, AVI and ASF
// FourCCs, WAVE format tags and Matroska codec ids. One table per id space; unknown ids show as
// themselves.

/** MP4 and QuickTime sample entry types. */
export const MP4_CODECS = {
  avc1: "H.264",
  avc3: "H.264",
  hvc1: "HEVC",
  hev1: "HEVC",
  dvh1: "Dolby Vision",
  dvhe: "Dolby Vision",
  vp08: "VP8",
  vp09: "VP9",
  av01: "AV1",
  mp4v: "MPEG-4 Part 2",
  s263: "H.263",
  h263: "H.263",
  jpeg: "Motion JPEG",
  mjpa: "Motion JPEG",
  mjpb: "Motion JPEG",
  apch: "ProRes",
  apcn: "ProRes",
  apcs: "ProRes",
  apco: "ProRes",
  ap4h: "ProRes",
  ap4x: "ProRes",
  "ac-3": "AC-3",
  "ec-3": "E-AC-3",
  "ac-4": "AC-4",
  Opus: "Opus",
  fLaC: "FLAC",
  alac: "Apple Lossless",
  ".mp3": "MP3",
  lpcm: "PCM",
  sowt: "PCM",
  twos: "PCM",
  in24: "PCM",
  in32: "PCM",
  fl32: "PCM",
  fl64: "PCM",
  raw: "PCM",
  ulaw: "μ-law",
  alaw: "A-law",
  ima4: "IMA ADPCM",
  samr: "AMR-NB",
  sawb: "AMR-WB",
  dtsc: "DTS",
  dtsh: "DTS-HD",
  dtsl: "DTS-HD",
  tx3g: "Timed text",
  text: "Timed text",
  wvtt: "WebVTT",
  c608: "CEA-608 captions",
  tmcd: "Timecode",
};

/** AVI, ASF and Matroska's V_MS/VFW FourCCs, upper-cased. */
export const FOURCCS = {
  H264: "H.264",
  X264: "H.264",
  AVC1: "H.264",
  HEVC: "HEVC",
  H265: "HEVC",
  HVC1: "HEVC",
  XVID: "MPEG-4 Part 2",
  DIVX: "MPEG-4 Part 2",
  DX50: "MPEG-4 Part 2",
  FMP4: "MPEG-4 Part 2",
  MP4V: "MPEG-4 Part 2",
  DIV3: "MPEG-4 Part 2 (Microsoft)",
  MP43: "MPEG-4 Part 2 (Microsoft)",
  MP42: "MPEG-4 Part 2 (Microsoft)",
  MJPG: "Motion JPEG",
  WMV1: "Windows Media Video 7",
  WMV2: "Windows Media Video 8",
  WMV3: "Windows Media Video 9",
  WMVA: "Windows Media Video 9 Advanced",
  WVC1: "VC-1",
  VP80: "VP8",
  VP90: "VP9",
  MPG2: "MPEG-2 Video",
  MPG1: "MPEG-1 Video",
  DVSD: "DV",
  FFV1: "FFV1",
  CVID: "Cinepak",
  IV50: "Indeo 5",
  "\0\0\0\0": "Uncompressed",
};

/** WAVE format tags (WAVEFORMATEX), in AVI, WAV, ASF and Matroska's A_MS/ACM. */
export const WAVE_FORMATS = {
  1: "PCM",
  2: "MS ADPCM",
  3: "PCM",
  6: "A-law",
  7: "μ-law",
  10: "Windows Media Voice",
  17: "IMA ADPCM",
  49: "GSM 6.10",
  80: "MP2",
  85: "MP3",
  255: "AAC",
  352: "Windows Media Audio 1",
  353: "Windows Media Audio 2",
  354: "Windows Media Audio Pro",
  355: "Windows Media Audio Lossless",
  5648: "AAC",
  8192: "AC-3",
  8193: "DTS",
  61868: "FLAC",
};

/** Matroska codec ids, by prefix where the id has variants (A_AAC/MPEG4/LC, V_MPEG4/ISO/ASP). */
const MATROSKA = [
  ["V_MPEG4/ISO/AVC", "H.264"],
  ["V_MPEGH/ISO/HEVC", "HEVC"],
  ["V_MPEG4/ISO", "MPEG-4 Part 2"],
  ["V_MPEG2", "MPEG-2 Video"],
  ["V_MPEG1", "MPEG-1 Video"],
  ["V_VP8", "VP8"],
  ["V_VP9", "VP9"],
  ["V_AV1", "AV1"],
  ["V_THEORA", "Theora"],
  ["V_PRORES", "ProRes"],
  ["V_MJPEG", "Motion JPEG"],
  ["V_FFV1", "FFV1"],
  ["V_REAL/RV40", "RealVideo 4.0"],
  ["A_AAC", "AAC"],
  ["A_OPUS", "Opus"],
  ["A_VORBIS", "Vorbis"],
  ["A_FLAC", "FLAC"],
  ["A_AC3", "AC-3"],
  ["A_EAC3", "E-AC-3"],
  ["A_DTS", "DTS"],
  ["A_TRUEHD", "Dolby TrueHD"],
  ["A_MPEG/L3", "MP3"],
  ["A_MPEG/L2", "MP2"],
  ["A_PCM", "PCM"],
  ["A_ALAC", "Apple Lossless"],
  ["A_WAVPACK4", "WavPack"],
  ["S_TEXT/UTF8", "SubRip"],
  ["S_TEXT/ASS", "ASS"],
  ["S_TEXT/SSA", "SSA"],
  ["S_ASS", "ASS"],
  ["S_SSA", "SSA"],
  ["S_TEXT/WEBVTT", "WebVTT"],
  ["S_HDMV/PGS", "PGS"],
  ["S_VOBSUB", "VobSub"],
  ["S_DVBSUB", "DVB subtitles"],
];

/** @param {string} id */
export const matroskaCodec = (id) =>
  MATROSKA.find(([prefix = ""]) => id.startsWith(prefix))?.[1] ?? id;

/** @param {string} fourcc */
export const fourccCodec = (fourcc) =>
  /** @type {Record<string, string>} */ (FOURCCS)[fourcc.toUpperCase()] ?? fourcc.trim();

/** @param {number} tag */
export const waveCodec = (tag) =>
  /** @type {Record<number, string>} */ (WAVE_FORMATS)[tag] ??
  `format 0x${tag.toString(16).padStart(4, "0")}`;

/** @param {string} type */
export const mp4Codec = (type) => {
  const names = /** @type {Record<string, string>} */ (MP4_CODECS);
  return names[type] ?? names[type.trim()] ?? type.trim();
};

/** A list in words: "A", "A and B", "A, B and C". */
export function words(/** @type {string[]} */ items) {
  if (items.length < 2) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
