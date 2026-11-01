// The two ways a file does not open as a book: it cannot be shown (the details view says why), or
// it is locked and waits for its password.

/** @typedef {{ label: string, value: string }} Fact */

export class Unreadable extends Error {
  /**
   * @param {string} why One sentence the person reads.
   * @param {{ format?: string, facts?: Fact[] }} [more]
   */
  constructor(why, more = {}) {
    super(why);
    this.name = "Unreadable";
    this.why = why;
    this.format = more.format;
    this.facts = more.facts ?? [];
  }
}

export class PasswordNeeded extends Error {
  /** @param {boolean} wrong Whether a password was given and refused. */
  constructor(wrong) {
    super(wrong ? "That password is not right." : "This PDF is protected by a password.");
    this.name = "PasswordNeeded";
    this.wrong = wrong;
  }
}
