// Part of the APK.audio project — http://APK.audio — made by Anthony Kuzub
// MIT Licence. Free, for everyone, for ever. Full text in LICENSE at the root.

export class BlockBridge {
  constructor(options = {}) {
    this.editorName = options.name || 'Floor Plan Editor';
    this.blockType = options.type || 'floorplan';
    this.onBlockLoaded = options.onBlockLoaded || (() => {});
    this.onBlockChanged = options.onBlockChanged || (() => {});
    this.block = options.defaultBlock || null;
    this.meta = options.meta || {};
    this.isEmbedded = typeof window !== 'undefined' && window.parent && window.parent !== window;

    this.init();
  }

  init() {
    if (typeof window === 'undefined') return;
    this.inheritParentTheme();

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (!msg || typeof msg !== 'object') return;

      if (msg.type === 'APK_LOAD_BLOCK' || msg.type === 'LOAD_BLOCK') {
        this.loadBlock(msg.block, msg.meta || {});
      } else if (msg.type === 'APK_REQUEST_BLOCK') {
        this.saveBlock();
      }
    });

    if (this.isEmbedded) {
      window.parent.postMessage({ type: 'APK_EDITOR_READY', editor: this.editorName, blockType: this.blockType }, '*');
    }
  }

  loadBlock(block, meta = {}) {
    this.block = block;
    this.meta = { ...this.meta, ...meta };
    const tag = document.getElementById('block-tag');
    if (tag) {
      tag.textContent = meta.title || meta.name || `${this.blockType.toUpperCase()} BLOCK`;
    }
    this.onBlockLoaded(this.block, this.meta);
  }

  notifyChanged() {
    this.onBlockChanged(this.block, this.meta);
    if (this.isEmbedded) {
      window.parent.postMessage({ type: 'APK_BLOCK_CHANGED', block: this.block, meta: this.meta }, '*');
    }
  }

  saveBlock(customBlock = null, customMeta = {}) {
    const outBlock = customBlock || this.block;
    const outMeta = { ...this.meta, ...customMeta };

    if (this.isEmbedded) {
      window.parent.postMessage({
        type: 'APK_SAVE_BLOCK',
        editor: this.editorName,
        blockType: this.blockType,
        block: outBlock,
        meta: outMeta,
      }, '*');
    }

    const blob = new Blob([JSON.stringify(outBlock, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${outMeta.filename || 'floor_plan'}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  close() {
    if (this.isEmbedded) {
      window.parent.postMessage({ type: 'APK_CLOSE_BLOCK', editor: this.editorName }, '*');
    } else {
      window.close();
    }
  }

  async fetchDiscoveredProject() {
    const urls = [
      '/discovered/all_discovered.json',
      '/api/discovered',
      '/all_discovered.json',
    ];
    for (const url of urls) {
      try {
        const res = await fetch(url);
        if (res.ok) {
          return await res.json();
        }
      } catch (_) {}
    }
    return null;
  }

  inheritParentTheme() {
    try {
      if (this.isEmbedded && window.parent && window.parent.document) {
        const pDoc = window.parent.document.documentElement;
        const pStyle = window.parent.getComputedStyle(pDoc);
        const tokens = [
          '--accent', '--bg-dark', '--bg-panel', '--bg-surface',
          '--bg-window', '--border-color', '--border-light',
          '--text-main', '--text-muted', '--text-subtle',
          '--apk-accent', '--apk-accent-hover', '--apk-accent-tint',
          '--apk-state-good', '--apk-state-dead', '--apk-state-kinda'
        ];
        for (const t of tokens) {
          const val = pStyle.getPropertyValue(t);
          if (val && val.trim()) {
            document.documentElement.style.setProperty(t, val.trim());
          }
        }
      }
    } catch (_) {}
  }

}
