"""Small, testable navigation allowlist; never accepts commands or arbitrary URLs."""
import re
from urllib.parse import urlsplit

CODEX_URI = re.compile(r'codex://threads/[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}')

def is_codex_uri(uri):
    return bool(CODEX_URI.fullmatch(uri))

def is_internal_uri(uri, base):
    if uri == 'about:blank':
        return True
    if not base:
        return False
    try:
        parsed, expected = urlsplit(uri), urlsplit(base)
        return (parsed.scheme == 'http' and parsed.hostname == '127.0.0.1'
                and parsed.netloc == expected.netloc and not parsed.username)
    except ValueError:
        return False
