// The made-up models' answers for the preview and the tests: a few written answers picked by the
// question's words, the reasoning a thinking model shows first, and a fallback that says what it
// was asked. Deterministic, so screenshots and tests see the same text every time.

const TRANSFORMER = `A **transformer** is a neural network that reads a whole sequence at once and learns which parts of it matter to each other.

## The idea in three steps

1. **Tokens become vectors.** Each word piece is turned into a list of numbers (an *embedding*), plus a hint of where it sits in the sentence.
2. **Attention mixes them.** Every token asks every other token "how relevant are you to me?" and takes a weighted blend of their meaning.
3. **Repeat and predict.** Dozens of these layers stack up; the last one scores every possible next token.

## A tiny example

In *"The cat sat on the mat because **it** was tired"*, attention lets \`it\` look back and weigh \`cat\` far more than \`mat\`.

\`\`\`python
import numpy as np

def attention(q, k, v):
    scores = q @ k.T / np.sqrt(k.shape[-1])   # how well each query matches each key
    weights = np.exp(scores) / np.exp(scores).sum(-1, keepdims=True)
    return weights @ v                          # a blend of the values
\`\`\`

| Part | What it does |
| --- | --- |
| Embedding | Words → vectors |
| Attention | Tokens look at each other |
| Feed-forward | Each token is refined on its own |

> A language model is a transformer trained to guess the next token — over and over, one token at a time.`;

const CODE = `Here is a small, order-preserving version that streams the file, so it works on large files too:

\`\`\`python
from pathlib import Path


def dedupe_lines(path: str | Path, out: str | Path | None = None) -> int:
    """Remove repeated lines, keeping the first of each. Returns how many were dropped."""
    seen: set[str] = set()
    kept: list[str] = []
    dropped = 0
    with open(path, encoding="utf-8") as f:
        for line in f:
            key = line.rstrip("\\n")
            if key in seen:
                dropped += 1
                continue
            seen.add(key)
            kept.append(line)
    Path(out or path).write_text("".join(kept), encoding="utf-8")
    return dropped
\`\`\`

And the tests, with \`pytest\`:

\`\`\`python
def test_keeps_first_occurrence(tmp_path):
    f = tmp_path / "a.txt"
    f.write_text("b\\na\\nb\\nc\\na\\n")
    assert dedupe_lines(f) == 2
    assert f.read_text() == "b\\na\\nc\\n"


def test_empty_file(tmp_path):
    f = tmp_path / "empty.txt"
    f.write_text("")
    assert dedupe_lines(f) == 0
\`\`\`

- **Time:** O(n), one pass.
- **Memory:** one copy of each distinct line.
- [x] Keeps order
- [x] Handles a missing trailing newline
- [ ] Very large files with few repeats may want a disk-backed set`;

const EMAIL = `**Subject:** Quick review of my pull request?

Hi Sam,

I hope your week is going well! When you have a moment, could you take a look at my pull request **#482 — "Faster thread search"**? It's a small change (about 120 lines) and the tests are green.

I'd love your eyes on the indexing part in particular, since you know that code best. Anytime before **Thursday** would be perfect.

Thanks so much!
Alex`;

const UNIX = `The Unix philosophy in five points:

- **Do one thing well.** Small programs with a single, clear job.
- **Compose.** Make every program's output usable as another's input — text streams and pipes (\`ls | grep | sort\`).
- **Prefer text.** Plain text is universal, inspectable and easy to transform.
- **Build early, refine often.** Prototype quickly; throw away what doesn't work.
- **Favour simplicity over cleverness.** Clear code beats fast code until it's proven too slow.`;

const IMAGE = `The image shows a **desk by a window** in soft morning light:

- A laptop with a code editor open, dark theme
- A ceramic mug on the left, still steaming
- A small potted plant and a notebook with handwritten notes

The overall mood is calm and focused — it looks like a home office early in the day.`;

/** @type {Record<string, string>} */
const THOUGHTS = {
  transformer:
    "The user wants a plain-words explanation of transformers. I should avoid heavy math, but a tiny attention snippet will make it concrete. Structure: core idea, three steps, an example sentence with a pronoun, a small table. Keep it short.",
  code: "They want dedupe while keeping order. A set for seen lines plus a list keeps order. Should stream the file rather than read it all. Add pytest tests for repeats and the empty file. Mention complexity.",
  email:
    "A short, friendly email. Include a subject, the PR number and title, a time frame, and a thank-you. Keep the tone warm but brief.",
  unix: "Five bullet points: do one thing well, composition through pipes, text streams, prototype early, simplicity. Give a pipe example.",
  image: "Describe the visible objects, the lighting and the mood.",
  default: "Let me answer directly and briefly, and say what I can do with more detail.",
};

/**
 * The answer and the reasoning for a conversation's last question.
 * @param {{ role: string, content: unknown, images?: unknown[] }[]} messages
 */
export function answerFor(messages) {
  const last = [...messages].reverse().find((m) => m.role === "user");
  const text =
    typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
  const hasImage = Boolean(last?.images?.length) || /image_url/.test(text);
  const q = text.toLowerCase();
  const system = messages.find((m) => m.role === "system");
  const topic = hasImage
    ? "image"
    : /transformer/.test(q)
      ? "transformer"
      : /python|function|code|script/.test(q)
        ? "code"
        : /email|mail/.test(q)
          ? "email"
          : /unix/.test(q)
            ? "unix"
            : "default";
  const answers = { transformer: TRANSFORMER, code: CODE, email: EMAIL, unix: UNIX, image: IMAGE };
  const answer =
    topic === "default"
      ? `You asked: *${text.slice(0, 160).replace(/\s+/g, " ")}*\n\nI'm a model running on this computer, so this conversation never leaves it.${
          system && typeof system.content === "string"
            ? `\n\nI'm following your instructions: _${system.content.slice(0, 120)}_`
            : ""
        }\n\nAsk me to **explain**, **write code**, **summarize** or **draft** something, and I'll do it right here.`
      : answers[/** @type {keyof typeof answers} */ (topic)];
  return { answer, thought: THOUGHTS[topic] };
}

/** Text cut into pieces the size of tokens: words with their spaces, long words in parts. @param {string} text */
export function tokens(text) {
  const out = [];
  for (const part of text.match(/\s+|[^\s]+/g) ?? []) {
    if (part.length <= 6) out.push(part);
    else for (let i = 0; i < part.length; i += 4) out.push(part.slice(i, i + 4));
  }
  return out;
}
