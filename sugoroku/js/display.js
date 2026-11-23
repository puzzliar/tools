/* 制限すごろく 発表ツール（プロジェクター用）
 * 集計ツールから送られる公開情報（publicView）だけを表示する。 */
(function () {
  'use strict';

  const Store = window.LimitedDiceStore;
  const $stage = document.getElementById('stage');
  let payload = Store.loadPublic();
  let lastKey = '';

  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function money(n) {
    return Number(n).toLocaleString('ja-JP');
  }
  function signed(n) {
    return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toLocaleString('ja-JP');
  }
  function fmtTime(ms) {
    ms = Math.max(0, ms);
    const t = Math.ceil(ms / 1000);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }
  function remaining() {
    const t = payload && payload.display && payload.display.timer;
    if (!t) return 0;
    return t.endsAt ? t.endsAt - Date.now() : t.remainingMs;
  }
  function timerRunning() {
    const t = payload && payload.display && payload.display.timer;
    return !!(t && t.endsAt && t.endsAt > Date.now());
  }

  // ---------- scenes ----------

  function header(v, title) {
    return `<header class="hd">
      <div class="hd-l"><span class="mark">制限すごろく</span>${title ? `<span class="hd-title">${title}</span>` : ''}</div>
      <div class="hd-r">
        <span class="mini-timer ${timerRunning() ? 'on' : ''}" data-timer></span>
        ${v ? `<span class="turn">TURN <b>${Math.min(v.turn, v.totalTurns)}</b><small> / ${v.totalTurns}</small></span>` : ''}
      </div>
    </header>`;
  }

  function sceneTitle(v) {
    return `<section class="scene title">
      <div class="title-inner">
        <div class="kicker">LIAR GAME — LIMITED DICE</div>
        <h1>制限すごろく</h1>
        <div class="title-sub">${
          !v ? 'まもなく開始' : v.phase === 'finished' ? 'GAME OVER' : `TURN ${v.turn} / ${v.totalTurns}`
        }</div>
      </div>
    </section>`;
  }

  function sceneCapacity(v) {
    const caps = v.baseCaps;
    return `${header(v, '今ターンの定員')}
    <section class="scene">
      ${
        caps
          ? `<div class="num-grid">${caps
              .map(
                (c, i) => `<div class="num-card reveal-in" style="--d:${i * 90}ms">
                  <div class="num">${i + 1}</div>
                  <div class="cap-label">定員</div>
                  <div class="cap-val">${c}<small>人</small></div>
                </div>`
              )
              .join('')}</div>
            <p class="foot">定員を超えた数字は <b class="red">全滅</b>（移動0）。枠数変更カードで定員+1。</p>`
          : `<div class="center-msg">定員シャッフル中…</div>`
      }
      ${
        v.swaps && v.swaps.length
          ? `<div class="banner">順位入れ替えカード宣言：${v.swaps.map((s) => `<b>${esc(s.byName)}</b>`).join('、')}</div>`
          : ''
      }
    </section>`;
  }

  function sceneResult(v) {
    const r = v.result;
    if (!r) return `${header(v, '開票結果')}<section class="scene"><div class="center-msg">開票前です</div></section>`;
    return `${header(v, `TURN ${r.turn} 開票結果`)}
    <section class="scene">
      <div class="num-grid">${r.numbers
        .map((n, i) => {
          const status = n.votes === 0 ? 'none' : n.ok ? 'ok' : 'ng';
          return `<div class="num-card result ${status} reveal-in" style="--d:${i * 140}ms">
            <div class="num">${n.number}</div>
            <div class="vs"><span class="votes">${n.votes}</span><span class="slash">/</span><span class="capv">${n.finalCap}</span></div>
            <div class="vs-label">投票 / 定員${n.finalCap !== n.base ? `<small>（基礎${n.base} +${n.finalCap - n.base}）</small>` : ''}</div>
            <div class="stamp">${status === 'none' ? '—' : status === 'ok' ? '成立' : '全滅'}</div>
          </div>`;
        })
        .join('')}</div>
      <div class="laps reveal-in" style="--d:900ms">
        ${
          r.laps.length
            ? r.laps
                .map((l) => `<div class="lap"><span class="tok">${esc(l.piece)}</span><span>${l.lap}周目 達成</span><b>+${money(l.bonus)} L$</b></div>`)
                .join('')
            : '<div class="muted">このターンの周回者なし</div>'
        }
        ${r.stealEligibleCount && !r.steals ? `<div class="lap alert">％奪取権 発生：${r.stealEligibleCount}名</div>` : ''}
      </div>
    </section>`;
  }

  function boardCells(B) {
    const side = Math.ceil(B / 4) + 1;
    const cells = [];
    for (let c = 0; c < side; c++) cells.push([0, c]);
    for (let r = 1; r < side; r++) cells.push([r, side - 1]);
    for (let c = side - 2; c >= 0; c--) cells.push([side - 1, c]);
    for (let r = side - 2; r >= 1; r--) cells.push([r, 0]);
    return { side, cells: cells.slice(0, B) };
  }

  function sceneBoard(v) {
    const B = v.boardSize;
    const { side, cells } = boardCells(B);
    const bySquare = {};
    for (const p of v.board) (bySquare[p.square] = bySquare[p.square] || []).push(p);
    const cellHtml = cells
      .map(([r, c], sq) => {
        const ps = (bySquare[sq] || []).sort((a, b) => b.lap - a.lap || a.piece.localeCompare(b.piece));
        return `<div class="cell ${sq === 0 ? 'start' : ''}" style="grid-row:${r + 1};grid-column:${c + 1}">
          <div class="sq">${sq === 0 ? 'START' : sq}</div>
          <div class="toks">${ps.map((p) => `<span class="tok" title="${p.lap}周">${esc(p.piece)}${p.lap ? `<sup>${p.lap}</sup>` : ''}</span>`).join('')}</div>
        </div>`;
      })
      .join('');
    const standings = v.board
      .map(
        (p) =>
          `<li><span class="rk">${p.rank}</span><span class="tok">${esc(p.piece)}${p.lap ? `<sup>${p.lap}</sup>` : ''}</span><span class="pos">${p.square === 0 ? 'START' : p.square + 'マス'}</span></li>`
      )
      .join('');
    return `${header(v, '盤面')}
    <section class="scene board-scene">
      <div class="board" style="--side:${side}">
        ${cellHtml}
        <div class="board-center" style="grid-row:2 / ${side};grid-column:2 / ${side}">
          <div class="label">順位（同一位置は同順位）</div>
          <ol class="standings" style="grid-template-rows:repeat(${Math.ceil(v.board.length / 3)}, auto)">${standings}</ol>
          <div class="legend">駒の右上の数字 = 周回数 ／ 時計回り</div>
        </div>
      </div>
    </section>`;
  }

  function sceneSteal(v) {
    const r = v.result;
    let body;
    if (!r || (r.steals && r.steals.length === 0 && !r.stealEligibleCount)) body = '<div class="center-msg">％奪取の宣言はありません</div>';
    else if (!r.steals) body = `<div class="center-msg pulse">％奪取 宣言受付中<small>権利者 ${r.stealEligibleCount} 名</small></div>`;
    else if (!r.steals.length) body = '<div class="center-msg">％奪取の宣言はありませんでした</div>';
    else
      body = `<div class="steals">${r.steals
        .map(
          (s, i) => `<div class="steal ${s.success ? 'ok' : 'ng'} reveal-in" style="--d:${i * 600}ms">
            <div class="who">${esc(s.attackerName)}</div>
            <div class="decl">No.<b>${esc(s.number)}</b> × 駒<b>${esc(s.piece)}</b></div>
            <div class="res reveal-in" style="--d:${i * 600 + 900}ms">${s.success ? `成功<small>${money(s.amount)} L$ 奪取</small>` : '不成立'}</div>
          </div>`
        )
        .join('')}</div>`;
    return `${header(v, r ? `TURN ${r.turn} ％奪取` : '％奪取')}<section class="scene">${body}</section>`;
  }

  function sceneFinal(v) {
    const f = v.final;
    if (!f) return `${header(v, '最終結果')}<section class="scene"><div class="center-msg">ゲーム終了後に表示されます</div></section>`;
    const n = f.ranking.length;
    const reveal = Math.max(0, Math.min(n, (payload.display && payload.display.reveal) || 0));
    const rows = f.ranking
      .map((r, i) => {
        const shown = i >= n - reveal;
        return `<tr class="${shown ? 'shown' : 'hidden'} ${shown && r.rank === 1 ? 'champion' : ''}">
          <td class="rk">${shown ? r.rank : '?'}</td>
          <td class="nm">${shown ? esc(r.name) : '？？？'}</td>
          <td class="id">${shown ? `No.${r.number}・駒${esc(r.piece)}` : ''}</td>
          <td class="sc ${shown ? (r.score >= 0 ? 'pos' : 'neg') : ''}">${shown ? `${signed(r.score)}<small> L$</small>` : ''}</td>
        </tr>`;
      })
      .join('');
    const champ = reveal === n ? f.ranking.filter((r) => r.rank === 1) : [];
    return `${header(v, '最終結果')}
    <section class="scene final" style="--rows:${n}">
      ${champ.length ? `<div class="winner reveal-in">WINNER<b>${champ.map((c) => esc(c.name)).join('・')}</b></div>` : ''}
      <table class="ranking"><tbody>${rows}</tbody></table>
      <p class="foot">最終得点 = 口座残高 + チップ − 初期配布額 ${money(f.initial)} L$</p>
    </section>`;
  }

  function sceneTimer(v) {
    return `${header(v, '提出受付')}
    <section class="scene timer-scene">
      <div class="big-timer" data-timer-big></div>
      <div class="timer-label" data-timer-label></div>
    </section>`;
  }

  // ---------- ルール説明スライド ----------

  const Rules = window.LimitedDiceRules;
  const params = new URLSearchParams(location.search);
  // ?rules を付けて開くと、集計ツールなしでもルール説明を単独で進行できる
  let localMode = params.has('rules') ? 'rules' : null;
  let ruleIndex = 0;

  function rulesInfo() {
    return (payload && payload.rules) || window.LimitedDice.rulesInfo(null, null);
  }

  function sceneRules() {
    const slides = Rules.slideList();
    const i = Math.max(0, Math.min(slides.length - 1, ruleIndex));
    const dots = slides.map((_, k) => `<span class="${k === i ? 'cur' : k < i ? 'done' : ''}"></span>`).join('');
    return `<section class="rules-stage slide-${slides[i].id}">${Rules.render(slides[i], rulesInfo())}</section>
      <div class="rule-dots">${dots}</div>`;
  }

  function goRule(delta) {
    const total = Rules.slideList().length;
    const next = Math.max(0, Math.min(total - 1, ruleIndex + delta));
    if (next === ruleIndex) return;
    ruleIndex = next;
    render();
    // 集計ツール側の表示状態も合わせる
    const msg = { type: 'rule-nav', index: ruleIndex, at: Date.now() };
    try {
      new BroadcastChannel('limitedDice.request.v1').postMessage(msg);
    } catch (e) {
      /* ignore */
    }
    try {
      localStorage.setItem('limitedDice.request.v1', JSON.stringify(msg));
    } catch (e) {
      /* ignore */
    }
  }

  const SCENES = { title: sceneTitle, rules: sceneRules, capacity: sceneCapacity, result: sceneResult, board: sceneBoard, steal: sceneSteal, final: sceneFinal, timer: sceneTimer };

  function currentMode() {
    if (localMode) return localMode;
    const v = payload && payload.view;
    const mode = (payload && payload.display && payload.display.mode) || 'title';
    if (mode === 'rules') return 'rules';
    return v ? mode : 'title';
  }

  function render() {
    const v = payload && payload.view;
    const mode = currentMode();
    const scene = SCENES[mode] || sceneTitle;
    // 同じ内容なら再描画しない（アニメーションの再生を防ぐ）
    const key =
      mode === 'rules'
        ? JSON.stringify([mode, ruleIndex, payload && payload.rules])
        : JSON.stringify([mode, v, payload && payload.display && payload.display.reveal]);
    if (key !== lastKey) {
      lastKey = key;
      $stage.className = 'stage mode-' + mode;
      $stage.innerHTML = scene(v);
    }
    tick();
  }

  function tick() {
    const rem = remaining();
    const running = timerRunning();
    const mini = document.querySelector('[data-timer]');
    if (mini) {
      mini.textContent = running ? fmtTime(rem) : '';
      mini.classList.toggle('on', running);
      mini.classList.toggle('urgent', running && rem <= 60000);
    }
    const big = document.querySelector('[data-timer-big]');
    if (big) {
      const over = rem <= 0;
      big.textContent = over ? 'TIME UP' : fmtTime(rem);
      big.classList.toggle('urgent', rem <= 60000);
      big.classList.toggle('over', over);
      big.classList.toggle('paused', !running && !over);
      const label = document.querySelector('[data-timer-label]');
      if (label) label.textContent = over ? '提出を締め切りました' : running ? '残り時間' : '一時停止中';
    }
  }

  function applyPayload(msg) {
    payload = msg;
    if (msg && msg.display && Number.isInteger(msg.display.ruleSlide)) ruleIndex = msg.display.ruleSlide;
  }

  if (payload) applyPayload(payload);
  Store.subscribe((msg) => {
    localMode = null; // 集計ツールからの指示を優先
    applyPayload(msg);
    render();
  });
  setInterval(tick, 200);

  // 集計ツールに再送を要求（後から開いた場合）
  try {
    new BroadcastChannel('limitedDice.request.v1').postMessage('hello');
  } catch (e) {
    /* ignore */
  }
  try {
    localStorage.setItem('limitedDice.request.v1', String(Date.now()));
  } catch (e) {
    /* ignore */
  }

  // 全画面
  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen && document.documentElement.requestFullscreen();
  }
  document.getElementById('fs').addEventListener('click', toggleFs);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') return toggleFs();
    if (currentMode() !== 'rules') return;
    if (e.key === 'ArrowRight' || e.key === ' ' || e.key === 'Enter' || e.key === 'PageDown') {
      e.preventDefault();
      goRule(1);
    } else if (e.key === 'ArrowLeft' || e.key === 'PageUp') {
      e.preventDefault();
      goRule(-1);
    }
  });
  // ルール説明中は画面クリックで次へ（左端1/5クリックで戻る）
  $stage.addEventListener('click', (e) => {
    if (currentMode() !== 'rules') return;
    goRule(e.clientX < window.innerWidth / 5 ? -1 : 1);
  });

  render();
})();
