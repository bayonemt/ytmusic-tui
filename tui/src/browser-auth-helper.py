#!/usr/bin/env python3
"""
Abre o YouTube Music com camoufox (Firefox anti-detecção) e salva os cookies
de autenticação no arquivo passado como argumento quando o usuário faz login.
"""
import json
import sys
import time

output_file = sys.argv[1] if len(sys.argv) > 1 else '/tmp/ytm-cookies.json'
YTM = 'https://music.youtube.com'
RELEVANT = [
    'SAPISID', '__Secure-3PAPISID', 'SID', 'HSID', 'SSID',
    '__Secure-1PSID', '__Secure-3PSID', 'LOGIN_INFO', 'VISITOR_INFO1_LIVE',
]

try:
    from camoufox.sync_api import Camoufox
except ImportError:
    print('camoufox não instalado. Execute: pip install camoufox && python -m camoufox fetch', file=sys.stderr)
    sys.exit(2)

with Camoufox(headless=False) as browser:
    page = browser.new_page()
    page.goto(YTM)

    deadline = time.time() + 300  # 5 min
    while time.time() < deadline:
        try:
            if not browser.is_connected():
                sys.exit(1)
            # Usa page.context.cookies() — browser.cookies() não existe no camoufox
            all_cookies = page.context.cookies()
            # Pega o SAPISID de .youtube.com (usado para requisições ao YTM)
            sapisid = next(
                (c for c in all_cookies
                 if c['name'] in ('SAPISID', '__Secure-3PAPISID')
                 and 'youtube.com' in c.get('domain', '')),
                None,
            )
            if sapisid:
                # Navega para YTM se não estiver lá, para gerar cookies específicos
                try:
                    if 'music.youtube.com' not in page.url:
                        page.goto(YTM, wait_until='domcontentloaded', timeout=10000)
                        time.sleep(2)
                        all_cookies = page.context.cookies()
                except Exception:
                    pass

                # Cookie header com cookies do domínio .youtube.com
                ytm_cookies = [c for c in all_cookies
                               if c['name'] in RELEVANT and 'youtube.com' in c.get('domain', '')]
                header = '; '.join(f"{c['name']}={c['value']}" for c in ytm_cookies)
                with open(output_file, 'w') as f:
                    json.dump({
                        'cookieHeader': header,
                        'sapisid': sapisid['value'],
                        'savedAt': int(time.time() * 1000),
                    }, f)
                sys.exit(0)
        except Exception:
            pass
        time.sleep(1)

sys.exit(1)
