import copy
import json
from pathlib import Path
import subprocess
import tempfile
import unittest

from android_profile import build_profile, solo_catalog, write_private


class AndroidProfile(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with tempfile.TemporaryDirectory() as d:
            cert = Path(d) / 'server.crt'
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-days', '1', '-keyout', str(Path(d) / 'key.pem'), '-out', str(cert),
                            '-subj', '/CN=vpn.example.com', '-addext', 'subjectAltName=DNS:vpn.example.com'],
                           check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            cls.cert = cert.read_text()

    def setUp(self):
        self.state = {'public_ip': '192.0.2.8', 'sni': 'vpn.example.com',
                      'hy_password': 'client-password', 'hy_obfs': 'client-obfs',
                      'uuid': 'ee2fc922-c08a-4340-b530-e96e38f6d013',
                      'public_key': 'A' * 43, 'short_id': '0123456789abcdef',
                      'private_key': 'NEVER-EXPORT-REALITY-PRIVATE',
                      'postgres_password': 'NEVER-EXPORT-DATABASE',
                      'qdrant_key': 'NEVER-EXPORT-QDRANT', 'auth_secret': 'NEVER-EXPORT-AUTH'}
        self.catalog = solo_catalog(self.state, self.cert)

    def test_server_secrets_never_reach_client(self):
        data = json.dumps(build_profile(self.catalog))
        for key in ('private_key', 'postgres_password', 'qdrant_key', 'auth_secret'):
            self.assertNotIn(self.state[key], data)
            self.assertNotIn(key, data)

    def test_tls_identity_is_kept_with_inline_certificate(self):
        config = build_profile(self.catalog)
        hy = next(o for o in config['outbounds'] if o['type'] == 'hysteria2')
        self.assertEqual(hy['tls']['certificate'], self.cert)
        self.assertFalse(hy['tls']['insecure'])
        self.assertEqual(hy['tls']['server_name'], 'vpn.example.com')

    def test_no_direct_fallback_and_dns_uses_selected_tunnel(self):
        config = build_profile(self.catalog)
        self.assertNotIn('direct', [o['type'] for o in config['outbounds']])
        self.assertEqual(config['dns']['servers'][0]['detour'], config['route']['final'])
        self.assertEqual(config['route']['rules'], [{'port': 53, 'action': 'hijack-dns'}])

    def test_ipv6_is_captured_even_with_ipv4_server(self):
        tun = build_profile(self.catalog)['inbounds'][0]
        self.assertTrue(any(':' in a for a in tun['address']))
        self.assertTrue(tun['auto_route'])
        self.assertEqual(tun['mtu'], 1280)

    def test_protocol_listener_collision_rejected(self):
        native = copy.deepcopy(self.catalog['endpoints'][0])
        native.update(id='native', kind='hy2-native')
        native.pop('obfs_password')
        self.catalog['endpoints'].append(native)
        with self.assertRaisesRegex(ValueError, 'listener'):
            build_profile(self.catalog)
        native['port'] = 8443
        self.assertEqual(len(build_profile(self.catalog)['outbounds']), 5)

    def test_insecure_options_and_unknown_fields_fail_closed(self):
        for key, value in [('insecure', True), ('private_key', 'secret'), ('detour', 'direct')]:
            catalog = copy.deepcopy(self.catalog)
            catalog['endpoints'][0][key] = value
            with self.assertRaises(ValueError):
                build_profile(catalog)

    def test_required_identity_rejected_if_invalid(self):
        for key, value in [('server_ip', 'https://vpn.example.com'), ('port', True),
                           ('port', 65536), ('server_name', 'vpn.example.com:443'),
                           ('uuid', 'not-a-uuid'), ('public_key', 'bad'), ('short_id', '123')]:
            catalog = copy.deepcopy(self.catalog)
            catalog['endpoints'][1][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                build_profile(catalog)

    def test_duplicate_and_reserved_tags_rejected(self):
        for name in ('AUTO', 'XFREEDOM', 'hy2-obfs'):
            catalog = copy.deepcopy(self.catalog)
            catalog['endpoints'][1]['id'] = name
            with self.assertRaises(ValueError):
                build_profile(catalog)

    def test_input_not_mutated(self):
        before = copy.deepcopy(self.catalog)
        build_profile(self.catalog)
        self.assertEqual(self.catalog, before)

    def test_probe_cannot_use_cleartext_or_embedded_credentials(self):
        for url in ('http://example.com', 'https://user:pass@example.com', 'https:///path', 'https://example.com/#token'):
            with self.assertRaises(ValueError):
                build_profile(self.catalog, url)

    def test_output_replacement_has_private_permissions(self):
        with tempfile.TemporaryDirectory() as d:
            output = Path(d) / 'profile.json'
            output.write_text('old')
            output.chmod(0o644)
            write_private(output, build_profile(self.catalog))
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            self.assertEqual(json.loads(output.read_text())['route']['final'], 'XFREEDOM')

    def test_all_four_transport_modes(self):
        native = copy.deepcopy(self.catalog['endpoints'][0])
        native.update(id='native', kind='hy2-native', port=8443)
        native.pop('obfs_password')
        tuic = {k: v for k, v in self.catalog['endpoints'][0].items() if k != 'obfs_password'}
        tuic.update(id='tuic', kind='tuic', port=9443, uuid=self.state['uuid'])
        self.catalog['endpoints'] += [tuic, native]
        config = build_profile(self.catalog)
        self.assertEqual(config['outbounds'][1]['outbounds'], ['native', 'tuic', 'hy2-obfs', 'reality'])
        self.assertNotIn('obfs', config['outbounds'][2])
        self.assertEqual(config['outbounds'][3]['heartbeat'], '10s')


if __name__ == '__main__':
    unittest.main()
