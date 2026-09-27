"""
TEST TO SEE IF CUSTOM GATEWAY URLS ARE HANDLED CORRECTLY IN THE AI CHAT ROUTE
"""

from app.app import build_openai_compatible_url, normalize_gateway_url


def test_normalize_gateway_url_adds_scheme_and_strips_trailing_slash():
    assert normalize_gateway_url('localhost:1234/v1/') == 'http://localhost:1234/v1'
    assert normalize_gateway_url('https://example.com/base/') == 'https://example.com/base'


def test_build_openai_compatible_url_handles_common_gateway_shapes():
    assert build_openai_compatible_url('http://localhost:1234/v1/') == 'http://localhost:1234/v1/chat/completions'
    assert build_openai_compatible_url('http://localhost:8080/') == 'http://localhost:8080/v1/chat/completions'
    assert build_openai_compatible_url('https://api.example.com/chat/completions') == 'https://api.example.com/chat/completions'


def test_verify_external_api_allows_keyless_custom_gateway(monkeypatch):
    from app.app import app

    def fake_call_external_ai_api(provider, api_key, prompt, code_context='', gateway_url='', model_name=''):
        assert provider == 'Custom'
        assert api_key == ''
        assert gateway_url == 'http://localhost:1234/v1'
        return 'ok'

    monkeypatch.setattr('app.app.call_external_ai_api', fake_call_external_ai_api)

    client = app.test_client()
    resp = client.post('/api/verify-external-api', json={
        'provider': 'Custom',
        'apiKey': '',
        'gatewayUrl': 'http://localhost:1234/v1'
    })

    assert resp.status_code == 200
    assert resp.get_json()['status'] == 'success'


def test_custom_gateway_provider_label_is_recognized(monkeypatch):
    import app.app as app_module

    called = {}

    def fake_urlopen(req, timeout=30):
        called['url'] = req.full_url
        class Dummy:
            def __enter__(self):
                return self
            def __exit__(self, exc_type, exc, tb):
                return False
            def read(self):
                return b'{"choices":[{"message":{"content":"gateway-ok"}}]}'
        return Dummy()

    monkeypatch.setattr(app_module.urllib.request, 'urlopen', fake_urlopen)
    result = app_module.call_external_ai_api('Custom API Gateway', '', 'hello', gateway_url='http://localhost:1234/v1', model_name='llama3')

    assert result == 'gateway-ok'
    assert called['url'].startswith('http://localhost:1234/v1/chat/completions')


def test_ai_chat_routes_keyless_custom_gateway_to_external_api(monkeypatch):
    import app.app as app_module

    called = {}

    def fake_external(provider, api_key, prompt, code_context='', gateway_url='', model_name=''):
        called['provider'] = provider
        called['api_key'] = api_key
        called['gateway_url'] = gateway_url
        called['model_name'] = model_name
        return 'custom-ok'

    def fail_local(*args, **kwargs):
        raise AssertionError('Local model path should not be used for a custom gateway request.')

    monkeypatch.setattr(app_module, 'call_external_ai_api', fake_external)
    monkeypatch.setattr(app_module, 'call_local_ai_model', fail_local)

    client = app_module.app.test_client()
    resp = client.post('/api/ai-chat', json={
        'prompt': 'hello',
        'provider': 'Custom',
        'apiKey': '',
        'modelPath': '',
        'gatewayUrl': 'http://localhost:1234/v1',
        'modelName': 'llama3'
    })

    assert resp.status_code == 200
    assert resp.get_json()['reply'] == 'custom-ok'
    assert called['provider'] == 'Custom'
    assert called['gateway_url'] == 'http://localhost:1234/v1'
