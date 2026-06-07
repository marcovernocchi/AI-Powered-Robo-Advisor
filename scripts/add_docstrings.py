"""Scans backend/api/ and backend/models/ for public functions without docstrings,
then uses Groq (llama-3.3-70b-versatile) to generate and insert one-line Google-style docstrings."""

import ast
import os
import re
import sys

from groq import Groq

TARGETS = ["backend/api", "backend/models"]
client = Groq(api_key=os.environ["GROQ_API_KEY"])


def get_docstring(func_name: str, source: str) -> str:
    prompt = (
        f"Write a concise one-line Google-style docstring for this Python function. "
        f"Return only the docstring text, no quotes, no explanation.\n\n{source}"
    )
    response = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        max_tokens=80,
        temperature=0.2,
    )
    return response.choices[0].message.content.strip().strip('"').strip("'")


def process_file(path: str) -> bool:
    with open(path, "r", encoding="utf-8") as f:
        source = f.read()

    tree = ast.parse(source)
    lines = source.splitlines()
    insertions: list[tuple[int, str]] = []

    for node in ast.walk(tree):
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        if node.name.startswith("_"):
            continue
        if ast.get_docstring(node):
            continue

        func_source = ast.get_source_segment(source, node) or ""
        docstring_text = get_docstring(node.name, func_source)

        body_start = node.body[0].lineno - 1
        indent = " " * (node.col_offset + 4)
        insertions.append((body_start, f'{indent}"""{docstring_text}"""\n'))
        print(f"  + {path}:{node.lineno} {node.name}()")

    if not insertions:
        return False

    for lineno, docstring_line in sorted(insertions, reverse=True):
        lines.insert(lineno, docstring_line.rstrip("\n"))

    with open(path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    return True


def main():
    changed = False
    for target in TARGETS:
        for root, _, files in os.walk(target):
            for fname in files:
                if not fname.endswith(".py") or fname == "__init__.py":
                    continue
                fpath = os.path.join(root, fname)
                print(f"Scanning {fpath}")
                if process_file(fpath):
                    changed = True

    if not changed:
        print("No missing docstrings found.")
        sys.exit(0)

    print("Done.")


if __name__ == "__main__":
    main()
