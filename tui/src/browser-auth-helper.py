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
            # Busca todos os cookies (sem filtro de URL) — SAPISID é de .google.com,
            # não de music.youtube.com, então filtrar por URL o excluiria
            all_cookies = browser.cookies()
            sapisid = next(
                (c for c in all_cookies if c['name'] in ('SAPISID', '__Secure-3PAPISID')),
                None,
            )
            if sapisid:
                # Navega para YTM para garantir que os cookies específicos do YTM sejam gerados
                try:
                    current_url = page.url
                    if 'music.youtube.com' not in current_url:
                        page.goto(YTM, wait_until='domcontentloaded', timeout=10000)
                        time.sleep(2)
                        all_cookies = browser.cookies()
                except Exception:
                    pass

                header = '; '.join(
                    f"{c['name']}={c['value']}"
                    for c in all_cookies if c['name'] in RELEVANT
                )
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
