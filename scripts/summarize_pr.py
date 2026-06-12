"""Reads a git diff from stdin and uses Groq (llama-3.1-8b-instant) to generate
a concise markdown summary of the changes for posting as a PR comment."""

import os
import sys
import time

from groq import Groq, RateLimitError

MAX_DIFF_CHARS = 4000
MAX_RETRIES = 3
RETRY_DELAY = 5  # seconds; doubles each attempt: 5 → 10 → 20

SKIP_EXTENSIONS = {".lock", ".min.js", ".min.css", "-lock.json"}

client = Groq(api_key=os.environ["GROQ_API_KEY"])


def filter_diff(diff: str) -> str:
    """Drop lock/generated files from the diff to save tokens."""
    lines, skip = [], False
    for line in diff.splitlines(keepends=True):
        if line.startswith("diff --git"):
            skip = any(line.rstrip().endswith(ext) for ext in SKIP_EXTENSIONS)
        if not skip:
            lines.append(line)
    return "".join(lines)


def summarize(diff: str) -> str | None:
    diff = filter_diff(diff)
    truncated = diff[:MAX_DIFF_CHARS]
    if len(diff) > MAX_DIFF_CHARS:
        truncated += "\n[...truncated...]"

    prompt = (
        "Summarize this git diff as a concise markdown PR description. "
        "Use bullet points. Cover: what changed, files affected, intent. "
        "No intro sentence.\n\n"
        f"```diff\n{truncated}\n```"
    )

    for attempt in range(MAX_RETRIES):
        try:
            response = client.chat.completions.create(
                model="llama-3.1-8b-instant",
                messages=[{"role": "user", "content": prompt}],
                max_tokens=400,
                temperature=0.2,
            )
            return response.choices[0].message.content.strip()
        except RateLimitError as e:
            if attempt < MAX_RETRIES - 1:
                delay = RETRY_DELAY * (2 ** attempt)
                print(
                    f"Rate limit hit — retrying in {delay}s "
                    f"(attempt {attempt + 1}/{MAX_RETRIES})",
                    file=sys.stderr,
                )
                time.sleep(delay)
            else:
                print(f"Rate limit exhausted after {MAX_RETRIES} attempts: {e}", file=sys.stderr)
                return None


def main():
    diff = sys.stdin.read()
    if not diff.strip():
        print("No diff available.")
        sys.exit(0)

    result = summarize(diff)
    if result is None:
        # Unrecoverable rate limit — post a soft message and exit cleanly
        # so the workflow does not block the PR.
        print("_Summary not available — Groq rate limit reached. Will be generated on the next run._")
        sys.exit(0)

    print(result)


if __name__ == "__main__":
    main()
