#!/usr/bin/env python3
"""Package the WordPress plugin so every salon site can self-update.

Reads the version straight from the plugin header and writes:
  apps/web/public/downloads/lumio-booking.zip   -> the installable plugin
  apps/web/public/wp-update/lumio-booking.json  -> the manifest WordPress polls

Run this after ANY change to wordpress-plugin/lumio-booking, then deploy the web
app. Every site picks the new build up on its own within a few hours.
"""
import datetime
import json
import os
import re
import zipfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, 'wordpress-plugin', 'lumio-booking')
ZIP = os.path.join(ROOT, 'apps', 'web', 'public', 'downloads', 'lumio-booking.zip')
MAN = os.path.join(ROOT, 'apps', 'web', 'public', 'wp-update', 'lumio-booking.json')
# A copy next to the plugin source, named the way the previous releases were, for
# the one-off manual upload to a site that is still on an old build.
PLUGIN_DIR = os.path.join(ROOT, 'wordpress-plugin')

head = open(os.path.join(SRC, 'lumio-booking.php'), encoding='utf-8').read()[:4000]


def hdr(name, default=''):
    m = re.search(r'^\s*\*\s*' + re.escape(name) + r':\s*(.+?)\s*$', head, re.M)
    return m.group(1).strip() if m else default


version = hdr('Version')
if not version:
    raise SystemExit('Could not read Version from the plugin header')

os.makedirs(os.path.dirname(ZIP), exist_ok=True)
os.makedirs(os.path.dirname(MAN), exist_ok=True)

# The zip must contain a top-level lumio-booking/ folder for WordPress.
with zipfile.ZipFile(ZIP, 'w', zipfile.ZIP_DEFLATED) as z:
    for folder, _dirs, files in os.walk(SRC):
        for name in sorted(files):
            full = os.path.join(folder, name)
            rel = os.path.relpath(full, os.path.dirname(SRC))
            z.write(full, rel.replace(os.sep, '/'))

manifest = {
    'name': 'Lumio Booking',
    'slug': 'lumio-booking',
    'version': version,
    'requires': hdr('Requires at least', '6.0'),
    'requires_php': hdr('Requires PHP', '7.4'),
    'tested': '6.8',
    'homepage': 'https://lumiobooking.com',
    # Version in the query string busts any CDN cache on the fixed filename.
    'download_url': 'https://lumiobooking.com/downloads/lumio-booking.zip?v=' + version,
    'last_updated': datetime.date.today().isoformat(),
}
with open(MAN, 'w', encoding='utf-8') as f:
    json.dump(manifest, f, indent=2)
    f.write('\n')

import shutil
UPLOAD = os.path.join(PLUGIN_DIR, 'lumio-booking-' + version + '.zip')
shutil.copyfile(ZIP, UPLOAD)

print('packaged lumio-booking', version)
print(' upload  ', UPLOAD, str(os.path.getsize(UPLOAD)) + ' bytes')
print(' server  ', ZIP)
print(' manifest', MAN)
