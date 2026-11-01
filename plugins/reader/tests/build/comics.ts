// CBZ and CBT comics with pages named out of natural order (CB7 and CBR: comic-archives.ts).
import { type Entry, tar, zip } from "./archive";
import { png } from "./png";

/** The pages in a shuffled, non-natural listing, a folder, a metadata file and macOS junk. */
export const COMIC_PAGES: Entry[] = [
  ["Issue 1/10.png", png(6, 9, [200, 0, 0])],
  ["Issue 1/2.png", png(6, 9, [0, 200, 0])],
  ["Issue 1/ComicInfo.xml", "<ComicInfo><Title>Fixture</Title></ComicInfo>"],
  ["Issue 1/1.png", png(6, 9, [0, 0, 200])],
  ["__MACOSX/Issue 1/._1.png", "junk"],
];

export const cbz = () => zip(COMIC_PAGES);
export const cbt = () => tar(COMIC_PAGES);
