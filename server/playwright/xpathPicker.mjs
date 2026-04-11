import { ensureContext, getOrCreatePage, closeContext } from './browser.mjs'
import { emitLog } from '../log-bus.mjs'

let pickerActive = false
let pickerPage = null
let previewTimer = null
let latestPreview = null
let selectedElements = []

const PREVIEW_INTERVAL_MS = 400

export function isPickerActive() {
  return pickerActive
}

export function getPickerPreview() {
  return {
    active: pickerActive,
    ...(latestPreview ? { ts: latestPreview.ts, image: latestPreview.image } : {}),
  }
}

export function getSelectedElements() {
  return [...selectedElements]
}

export function clearSelectedElements() {
  selectedElements = []
}

function startPreviewCapture(page) {
  stopPreviewCapture()
  const tick = async () => {
    try {
      if (page.isClosed()) return
      const buf = await page.screenshot({
        type: 'jpeg',
        quality: 55,
        fullPage: false,
      })
      latestPreview = { image: buf.toString('base64'), ts: Date.now() }
    } catch {
      /* navigation or closed */
    }
  }
  void tick()
  previewTimer = setInterval(tick, PREVIEW_INTERVAL_MS)
}

function stopPreviewCapture() {
  if (previewTimer) {
    clearInterval(previewTimer)
    previewTimer = null
  }
  latestPreview = null
}

const PICKER_SCRIPT = `
(function() {
  if (window.__xpathPickerActive) return;
  window.__xpathPickerActive = true;

  const overlay = document.createElement('div');
  overlay.id = '__xpath-picker-overlay';
  overlay.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #5c2d91;background:rgba(92,45,145,0.15);transition:all 0.1s ease;display:none;';
  document.body.appendChild(overlay);

  const tooltip = document.createElement('div');
  tooltip.id = '__xpath-picker-tooltip';
  tooltip.style.cssText = 'position:fixed;z-index:2147483647;background:#1a1a21;color:#e8e8ee;padding:4px 8px;border-radius:4px;font-size:12px;font-family:monospace;max-width:400px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;box-shadow:0 2px 8px rgba(0,0,0,0.5);display:none;pointer-events:none;';
  document.body.appendChild(tooltip);

  function getXPath(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '//*[@id="' + el.id + '"]';

    const parts = [];
    while (el && el.nodeType === 1) {
      let idx = 1;
      let sibling = el.previousSibling;
      while (sibling) {
        if (sibling.nodeType === 1 && sibling.tagName === el.tagName) idx++;
        sibling = sibling.previousSibling;
      }
      const tagName = el.tagName.toLowerCase();
      const part = tagName + '[' + idx + ']';
      parts.unshift(part);
      el = el.parentNode;
    }
    return '/' + parts.join('/');
  }

  function getUniqueXPath(el) {
    if (!el || el.nodeType !== 1) return '';
    
    if (el.id) return '//*[@id="' + el.id + '"]';
    
    const text = (el.textContent || '').trim().slice(0, 50);
    const tagName = el.tagName.toLowerCase();
    
    if (text && text.length > 2 && text.length < 50) {
      const escaped = text.replace(/"/g, '\\"');
      const textXpath = '//' + tagName + '[contains(text(),"' + escaped + '")]';
      try {
        const result = document.evaluate(textXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
        if (result.singleNodeValue === el) return textXpath;
      } catch {}
    }
    
    const classList = Array.from(el.classList || []);
    if (classList.length > 0) {
      for (const cls of classList) {
        if (cls && !cls.includes(' ')) {
          const clsXpath = '//' + tagName + '[contains(@class,"' + cls + '")]';
          try {
            const result = document.evaluate(clsXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
            if (result.singleNodeValue === el) return clsXpath;
          } catch {}
        }
      }
    }
    
    const attrs = ['name', 'data-testid', 'aria-label', 'placeholder', 'type', 'role'];
    for (const attr of attrs) {
      const val = el.getAttribute(attr);
      if (val) {
        const attrXpath = '//' + tagName + '[@' + attr + '="' + val.replace(/"/g, '\\"') + '"]';
        try {
          const result = document.evaluate(attrXpath, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
          if (result.singleNodeValue === el) return attrXpath;
        } catch {}
      }
    }
    
    return getXPath(el);
  }

  let currentEl = null;

  document.addEventListener('mousemove', function(e) {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === tooltip) return;
    if (el === currentEl) return;
    currentEl = el;

    const rect = el.getBoundingClientRect();
    overlay.style.left = rect.left + 'px';
    overlay.style.top = rect.top + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';
    overlay.style.display = 'block';

    const xpath = getUniqueXPath(el);
    tooltip.textContent = xpath;
    tooltip.style.left = Math.min(e.clientX + 10, window.innerWidth - 420) + 'px';
    tooltip.style.top = Math.min(e.clientY + 20, window.innerHeight - 40) + 'px';
    tooltip.style.display = 'block';
  }, true);

  document.addEventListener('mouseout', function(e) {
    if (!e.relatedTarget || e.relatedTarget === document.documentElement) {
      overlay.style.display = 'none';
      tooltip.style.display = 'none';
      currentEl = null;
    }
  }, true);

  document.addEventListener('click', function(e) {
    e.preventDefault();
    e.stopPropagation();
    
    const el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === tooltip) return;

    const xpath = getUniqueXPath(el);
    const fullXpath = getXPath(el);
    const tagName = el.tagName.toLowerCase();
    const text = (el.textContent || '').trim().slice(0, 100);
    const id = el.id || null;
    const classes = Array.from(el.classList || []).join(' ') || null;

    window.__xpathPickerCallback({
      xpath,
      fullXpath,
      tagName,
      text,
      id,
      classes,
    });
  }, true);
})();
`;

export async function startPickerSession(url, opts = {}) {
  if (pickerActive) {
    throw new Error('Picker session already active')
  }

  const { headless = false } = opts
  
  try {
    await ensureContext({ headless, slowMo: 0 })
    const page = await getOrCreatePage()
    pickerPage = page
    pickerActive = true
    selectedElements = []

    await page.exposeFunction('__xpathPickerCallback', (data) => {
      selectedElements.push({
        ...data,
        ts: Date.now(),
      })
      emitLog('info', `XPath selected: ${data.xpath}`, {
        xpathPicker: true,
        element: data,
      })
    })

    emitLog('info', `XPath picker navigating to: ${url}`)
    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 60_000,
    })

    await page.evaluate(PICKER_SCRIPT)
    startPreviewCapture(page)

    emitLog('info', 'XPath picker ready — click elements to extract XPath')

    return { ok: true }
  } catch (e) {
    pickerActive = false
    pickerPage = null
    throw e
  }
}

export async function stopPickerSession() {
  stopPreviewCapture()
  pickerActive = false
  pickerPage = null
  
  try {
    await closeContext()
  } catch {
    /* ignore */
  }

  emitLog('info', 'XPath picker session closed')
  return { ok: true, elements: selectedElements }
}

export async function navigatePickerTo(url) {
  if (!pickerActive || !pickerPage) {
    throw new Error('No picker session active')
  }

  emitLog('info', `XPath picker navigating to: ${url}`)
  await pickerPage.goto(url, {
    waitUntil: 'domcontentloaded',
    timeout: 60_000,
  })

  await pickerPage.evaluate(PICKER_SCRIPT)

  return { ok: true }
}

export async function refreshPicker() {
  if (!pickerActive || !pickerPage) {
    throw new Error('No picker session active')
  }

  await pickerPage.reload({ waitUntil: 'domcontentloaded' })
  await pickerPage.evaluate(PICKER_SCRIPT)

  return { ok: true }
}
