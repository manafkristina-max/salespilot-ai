#!/usr/bin/env python3
"""Проверка, что в репозиторий не попали ключи, пароли и файлы .env.

    python3 scripts/check_secrets.py            # текущие файлы + вся история git
    python3 scripts/check_secrets.py --staged   # только то, что готовится к коммиту

Код выхода 1, если что-то найдено. Каталог vendor/harvey (submodule) — отдельный
репозиторий и не проверяется.
"""

import re
import subprocess
import sys

PATTERNS = {
    "Anthropic API key": r"sk-ant-[A-Za-z0-9_\-]{20,}",
    "OpenAI-style key": r"\bsk-(?:proj-)?[A-Za-z0-9]{32,}",
    "GitHub token": r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,}",
    "AWS access key": r"\bAKIA[0-9A-Z]{16}\b",
    "Slack token": r"\bxox[baprs]-[A-Za-z0-9-]{10,}",
    "Google API key": r"\bAIza[0-9A-Za-z_\-]{35}\b",
    "Private key": r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----",
    # A non-empty value on the same line; diff lines in history start with "+".
    "Password in env": r"(?im)^[+ ]?[ \t]*(?:SMTP_PASSWORD|PASSWORD|SECRET|API_KEY|ANTHROPIC_API_KEY)[ \t]*=[ \t]*[^\s#]{4,}",
}
FORBIDDEN_FILES = re.compile(r"(^|/)\.env(\.[^/]*)?$")
ALLOWED_FILES = {".env.example"}


def git(*args: str) -> str:
    return subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout


def scan(text: str, where: str, found: list) -> None:
    for name, rx in PATTERNS.items():
        for m in re.finditer(rx, text):
            found.append(f"{where}: {name}: {m.group(0)[:12]}…")


def main() -> int:
    staged = "--staged" in sys.argv
    found: list[str] = []
    files = git("diff", "--cached", "--name-only") if staged else git("ls-files")
    for path in filter(None, files.splitlines()):
        if path.startswith("vendor/"):
            continue
        if FORBIDDEN_FILES.search(path) and path.split("/")[-1] not in ALLOWED_FILES:
            found.append(f"{path}: файл окружения не должен попадать в git")
        try:
            text = git("show", f":{path}") if staged else open(path, encoding="utf-8", errors="ignore").read()
        except (OSError, subprocess.CalledProcessError):
            continue
        scan(text, path, found)
    if not staged:
        history = git("log", "--all", "-p", "--no-color", "--", ".", ":(exclude)vendor")
        scan(history, "история git", found)
        for path in git("log", "--all", "--name-only", "--pretty=format:").splitlines():
            if FORBIDDEN_FILES.search(path) and path.split("/")[-1] not in ALLOWED_FILES:
                found.append(f"история git: {path} когда-то был закоммичен")
    if found:
        print("✗ Найдены возможные секреты:")
        for f in sorted(set(found)):
            print("  -", f)
        return 1
    print("✓ Секретов и файлов .env не найдено" + (" в подготовленных изменениях" if staged else
                                                    " (файлы и вся история git)"))
    return 0


if __name__ == "__main__":
    sys.exit(main())
