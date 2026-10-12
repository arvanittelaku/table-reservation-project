"""/api/openapi.json: generated from the RPC registry, internally consistent.

Run: cd backend && python3 -m unittest core.tests.test_openapi
"""
import json
import re
import unittest

from django.test import Client

from ejb.rpc import REGISTRY


def refs(node, out):
    if isinstance(node, dict):
        if '$ref' in node:
            out.append(node['$ref'])
        for v in node.values():
            refs(v, out)
    elif isinstance(node, list):
        for v in node:
            refs(v, out)
    return out


class OpenApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        r = Client(HTTP_HOST='localhost').get('/api/openapi.json')
        assert r.status_code == 200, r.status_code
        cls.spec = json.loads(r.content)

    def test_top_level(self):
        s = self.spec
        self.assertEqual(s['openapi'], '3.1.0')
        for k in ('info', 'servers', 'paths', 'components'):
            self.assertIn(k, s)

    def test_every_rpc_documented_from_registry(self):
        paths = self.spec['paths']
        self.assertEqual(len(REGISTRY), len([p for p in paths if p.startswith('/rest/v1/rpc/')]))
        for name, spec in REGISTRY.items():
            op = paths[f'/rest/v1/rpc/{name}']['post']
            schema = op['requestBody']['content']['application/json']['schema']
            self.assertEqual(list(schema['properties']), [p[0] for p in spec.params], name)
            self.assertEqual(set(schema.get('required', [])), {p[0] for p in spec.params if not p[2]}, name)
            self.assertEqual(op['x-anon'], spec.anon, name)
            self.assertEqual({} in op['security'], spec.anon, name)
        book = paths['/rest/v1/rpc/book_lesson']['post']['requestBody']['content']['application/json']['schema']
        self.assertEqual(book['properties']['p_tutor'], {'type': 'string', 'format': 'uuid'})
        self.assertEqual(book['properties']['p_starts_at'], {'type': 'string', 'format': 'date-time'})
        self.assertEqual(book['properties']['p_duration'], {'type': 'integer'})
        langs = paths['/rest/v1/rpc/signup_wednesday']['post']['requestBody']['content']['application/json']['schema']
        self.assertEqual(langs['properties']['p_langs']['type'], 'array')

    def test_hand_written_areas(self):
        p = self.spec['paths']
        for path in ('/auth/v1/signup', '/auth/v1/token', '/auth/v1/user', '/auth/v1/logout', '/rest/v1/query',
                     '/storage/v1/object/{bucket}/{path}', '/storage/v1/object/sign/{bucket}',
                     '/realtime/v1/websocket', '/functions/v1/check-email-domain'):
            self.assertIn(path, p)
        self.assertIn('table.tables', self.spec['components']['schemas'])

    def test_refs_resolve_and_path_params_declared(self):
        for ref in refs(self.spec, []):
            node = self.spec
            for k in ref.lstrip('#/').split('/'):
                self.assertIn(k, node, ref)
                node = node[k]
        for path, ops in self.spec['paths'].items():
            wanted = set(re.findall(r'{(\w+)}', path))
            for method, op in ops.items():
                names = set()
                for prm in op.get('parameters', []):
                    if '$ref' in prm:
                        prm = self.spec['components']['parameters'][prm['$ref'].split('/')[-1]]
                    if prm['in'] == 'path':
                        names.add(prm['name'])
                self.assertEqual(names, wanted, f'{method} {path}')
        ids = [op['operationId'] for ops in self.spec['paths'].values() for op in ops.values()]
        self.assertEqual(len(ids), len(set(ids)))

    def test_docs_page(self):
        r = Client(HTTP_HOST='localhost').get('/api/docs')
        self.assertEqual(r.status_code, 200)
        self.assertIn(b'/api/openapi.json', r.content)


class GeneratedDocsInSync(unittest.TestCase):
    def test_generated_files_up_to_date(self):
        import importlib.util
        from pathlib import Path
        p = Path(__file__).resolve().parents[2] / 'dev' / 'gen_api_docs.py'
        spec = importlib.util.spec_from_file_location('gen_api_docs', p)
        gen = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(gen)
        for path, text in gen.outputs().items():
            self.assertTrue(path.exists(), f'{path.name} missing: run python3 dev/gen_api_docs.py')
            self.assertEqual(path.read_text(), text, f'{path.name} out of date: run python3 dev/gen_api_docs.py')


if __name__ == '__main__':
    unittest.main()
