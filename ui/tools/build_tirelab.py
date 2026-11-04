"""Build static/tirelab.html and static/js/tirelab-core.js from the friend's tire-tuning-workbench.html.

    python -I ui/tools/build_tirelab.py [path/to/tire-tuning-workbench.html]

The source stays unmodified (a copy lives in static/vendor/). The page is wrapped in a document whose shim provides
the `window.openai` widget-state hooks the tool already uses, so TireTune can hand it the vehicle being tuned and
receive its edits back (TireTuneBridge in app.js).
"""
import re
import shutil
import sys
from pathlib import Path

UI = Path(__file__).resolve().parents[1]
VENDOR = UI / 'static' / 'vendor' / 'tire-tuning-workbench.source.html'

SHIM = r'''<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Tire Lab</title>
<style>html,body{margin:0;background:#0d1420;color:#e2eaf5}body{padding:14px 18px}</style>
<script>
// Widget-state bridge: the tool reads window.openai.widgetState on start and calls setWidgetState on every edit.
(function () {
  var init = null;
  try { init = parent.TireTuneBridge && parent.TireTuneBridge.initialState(); } catch (e) {}
  window.openai = {
    widgetState: init ? { privateContent: { state: { version: 2, data: init } } } : null,
    setWidgetState: function (s) {
      try { parent.TireTuneBridge.fromTireLab(s.privateContent.state.data); } catch (e) {}
      return Promise.resolve();
    }
  };
})();
</script>
</head>
<body>
'''


def main():
    src = Path(sys.argv[1]) if len(sys.argv) > 1 else VENDOR
    text = src.read_text(encoding='utf-8')
    if src.resolve() != VENDOR.resolve():
        VENDOR.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, VENDOR)
    (UI / 'static' / 'tirelab.html').write_text(SHIM + text + '\n</body>\n</html>\n', encoding='utf-8')
    m = re.search(r'<script id="tire-lab-core">\s*(.*?)</script>', text, re.S)
    if not m:
        sys.exit('tire-lab-core script not found')
    core = '// Tire Lab physics core (MF5.2-style evaluator) from the friend\'s tire-tuning-workbench.html, unmodified.\n' + m.group(1)
    (UI / 'static' / 'js' / 'tirelab-core.js').write_text(core, encoding='utf-8')
    print('built static/tirelab.html and static/js/tirelab-core.js from', src)


if __name__ == '__main__':
    main()
