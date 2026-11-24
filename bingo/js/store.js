/*
 * 保存と画面間同期
 *  - 集計ツールの全状態（秘匿情報を含む）は localStorage の STATE キーに保存
 *  - 発表ツールには publicView（公開情報のみ）と表示設定だけを PUBLIC キーで渡す
 *  - 同期経路: BroadcastChannel / storage イベント / window.postMessage（いずれか届けばよい）
 */
(function (root) {
  'use strict';

  const KEYS = {
    state: 'robberBingo.state.v1',
    undo: 'robberBingo.undo.v1',
    ui: 'robberBingo.ui.v1',
    public: 'robberBingo.public.v1',
  };
  const CHANNEL = 'robberBingo.v1';
  const UNDO_LIMIT = 40;

  let channel = null;
  try {
    channel = new BroadcastChannel(CHANNEL);
  } catch (e) {
    channel = null;
  }

  function read(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      if (value === null || value === undefined) localStorage.removeItem(key);
      else localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      console.warn('保存に失敗しました', e);
      return false;
    }
  }

  const displayWindows = new Set();

  const Store = {
    KEYS,
    loadState: () => read(KEYS.state, null),
    saveState: (s) => write(KEYS.state, s),
    loadUndo: () => read(KEYS.undo, []),
    saveUndo: (stack) => write(KEYS.undo, stack.slice(-UNDO_LIMIT)),
    loadUi: (fallback) => Object.assign({}, fallback, read(KEYS.ui, {})),
    saveUi: (ui) => write(KEYS.ui, ui),
    loadPublic: () => read(KEYS.public, null),
    UNDO_LIMIT,

    /** 発表ツールへ公開情報を送る */
    publish(payload) {
      const msg = Object.assign({ sentAt: Date.now() }, payload);
      write(KEYS.public, msg);
      if (channel) channel.postMessage(msg);
      for (const w of displayWindows) {
        try {
          if (w.closed) displayWindows.delete(w);
          else w.postMessage({ robberBingo: msg }, '*');
        } catch (e) {
          displayWindows.delete(w);
        }
      }
    },

    registerDisplayWindow(w) {
      if (w) displayWindows.add(w);
    },

    /** 発表ツール側：更新を購読する */
    subscribe(handler) {
      if (channel) channel.onmessage = (ev) => handler(ev.data);
      root.addEventListener('storage', (ev) => {
        if (ev.key === KEYS.public && ev.newValue) {
          try {
            handler(JSON.parse(ev.newValue));
          } catch (e) {
            /* ignore */
          }
        }
      });
      root.addEventListener('message', (ev) => {
        if (ev.data && ev.data.robberBingo) handler(ev.data.robberBingo);
      });
    },
  };

  root.RobberBingoStore = Store;
})(typeof self !== 'undefined' ? self : this);
