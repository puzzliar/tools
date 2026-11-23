/* 制限すごろく 集計ツール（GM用） */
(function () {
  'use strict';

  const E = window.LimitedDice;
  const Store = window.LimitedDiceStore;
  const Rules = window.LimitedDiceRules;
  const RULE_SLIDES = Rules.slideList();
  const $app = document.getElementById('app');

  const DEFAULT_UI = {
    displayMode: 'title',
    reveal: 0,
    ruleSlide: 0,
    timer: { durationMs: 10 * 60 * 1000, endsAt: null, remainingMs: 10 * 60 * 1000 },
    stealDraft: [],
    penaltyExempt: [],
    hideSecrets: false,
    setup: null,
    openHistory: null,
  };

  let game = Store.loadState();
  let undoStack = Store.loadUndo();
  let ui = Store.loadUi(DEFAULT_UI);
  if (!ui.timer) ui.timer = clone(DEFAULT_UI.timer);
  if (!Number.isInteger(ui.ruleSlide)) ui.ruleSlide = 0;

  // ---------- utils ----------

  function clone(v) {
    return JSON.parse(JSON.stringify(v));
  }
  function esc(v) {
    return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  }
  function yen(n) {
    return Number(n).toLocaleString('ja-JP') + ' L$';
  }
  function signed(n) {
    return (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toLocaleString('ja-JP');
  }
  function player(id) {
    return game.players.find((p) => p.id === id);
  }
  function pname(id) {
    const p = player(id);
    return p ? p.name : id;
  }
  function posText(progress) {
    const lap = E.lapOf(game, progress);
    const sq = E.squareOf(game, progress);
    return `${lap}周 / ${sq === 0 ? 'スタート' : sq + 'マス'}`;
  }
  function fmtTime(ms) {
    ms = Math.max(0, ms);
    const t = Math.ceil(ms / 1000);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }
  function timerRemaining() {
    const t = ui.timer;
    return t.endsAt ? t.endsAt - Date.now() : t.remainingMs;
  }

  function toast(msg, kind) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.className = 'toast'), kind === 'error' ? 5000 : 2500);
  }

  // ---------- state transitions ----------

  function saveUi() {
    Store.saveUi(ui);
  }

  function publish() {
    Store.publish({
      view: game ? E.publicView(game) : null,
      rules: game
        ? E.rulesInfo(game.settings, game.players.length)
        : E.rulesInfo({ totalTurns: Number(ui.setup && ui.setup.totalTurns) || 15 }, ui.setup && ui.setup.count),
      display: { mode: ui.displayMode, reveal: ui.reveal, timer: ui.timer, ruleSlide: ui.ruleSlide },
    });
  }

  /** 状態更新（元に戻す対象） */
  function commit(next, opts) {
    opts = opts || {};
    if (!opts.noUndo) {
      undoStack.push({ game, ui: { stealDraft: ui.stealDraft, penaltyExempt: ui.penaltyExempt, displayMode: ui.displayMode, reveal: ui.reveal } });
      if (undoStack.length > Store.UNDO_LIMIT) undoStack = undoStack.slice(-Store.UNDO_LIMIT);
      Store.saveUndo(undoStack);
    }
    game = next;
    Store.saveState(game);
    if (opts.displayMode) ui.displayMode = opts.displayMode;
    saveUi();
    render();
    publish();
  }

  function attempt(fn, opts) {
    try {
      const next = fn();
      commit(next, opts);
      if (opts && opts.ok) toast(opts.ok, 'ok');
      return true;
    } catch (e) {
      if (e instanceof E.RuleError) toast(e.message, 'error');
      else {
        console.error(e);
        toast('エラー: ' + e.message, 'error');
      }
      return false;
    }
  }

  function undo() {
    const prev = undoStack.pop();
    if (!prev) return toast('元に戻せる操作がありません');
    Store.saveUndo(undoStack);
    game = prev.game;
    Object.assign(ui, prev.ui);
    Store.saveState(game);
    saveUi();
    render();
    publish();
    toast('1つ前の状態に戻しました', 'ok');
  }

  // ---------- render: setup ----------

  function ensureSetup() {
    if (ui.setup && ui.setup.rows) return;
    ui.setup = { count: 12, totalTurns: 15, rows: makeRows(12) };
  }

  function makeRows(n, old) {
    const rows = [];
    for (let i = 0; i < n; i++) {
      rows.push(old && old[i] ? old[i] : { name: '', number: i + 1, piece: E.PIECES[i] });
    }
    return rows;
  }

  function renderSetup() {
    ensureSetup();
    const s = ui.setup;
    const caps = E.DEFAULT_SETTINGS.baseCapacities[s.count];
    return `
    <header class="topbar">
      <div class="brand"><a class="home" href="../" title="GMツール一覧">←</a><span class="logo">制限すごろく</span><span class="sub">集計ツール</span></div>
      <div class="actions">
        <button class="btn ghost" data-act="open-display">発表画面を開く</button>
        <label class="btn ghost">読込<input type="file" accept="application/json" data-act="import" hidden></label>
        ${undoStack.length ? '<button class="btn ghost" data-act="undo">元に戻す</button>' : ''}
      </div>
    </header>
    <main class="layout setup-layout">
      <section class="col-main">
      <div class="panel">
        <h2>新しいゲームを準備</h2>
        <p class="hint">プレイヤーナンバー（1〜人数）と駒アルファベットは秘匿情報です。この台帳はGMのみが管理します。</p>
        <div class="row gap">
          <label class="field">参加人数
            <select data-setup="count">
              ${[12, 13, 14, 15].map((n) => `<option value="${n}" ${n === s.count ? 'selected' : ''}>${n}人</option>`).join('')}
            </select>
          </label>
          <label class="field">総ターン数
            <input type="number" min="1" max="99" value="${esc(s.totalTurns)}" data-setup="totalTurns">
          </label>
          <div class="field"><span>基礎定員配列</span><div class="chips">${caps.map((c) => `<span class="chip">${c}</span>`).join('')}</div></div>
        </div>
        <table class="table setup-table">
          <thead><tr><th>#</th><th>名前</th><th>プレイヤーナンバー</th><th>駒</th></tr></thead>
          <tbody>
          ${s.rows
            .map(
              (r, i) => `<tr>
              <td class="muted">${i + 1}</td>
              <td><input type="text" value="${esc(r.name)}" placeholder="プレイヤー名" data-setup-row="${i}" data-key="name"></td>
              <td><input type="number" min="1" value="${esc(r.number)}" data-setup-row="${i}" data-key="number" class="narrow"></td>
              <td><input type="text" maxlength="1" value="${esc(r.piece)}" data-setup-row="${i}" data-key="piece" class="narrow upper"></td>
            </tr>`
            )
            .join('')}
          </tbody>
        </table>
        <div class="row gap end">
          <button class="btn" data-act="setup-random">番号・駒をランダムに割り当て</button>
          <button class="btn primary" data-act="setup-start">ゲーム開始</button>
        </div>
        <p class="hint">ゲーム開始前に、右の「発表画面」からルール説明スライドを進行できます（人数を選ぶと定員スライドに反映されます）。</p>
      </div>
      </section>
      <aside class="col-side"><div class="panel">${renderDisplayControl()}</div></aside>
    </main>`;
  }

  // ---------- render: main ----------

  function renderMain() {
    const steps = ['capacity', 'swap', 'vote', 'steal'];
    const idx = steps.indexOf(game.phase);
    return `
    <header class="topbar">
      <div class="brand"><a class="home" href="../" title="GMツール一覧">←</a><span class="logo">制限すごろく</span><span class="sub">集計ツール</span></div>
      <div class="turn">${game.phase === 'finished' ? 'ゲーム終了' : `ターン <b>${game.turn}</b> / ${game.settings.totalTurns}`}</div>
      <div class="actions">
        <button class="btn ghost" data-act="open-display">発表画面を開く</button>
        <button class="btn ghost" data-act="undo" ${undoStack.length ? '' : 'disabled'}>元に戻す</button>
        <button class="btn ghost" data-act="export">保存</button>
        <label class="btn ghost">読込<input type="file" accept="application/json" data-act="import" hidden></label>
        <button class="btn ghost danger" data-act="new-game">新規</button>
      </div>
    </header>
    <main class="layout">
      <section class="col-main">
        ${
          game.phase === 'finished'
            ? ''
            : `<nav class="stepper">${steps
                .map((st, i) => `<div class="step ${i < idx ? 'done' : i === idx ? 'now' : ''}"><span>${i + 1}</span>${E.PHASES[st]}</div>`)
                .join('')}</nav>`
        }
        <div class="panel">${renderPhase()}</div>
        <div class="panel">${renderLedger()}</div>
        <div class="panel">${renderHistory()}</div>
      </section>
      <aside class="col-side">
        <div class="panel">${renderDisplayControl()}</div>
        ${game.phase === 'finished' ? '' : `<div class="panel">${renderTransfer()}</div>`}
      </aside>
    </main>`;
  }

  function renderPhase() {
    switch (game.phase) {
      case 'capacity':
        return renderCapacity();
      case 'swap':
        return renderSwap();
      case 'vote':
        return renderVote();
      case 'steal':
        return renderSteal();
      case 'finished':
        return renderFinal();
    }
    return '';
  }

  function capsRow(caps, cls) {
    return `<div class="caps ${cls || ''}">${E.NUMBERS.map(
      (n, i) => `<div class="cap"><div class="n">${n}</div><div class="v">${caps ? caps[i] : '–'}</div></div>`
    ).join('')}</div>`;
  }

  function renderCapacity() {
    const base = E.baseCapacityArray(game.settings, game.players.length);
    return `
      <h2>① 定員公開</h2>
      <p class="hint">基礎定員配列 [${base.join(', ')}] をシャッフルして数字1〜6に割り当て、公開掲示します。</p>
      <div class="row gap">
        <button class="btn primary big" data-act="shuffle">シャッフルして公開</button>
      </div>
      <details class="sub-block">
        <summary>手動で定員を入力する（物理的にシャッフルした場合など）</summary>
        <div class="caps-input">
          ${E.NUMBERS.map((n, i) => `<label>${n}<input type="number" min="0" value="${base[i]}" data-capin="${i}"></label>`).join('')}
        </div>
        <button class="btn" data-act="set-caps">この定員で確定</button>
      </details>`;
  }

  function renderSwap() {
    const cands = game.players.filter((p) => !p.swapUsed && p.chips >= game.settings.swapCardPrice);
    const swaps = game.current.swaps;
    return `
      <h2>② アイテム宣言フェーズA（順位入れ替えカード）</h2>
      <div class="sub-block">
        <div class="label">今ターンの基礎定員</div>
        ${capsRow(game.current.baseCaps)}
        ${swaps.length ? '' : '<button class="btn small ghost" data-act="shuffle">再シャッフル</button>'}
      </div>
      <p class="hint">公開宣言された順位入れ替えカード（${yen(game.settings.swapCardPrice)}・チップ払い・1人1枚限り）を宣言順に入力します。入れ替えによる移動は周回扱いになりません。</p>
      <div class="row gap wrap">
        <label class="field">宣言者
          <select id="swap-by">
            <option value="">選択</option>
            ${cands.map((p) => `<option value="${p.id}">${esc(p.name)}（駒${p.piece}・${posText(p.progress)}）</option>`).join('')}
          </select>
        </label>
        <label class="field">入れ替え相手
          <select id="swap-target">
            <option value="">選択</option>
            ${game.players.map((p) => `<option value="${p.id}">${esc(p.name)}（駒${p.piece}・${posText(p.progress)}）</option>`).join('')}
          </select>
        </label>
        <button class="btn" data-act="swap">入れ替え実行</button>
      </div>
      ${
        swaps.length
          ? `<ol class="list">${swaps
              .map(
                (x) =>
                  `<li>${esc(pname(x.byId))} ⇔ ${esc(pname(x.targetId))}　<span class="muted">${posText(x.before.by)} → ${posText(x.after.by)}</span></li>`
              )
              .join('')}</ol>`
          : '<p class="muted">宣言なし</p>'
      }
      <div class="row end"><button class="btn primary big" data-act="end-swap">投票受付へ進む</button></div>`;
  }

  function renderVote() {
    const ballots = game.current.ballots;
    const price = game.settings.capCardPrice;
    const entered = game.players.filter((p) => ballots[p.id]).length;
    const preview = E.tallyPreview(game);
    const repeaters = game.players.filter((p) => p.noSubmitCount >= 1 && (!ballots[p.id] || ballots[p.id].vote === null));
    return `
      <h2>③ 同時提出フェーズ（投票・枠数変更カード）</h2>
      <p class="hint">投票用紙の内容を入力してください。枠数変更カードは ${yen(price)}／枚（チップ払い）。未入力のまま開票すると無提出（移動0）になります。</p>
      <div class="table-wrap">
      <table class="table vote-table">
        <thead><tr><th>名前</th><th>No.</th><th>駒</th><th class="num">チップ</th><th>進む数</th><th>枠数変更カード（数字ごとの枚数）</th><th class="num">費用</th></tr>
        <tr class="subhead"><th colspan="5"></th><th><div class="cards-head">${E.NUMBERS.map((n) => `<span>${n}</span>`).join('')}</div></th><th></th></tr></thead>
        <tbody>
        ${game.players
          .map((p) => {
            const b = ballots[p.id];
            const voteVal = b ? (b.vote === null ? 'none' : String(b.vote)) : '';
            const cost = b ? E.cardCount(b.cards) * price : 0;
            return `<tr class="${b ? (b.vote === null ? 'warn' : 'ok') : 'pending'}" data-row="${p.id}">
              <td>${esc(p.name)}</td><td class="muted">${p.number}</td><td><span class="piece">${p.piece}</span></td>
              <td class="num">${p.chips.toLocaleString()}</td>
              <td><select data-ballot="vote" data-pid="${p.id}" id="vote-${p.id}">
                <option value="" ${voteVal === '' ? 'selected' : ''}>未入力</option>
                ${E.NUMBERS.map((n) => `<option value="${n}" ${voteVal === String(n) ? 'selected' : ''}>${n}</option>`).join('')}
                <option value="none" ${voteVal === 'none' ? 'selected' : ''}>無提出</option>
              </select></td>
              <td><div class="cards-in">${E.NUMBERS.map(
                (n) =>
                  `<input type="number" min="0" value="${b && b.cards[n] ? b.cards[n] : ''}" placeholder="0" data-ballot="card" data-pid="${p.id}" data-n="${n}" id="card-${p.id}-${n}" ${b ? '' : 'disabled'}>`
              ).join('')}</div></td>
              <td class="num">${cost ? cost.toLocaleString() : ''}</td>
            </tr>`;
          })
          .join('')}
        </tbody>
      </table>
      </div>
      <div class="sub-block">
        <div class="label">集計プレビュー（入力済み ${entered} / ${game.players.length}）</div>
        ${tallyTable(preview)}
      </div>
      ${
        repeaters.length
          ? `<div class="sub-block warnbox"><div class="label">反復無提出の軽罰（口座 −${yen(game.settings.noSubmitPenalty)}・運営判断）</div>
          ${repeaters
            .map(
              (p) =>
                `<label class="check"><input type="checkbox" data-act="toggle-exempt" data-pid="${p.id}" ${ui.penaltyExempt.includes(p.id) ? '' : 'checked'}> ${esc(p.name)}（無提出 ${p.noSubmitCount + 1} 回目）に適用</label>`
            )
            .join('')}</div>`
          : ''
      }
      <div class="row end"><button class="btn primary big" data-act="resolve">開票する</button></div>`;
  }

  function tallyTable(rows) {
    return `<table class="table tally">
      <thead><tr><th>数字</th>${rows.map((r) => `<th>${r.number}</th>`).join('')}</tr></thead>
      <tbody>
        <tr><th>基礎定員</th>${rows.map((r) => `<td>${r.base}</td>`).join('')}</tr>
        ${rows[0].cards !== undefined ? `<tr><th>枠数変更</th>${rows.map((r) => `<td>${r.cards ? '+' + r.cards : ''}</td>`).join('')}</tr>` : ''}
        <tr><th>最終定員</th>${rows.map((r) => `<td><b>${r.finalCap}</b></td>`).join('')}</tr>
        <tr><th>投票数</th>${rows.map((r) => `<td><b>${r.votes}</b></td>`).join('')}</tr>
        <tr><th>判定</th>${rows.map((r) => `<td class="${r.ok ? 'good' : 'bad'}">${r.votes === 0 ? '—' : r.ok ? '成立' : '全滅'}</td>`).join('')}</tr>
      </tbody></table>`;
  }

  function stealPreview() {
    if (!ui.stealDraft.length) return { results: [] };
    try {
      const after = E.finalizeTurn(game, ui.stealDraft);
      const h = after.history[after.history.length - 1];
      return { results: h.steals };
    } catch (e) {
      return { error: e.message, results: [] };
    }
  }

  function renderSteal() {
    const r = game.current.result;
    const eligible = r.stealEligible;
    const declared = new Set(ui.stealDraft.map((d) => d.attackerId));
    const avail = eligible.filter((id) => !declared.has(id));
    const preview = stealPreview();
    const numbers = game.players.map((p) => p.number).sort((a, b) => a - b);
    const pieces = game.players.map((p) => p.piece).sort();
    return `
      <h2>④ 開票結果・周回処理・％奪取</h2>
      ${tallyTable(r.numbers)}
      <div class="grid2">
        <div class="sub-block">
          <div class="label">移動</div>
          <table class="table compact">
            <thead><tr><th>名前</th><th>駒</th><th>投票</th><th>移動</th><th>位置</th></tr></thead>
            <tbody>${r.moves
              .map((m) => {
                const p = player(m.playerId);
                return `<tr><td>${esc(p.name)}</td><td><span class="piece">${p.piece}</span></td>
                  <td>${m.noSubmit ? '<span class="bad">無提出</span>' : m.vote}</td>
                  <td>${m.move ? `<b class="good">+${m.move}</b>` : '<span class="muted">0</span>'}</td>
                  <td class="muted">${posText(m.to)}</td></tr>`;
              })
              .join('')}</tbody>
          </table>
        </div>
        <div class="sub-block">
          <div class="label">周回（ボーナスはターン確定時に支払い）</div>
          ${
            r.laps.length
              ? `<table class="table compact"><thead><tr><th>名前</th><th>駒</th><th>周回</th><th>後続</th><th class="num">ボーナス</th><th>％奪取権</th></tr></thead><tbody>
              ${r.laps
                .map((l) => {
                  const p = player(l.playerId);
                  return `<tr><td>${esc(p.name)}</td><td><span class="piece">${p.piece}</span></td><td>${l.lap}周目</td><td>${l.followers}人 × ${l.rate.toLocaleString()}</td>
                  <td class="num">${yen(l.bonus)}</td><td>${eligible.includes(p.id) ? '<b class="good">あり（下位' + game.settings.bottomN + '位以内）</b>' : '<span class="muted">なし</span>'}</td></tr>`;
                })
                .join('')}</tbody></table>`
              : '<p class="muted">今ターンの周回者はいません</p>'
          }
          ${
            r.penalties.length
              ? `<div class="label">ペナルティ</div><ul class="list">${r.penalties.map((x) => `<li>${esc(pname(x.playerId))}：無提出（反復） −${yen(x.amount)}</li>`).join('')}</ul>`
              : ''
          }
        </div>
      </div>
      ${
        eligible.length
          ? `<div class="sub-block">
        <div class="label">％奪取の宣言（宣言順に追加）</div>
        <p class="hint">対象のプレイヤーナンバーと駒アルファベットの完全一致で成功。奪取額は対象口座の最大${Math.round(game.settings.stealMaxRate * 100)}%（端数切り捨て）。宣言額を空欄にすると上限額。</p>
        ${
          avail.length
            ? `<div class="row gap wrap">
          <label class="field">宣言者<select id="st-attacker">${avail.map((id) => `<option value="${id}">${esc(pname(id))}（駒${player(id).piece}）</option>`).join('')}</select></label>
          <label class="field">対象ナンバー<select id="st-number">${numbers.map((n) => `<option>${n}</option>`).join('')}</select></label>
          <label class="field">対象の駒<select id="st-piece">${pieces.map((c) => `<option>${c}</option>`).join('')}</select></label>
          <label class="field">宣言額<input type="number" id="st-amount" min="0" step="10000" placeholder="上限"></label>
          <button class="btn" data-act="steal-add">宣言を追加</button>
        </div>`
            : ''
        }
        ${preview.error ? `<p class="bad">${esc(preview.error)}</p>` : ''}
        ${
          ui.stealDraft.length
            ? `<table class="table compact"><thead><tr><th>#</th><th>宣言者</th><th>宣言</th><th>判定（予定）</th><th></th></tr></thead><tbody>
          ${ui.stealDraft
            .map((d, i) => {
              const res = preview.results[i];
              const verdict = res
                ? res.success
                  ? `<b class="good">成功：${esc(pname(res.targetId))} から ${yen(res.amount)}</b>`
                  : `<span class="bad">不成立</span> <span class="muted">（${E.STEAL_FAIL_REASONS[res.reason]}）</span>`
                : '';
              return `<tr><td>${i + 1}</td><td>${esc(pname(d.attackerId))}</td><td>No.${d.number} × 駒${d.piece}${d.amount != null ? `・${yen(d.amount)}` : '・上限'}</td><td>${verdict}</td>
              <td><button class="btn small ghost" data-act="steal-del" data-i="${i}">削除</button></td></tr>`;
            })
            .join('')}</tbody></table>`
            : ''
        }
      </div>`
          : ''
      }
      <div class="row end"><button class="btn primary big" data-act="finalize">${
        game.turn >= game.settings.totalTurns ? 'ターン確定してゲーム終了' : 'ターンを確定して次へ'
      }</button></div>`;
  }

  function renderFinal() {
    const f = game.final;
    return `
      <h2>最終結果</h2>
      <p class="hint">最終残高 = 口座残高 + チップ。最終得点 = 最終残高 − 初期配布額 ${yen(f.initial)}。1周未満のプレイヤーは口座から ${yen(game.settings.underLapPenalty)} 回収済み。</p>
      <table class="table">
        <thead><tr><th>順位</th><th>名前</th><th>No.</th><th>駒</th><th class="num">口座</th><th class="num">チップ</th><th class="num">最終残高</th><th class="num">最終得点</th></tr></thead>
        <tbody>${f.ranking
          .map((r) => {
            const p = player(r.playerId);
            const pen = f.penalties.find((x) => x.playerId === r.playerId);
            return `<tr class="${r.rank === 1 ? 'winner' : ''}"><td><b>${r.rank}</b></td><td>${esc(p.name)}${pen ? ` <span class="tag bad">周回未達成 −${pen.amount.toLocaleString()}</span>` : ''}</td>
              <td>${p.number}</td><td><span class="piece">${p.piece}</span></td><td class="num">${r.account.toLocaleString()}</td><td class="num">${r.chips.toLocaleString()}</td>
              <td class="num">${r.balance.toLocaleString()}</td><td class="num"><b class="${r.score >= 0 ? 'good' : 'bad'}">${signed(r.score)}</b></td></tr>`;
          })
          .join('')}</tbody>
      </table>`;
  }

  function renderLedger() {
    const ranks = E.boardRanks(game);
    const hide = ui.hideSecrets;
    const rows = game.players.slice().sort((a, b) => ranks[a.id] - ranks[b.id] || a.number - b.number);
    return `
      <div class="row between">
        <h2>プレイヤー台帳 <span class="tag">秘匿</span></h2>
        <label class="check"><input type="checkbox" data-act="toggle-hide" ${hide ? 'checked' : ''}> 番号・駒を隠す</label>
      </div>
      <div class="table-wrap">
      <table class="table ledger">
        <thead><tr><th>順位</th><th>名前</th><th>No.</th><th>駒</th><th>位置</th><th class="num">口座</th><th class="num">チップ</th><th class="num">合計</th><th>入替</th><th>無提出</th></tr></thead>
        <tbody>${rows
          .map(
            (p) => `<tr>
            <td>${ranks[p.id]}</td><td>${esc(p.name)}</td>
            <td class="secret">${hide ? '•' : p.number}</td><td class="secret">${hide ? '•' : `<span class="piece">${p.piece}</span>`}</td>
            <td>${posText(p.progress)}</td>
            <td class="num">${p.account.toLocaleString()}</td><td class="num">${p.chips.toLocaleString()}</td>
            <td class="num"><b>${(p.account + p.chips).toLocaleString()}</b></td>
            <td>${p.swapUsed ? '<span class="muted">使用済</span>' : '未使用'}</td>
            <td>${p.noSubmitCount || ''}</td></tr>`
          )
          .join('')}</tbody>
      </table>
      </div>`;
  }

  const LEDGER_LABEL = {
    transfer: (x) => `送受金（${x.kind === 'account' ? '口座' : 'チップ'}）${esc(pname(x.playerId))} → ${esc(pname(x.targetId))} ${yen(x.amount)}${x.memo ? '　' + esc(x.memo) : ''}`,
    adjust: (x) =>
      `補正：${esc(pname(x.playerId))} ${{ account: '口座', chips: 'チップ', progress: '位置' }[x.kind]} ${signed(x.delta)}${x.memo ? '　' + esc(x.memo) : ''}`,
    swap: (x) => `順位入れ替え：${esc(pname(x.playerId))} ⇔ ${esc(pname(x.targetId))}（チップ ${signed(x.chips)}）`,
    capCard: (x) => `枠数変更カード：${esc(pname(x.playerId))} ${Object.entries(x.cards).map(([n, c]) => `${n}×${c}`).join(' ')}（チップ ${signed(x.chips)}）`,
    penalty: (x) => `ペナルティ：${esc(pname(x.playerId))} ${x.reason} 口座 ${signed(x.account)}`,
    steal: (x) => `％奪取成功：${esc(pname(x.playerId))} ← ${esc(pname(x.targetId))} ${yen(x.account)}`,
    lapBonus: (x) => `周回ボーナス：${esc(pname(x.playerId))} ${x.lap}周目 ${yen(x.account)}`,
  };

  function renderHistory() {
    const turns = game.history.slice().reverse();
    const pending = game.ledger.filter((x) => x.turn === game.turn && game.phase !== 'finished');
    return `
      <h2>履歴</h2>
      ${
        pending.length
          ? `<details class="hist" open><summary>ターン ${game.turn}（進行中）の記録</summary><ul class="list">${pending
              .map((x) => `<li>${LEDGER_LABEL[x.type](x)}</li>`)
              .join('')}</ul></details>`
          : ''
      }
      ${
        turns.length
          ? turns
              .map((h) => {
                const entries = game.ledger.filter((x) => x.turn === h.turn);
                return `<details class="hist"><summary>ターン ${h.turn}：成立 ${h.numbers.filter((r) => r.ok && r.votes).map((r) => r.number).join('・') || 'なし'}／周回 ${h.laps.length}人／奪取 ${h.steals.filter((x) => x.success).length}件</summary>
                  ${tallyTable(h.numbers)}
                  ${
                    h.steals.length
                      ? `<div class="label">％奪取</div><ul class="list">${h.steals
                          .map(
                            (x) =>
                              `<li>${esc(pname(x.attackerId))}：No.${x.number}×駒${x.piece} → ${x.success ? `<b class="good">成功 ${yen(x.amount)}</b>` : `<span class="bad">不成立</span>（${E.STEAL_FAIL_REASONS[x.reason]}）`}</li>`
                          )
                          .join('')}</ul>`
                      : ''
                  }
                  <div class="label">取引記録</div>
                  <ul class="list">${entries.map((x) => `<li>${LEDGER_LABEL[x.type](x)}</li>`).join('') || '<li class="muted">なし</li>'}</ul>
                </details>`;
              })
              .join('')
          : '<p class="muted">まだ確定したターンはありません</p>'
      }`;
  }

  function renderRuleControl() {
    const i = Math.min(ui.ruleSlide, RULE_SLIDES.length - 1);
    const cur = RULE_SLIDES[i];
    const label = cur.ruleIdx ? `RULE ${String(cur.ruleIdx).padStart(2, '0')}　${cur.title}` : cur.title;
    return `<div class="sub-block rule-ctl ${ui.displayMode === 'rules' ? 'on' : ''}">
        <div class="label">ルール説明スライド（${i + 1} / ${RULE_SLIDES.length}）</div>
        <div class="rule-now">${esc(label)}</div>
        <div class="row gap">
          <button class="btn" data-act="rule-go" data-d="-1" ${i === 0 ? 'disabled' : ''}>◀ 前へ</button>
          <button class="btn primary" data-act="rule-go" data-d="1" ${i === RULE_SLIDES.length - 1 ? 'disabled' : ''}>次へ ▶</button>
          <select data-act="rule-jump" class="rule-jump">${RULE_SLIDES.map(
            (sl, k) => `<option value="${k}" ${k === i ? 'selected' : ''}>${sl.ruleIdx ? String(sl.ruleIdx).padStart(2, '0') + ' ' : ''}${esc(sl.title)}</option>`
          ).join('')}</select>
        </div>
        <p class="hint">発表画面側でも ← → キー・クリックで進められます。</p>
      </div>`;
  }

  function renderDisplayControl() {
    const modes = [
      ['title', 'タイトル'],
      ['rules', 'ルール説明'],
      ['timer', 'タイマー'],
    ];
    if (game) {
      modes.push(['capacity', '定員'], ['result', '開票結果'], ['board', '盤面'], ['steal', '％奪取']);
      if (game.phase === 'finished') modes.push(['final', '最終結果']);
    }
    const n = game ? game.players.length : 0;
    const running = !!ui.timer.endsAt;
    return `
      <h2>発表画面</h2>
      <div class="mode-grid">${modes
        .map(([k, label]) => `<button class="btn ${ui.displayMode === k ? 'primary' : ''}" data-act="mode" data-mode="${k}">${label}</button>`)
        .join('')}</div>
      ${renderRuleControl()}
      ${
        game && game.phase === 'finished'
          ? `<div class="sub-block"><div class="label">最終結果の発表（下位から順に公開）</div>
        <div class="row gap"><button class="btn" data-act="reveal" data-d="-1">◀</button><span class="reveal">${ui.reveal} / ${n}</span>
        <button class="btn primary" data-act="reveal" data-d="1">次を公開 ▶</button><button class="btn ghost" data-act="reveal-all">全公開</button></div></div>`
          : ''
      }
      <div class="sub-block">
        <div class="label">タイマー</div>
        <div class="timer-readout ${running ? 'running' : ''}" id="gm-timer">${fmtTime(timerRemaining())}</div>
        <div class="row gap wrap">
          ${[5, 10, 15, 20].map((m) => `<button class="btn small ghost" data-act="timer-set" data-min="${m}">${m}分</button>`).join('')}
        </div>
        <div class="row gap">
          <button class="btn ${running ? '' : 'primary'}" data-act="timer-toggle">${running ? '一時停止' : 'スタート'}</button>
          <button class="btn ghost" data-act="timer-reset">リセット</button>
        </div>
      </div>
      <p class="hint">発表画面には公開情報（ルール・定員・数字ごとの票数・駒の位置・宣言結果など）のみが送られます。誰が何に投票したか、番号と駒の紐付けは表示されません。</p>`;
  }

  function renderTransfer() {
    const opts = game.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    return `
      <h2>送受金・補正</h2>
      <div class="form-col">
        <label class="field">種別<select id="tr-kind"><option value="account">口座残高</option><option value="chips">チップ</option></select></label>
        <label class="field">送金元<select id="tr-from">${opts}</select></label>
        <label class="field">送金先<select id="tr-to">${opts}</select></label>
        <label class="field">金額<input type="number" id="tr-amount" min="1" step="10000" placeholder="例: 300000"></label>
        <label class="field">メモ<input type="text" id="tr-memo" placeholder="任意"></label>
        <button class="btn primary" data-act="transfer">送受金を記録</button>
      </div>
      <details class="sub-block">
        <summary>運営による手動補正</summary>
        <div class="form-col">
          <label class="field">プレイヤー<select id="ad-player">${opts}</select></label>
          <label class="field">対象<select id="ad-kind"><option value="account">口座残高</option><option value="chips">チップ</option><option value="progress">位置（マス数）</option></select></label>
          <label class="field">増減（マイナス可）<input type="number" id="ad-delta" placeholder="例: -100000"></label>
          <label class="field">理由<input type="text" id="ad-memo" placeholder="任意"></label>
          <button class="btn" data-act="adjust">補正を記録</button>
        </div>
      </details>`;
  }

  // ---------- render root ----------

  function render() {
    const focusId = document.activeElement && document.activeElement.id;
    const scroll = window.scrollY;
    $app.innerHTML = (game ? renderMain() : renderSetup()) + '<div id="toast" class="toast"></div>';
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) el.focus();
    }
    window.scrollTo(0, scroll);
  }

  // ---------- actions ----------

  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  const actions = {
    'open-display'() {
      const w = window.open('display.html', 'limitedDiceDisplay');
      Store.registerDisplayWindow(w);
      setTimeout(publish, 600);
      setTimeout(publish, 1500);
    },
    undo,
    export() {
      const blob = new Blob([JSON.stringify({ app: 'limited-dice', exportedAt: new Date().toISOString(), game }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `limited-dice-turn${game.turn}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    'new-game'() {
      if (!confirm('現在のゲームを終了して新規ゲームを準備しますか？（「元に戻す」で復帰できます）')) return;
      ui.setup = null;
      ui.stealDraft = [];
      ui.penaltyExempt = [];
      ui.reveal = 0;
      ui.displayMode = 'title';
      commit(null);
    },
    'setup-random'() {
      const s = ui.setup;
      const names = s.rows.map((r, i) => r.name || `プレイヤー${i + 1}`);
      s.rows = E.randomAssignment(names).map((r, i) => ({ name: s.rows[i].name, number: r.number, piece: r.piece }));
      saveUi();
      render();
    },
    'setup-start'() {
      const s = ui.setup;
      attempt(() => E.createGame(s.rows, { totalTurns: Number(s.totalTurns) || 15 }), { ok: 'ゲームを開始しました', displayMode: 'title' });
    },
    shuffle() {
      attempt(() => E.shuffleBaseCaps(game), { displayMode: 'capacity', ok: '定員を公開しました' });
    },
    'set-caps'() {
      const caps = E.NUMBERS.map((_, i) => Number(document.querySelector(`[data-capin="${i}"]`).value));
      attempt(() => E.setBaseCaps(game, caps), { displayMode: 'capacity' });
    },
    swap() {
      const by = val('swap-by');
      const target = val('swap-target');
      if (!by || !target) return toast('宣言者と相手を選択してください', 'error');
      attempt(() => E.declareSwap(game, by, target), { ok: '入れ替えを実行しました', displayMode: 'board' });
    },
    'end-swap'() {
      attempt(() => E.endSwapPhase(game), { displayMode: 'timer' });
    },
    'toggle-exempt'(el) {
      const id = el.dataset.pid;
      ui.penaltyExempt = el.checked ? ui.penaltyExempt.filter((x) => x !== id) : [...ui.penaltyExempt, id];
      saveUi();
    },
    resolve() {
      const missing = game.players.filter((p) => !game.current.ballots[p.id]);
      if (missing.length && !confirm(`未入力の ${missing.length} 人（${missing.map((p) => p.name).join('、')}）は無提出として扱います。開票しますか？`)) return;
      const exempt = ui.penaltyExempt.slice();
      ui.stealDraft = [];
      if (attempt(() => E.resolveVotes(game, { penaltyExempt: exempt }), { displayMode: 'result', ok: '開票しました' })) {
        ui.penaltyExempt = [];
        saveUi();
      }
    },
    'steal-add'() {
      const amountRaw = val('st-amount');
      ui.stealDraft.push({
        attackerId: val('st-attacker'),
        number: Number(val('st-number')),
        piece: val('st-piece'),
        amount: amountRaw === '' ? null : Number(amountRaw),
      });
      saveUi();
      render();
    },
    'steal-del'(el) {
      ui.stealDraft.splice(Number(el.dataset.i), 1);
      saveUi();
      render();
    },
    finalize() {
      const last = game.turn >= game.settings.totalTurns;
      if (last && !confirm('最終ターンを確定してゲームを終了します。よろしいですか？')) return;
      const draft = ui.stealDraft.slice();
      const mode = last ? 'final' : draft.length ? 'steal' : 'board';
      if (attempt(() => E.finalizeTurn(game, draft), { displayMode: mode, ok: last ? 'ゲーム終了' : 'ターンを確定しました' })) {
        ui.stealDraft = [];
        ui.reveal = 0;
        saveUi();
        publish();
      }
    },
    'toggle-hide'(el) {
      ui.hideSecrets = el.checked;
      saveUi();
      render();
    },
    'rule-go'(el) {
      setRuleSlide(ui.ruleSlide + Number(el.dataset.d));
    },
    mode(el) {
      ui.displayMode = el.dataset.mode;
      saveUi();
      render();
      publish();
    },
    reveal(el) {
      ui.reveal = Math.max(0, Math.min(game.players.length, ui.reveal + Number(el.dataset.d)));
      ui.displayMode = 'final';
      saveUi();
      render();
      publish();
    },
    'reveal-all'() {
      ui.reveal = game.players.length;
      ui.displayMode = 'final';
      saveUi();
      render();
      publish();
    },
    'timer-set'(el) {
      const ms = Number(el.dataset.min) * 60000;
      ui.timer = { durationMs: ms, endsAt: null, remainingMs: ms };
      saveUi();
      render();
      publish();
    },
    'timer-toggle'() {
      const t = ui.timer;
      if (t.endsAt) {
        t.remainingMs = Math.max(0, t.endsAt - Date.now());
        t.endsAt = null;
      } else {
        if (t.remainingMs <= 0) t.remainingMs = t.durationMs;
        t.endsAt = Date.now() + t.remainingMs;
        ui.displayMode = ui.displayMode === 'title' ? 'timer' : ui.displayMode;
      }
      saveUi();
      render();
      publish();
    },
    'timer-reset'() {
      ui.timer = { durationMs: ui.timer.durationMs, endsAt: null, remainingMs: ui.timer.durationMs };
      saveUi();
      render();
      publish();
    },
    transfer() {
      const amount = Number(val('tr-amount'));
      attempt(() => E.transfer(game, val('tr-from'), val('tr-to'), amount, val('tr-kind'), val('tr-memo')), { ok: '送受金を記録しました' });
    },
    adjust() {
      const delta = Number(val('ad-delta'));
      attempt(() => E.adjust(game, val('ad-player'), val('ad-kind'), delta, val('ad-memo')), { ok: '補正を記録しました' });
    },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT') return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el);
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.act === 'toggle-exempt' || el.dataset.act === 'toggle-hide') return actions[el.dataset.act](el);
    if (el.dataset.act === 'import') return importFile(el);
    if (el.dataset.act === 'rule-jump') return setRuleSlide(Number(el.value));
    if (el.dataset.setup) {
      const s = ui.setup;
      if (el.dataset.setup === 'count') {
        s.count = Number(el.value);
        s.rows = makeRows(s.count, s.rows);
        saveUi();
        render();
      } else {
        s[el.dataset.setup] = el.value;
        saveUi();
      }
      publish(); // ルール説明スライドの人数・ターン数に反映
      return;
    }
    if (el.dataset.ballot) return onBallotChange(el.dataset.pid);
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.setupRow !== undefined) {
      const row = ui.setup.rows[Number(el.dataset.setupRow)];
      const key = el.dataset.key;
      row[key] = key === 'number' ? Number(el.value) : key === 'piece' ? el.value.toUpperCase() : el.value;
      saveUi();
    }
  });

  function setRuleSlide(i, fromDisplay) {
    ui.ruleSlide = Math.max(0, Math.min(RULE_SLIDES.length - 1, i));
    ui.displayMode = 'rules';
    saveUi();
    render();
    if (!fromDisplay) publish();
  }

  function onRequest(data) {
    if (data && typeof data === 'object' && data.type === 'rule-nav') {
      if (data.index !== ui.ruleSlide || ui.displayMode !== 'rules') setRuleSlide(Number(data.index), true);
      return;
    }
    publish();
  }

  function onBallotChange(pid) {
    const v = document.getElementById('vote-' + pid).value;
    if (v === '') {
      return attempt(() => E.clearBallot(game, pid), { noUndo: true });
    }
    const cards = {};
    for (const n of E.NUMBERS) {
      const el = document.getElementById(`card-${pid}-${n}`);
      const c = el && el.value !== '' ? Number(el.value) : 0;
      if (c) cards[n] = c;
    }
    attempt(() => E.setBallot(game, pid, { vote: v === 'none' ? null : Number(v), cards }), { noUndo: true });
  }

  function importFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const g = data.game || data;
        if (!g || g.schema !== E.SCHEMA || !Array.isArray(g.players)) throw new Error('制限すごろくの保存データではありません');
        ui.stealDraft = [];
        ui.penaltyExempt = [];
        commit(g);
        toast('読み込みました', 'ok');
      } catch (e) {
        toast('読込に失敗しました: ' + e.message, 'error');
      }
    };
    reader.readAsText(file);
  }

  // タイマー表示の更新
  setInterval(() => {
    const el = document.getElementById('gm-timer');
    if (!el) return;
    const rem = timerRemaining();
    el.textContent = fmtTime(rem);
    if (ui.timer.endsAt && rem <= 0) {
      ui.timer.remainingMs = 0;
      ui.timer.endsAt = null;
      saveUi();
      render();
      publish();
    }
  }, 250);

  // 発表画面からの再送要求
  window.addEventListener('storage', (ev) => {
    if (ev.key !== 'limitedDice.request.v1') return;
    let data = null;
    try {
      data = JSON.parse(ev.newValue);
    } catch (e) {
      data = null;
    }
    onRequest(data);
  });
  try {
    const bc = new BroadcastChannel('limitedDice.request.v1');
    bc.onmessage = (ev) => onRequest(ev.data);
  } catch (e) {
    /* ignore */
  }

  render();
  publish();
})();
