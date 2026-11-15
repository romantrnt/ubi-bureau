import importlib.util
from pathlib import Path
import unittest
spec = importlib.util.spec_from_file_location('native_policy', Path(__file__).resolve().parents[1]/'bin/native_policy.py')
policy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(policy)

class NativePolicy(unittest.TestCase):
    def test_exact_codex_uuid(self):
        self.assertTrue(policy.is_codex_uri('codex://threads/00000000-0000-0000-0000-000000000001'))
        for suffix in ['00000000----------------------------', 'not-a-uuid', '00000000-0000-0000-0000-000000000001?command=x', '00000000-0000-0000-0000-000000000001/']:
            self.assertFalse(policy.is_codex_uri('codex://threads/'+suffix))
    def test_navigation(self):
        base = 'http://127.0.0.1:4547'
        for uri in ['about:blank', base+'/', base+'/?native=1']:
            self.assertTrue(policy.is_internal_uri(uri, base))
        for uri in ['file:///etc/passwd', 'javascript:alert(1)', 'https://example.org', base+'.evil/', 'http://127.0.0.1:4548/', 'http://u@127.0.0.1:4547/', 'http://[']:
            self.assertFalse(policy.is_internal_uri(uri, base))
