"""Reads a git diff from stdin and uses Groq (llama-3.3-70b-versatile) to generate
a concise markdown summary of the changes for posting as a PR comment."""

import os
import sys

from groq import Groq

MAX_DIFF_CHARS = 8000

client = Groq(api_key=os.environ["GROQ_API_KEY"])


def summarize(diff: str) -> str:
    truncated = diff[:MAX_DIFF_CHARS]
    if len(diff) > MAX_DIFF_CHARS:
        truncated += "\n\n[... diff truncated for length ...]"

    prompt = (
        "You are a senior code reviewer. Analyze the following git diff and write a concise "
        "PR summary in markdown. Include: what changed, which files are affected, and the "
        "likely intent of the change. Be brief and technical. Use bullet points. "
        "Do not add any intro sentence — start directly with the bullets.\n\n"
        f"```diff\n{truncated}\n```"
    )

    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=500,
        temperature=0.2,
    )
    return response.choices[0].message.content.strip()


def main():
    diff = sys.stdin.read()
    if not diff.strip():
        print("No diff available.")
        sys.exit(0)

    print(summarize(diff))


if __name__ == "__main__":
    main()
