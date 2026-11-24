/* 強奪ビンゴ 集計ツール（GM用） */
(function () {
  'use strict';

  const B = window.RobberBingo;
  const Store = window.RobberBingoStore;
  const $app = document.getElementById('app');
  const REQUEST = 'robberBingo.request.v1';

  const DEFAULT_UI = {
    displayMode: 'title',
    reveal: 0,
    timer: { durationMs: 5 * 60 * 1000, endsAt: null, remainingMs: 5 * 60 * 1000 },
    hideSecrets: false,
    setup: null,
    chipsDraft: {},
    voteDraft: {},
  };

  let game = Store.loadState();
  if (game && game.game !== 'robber-bingo') game = null;
  let undoStack = Store.loadUndo();
  let ui = Store.loadUi(DEFAULT_UI);
  if (!ui.timer) ui.timer = clone(DEFAULT_UI.timer);
  if (!ui.chipsDraft) ui.chipsDraft = {};
  if (!ui.voteDraft) ui.voteDraft = {};

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
  function pct(r) {
    return Math.round(r * 100) + '%';
  }
  function fmtTime(ms) {
    const t = Math.ceil(Math.max(0, ms) / 1000);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  }
  function timerRemaining() {
    return ui.timer.endsAt ? ui.timer.endsAt - Date.now() : ui.timer.remainingMs;
  }
  function toast(msg, kind) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = msg;
    el.className = 'toast show ' + (kind || '');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => (el.className = 'toast'), kind === 'error' ? 5000 : 2500);
  }
  function val(id) {
    const el = document.getElementById(id);
    return el ? el.value : '';
  }

  // ---------- state transitions ----------

  function saveUi() {
    Store.saveUi(ui);
  }
  function publish() {
    Store.publish({ view: game ? B.publicView(game) : null, display: { mode: ui.displayMode, reveal: ui.reveal, timer: ui.timer } });
  }
  function commit(next, opts) {
    opts = opts || {};
    if (!opts.noUndo) {
      undoStack.push({ game, ui: { displayMode: ui.displayMode, reveal: ui.reveal } });
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
      commit(fn(), opts);
      if (opts && opts.ok) toast(opts.ok, 'ok');
      return true;
    } catch (e) {
      if (e instanceof B.RuleError) toast(e.message, 'error');
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

  // ---------- setup ----------

  function makeRow(i) {
    return { name: '', number: i + 1, account: B.LETTERS[i], card: Array(9).fill('') };
  }
  function ensureSetup() {
    if (ui.setup && ui.setup.rows) return;
    ui.setup = { count: 15, totalTurns: 15, rows: Array.from({ length: 15 }, (_, i) => makeRow(i)) };
  }

  function renderSetup() {
    ensureSetup();
    const s = ui.setup;
    return `
    ${topbar()}
    <main class="layout setup-layout">
      <section class="col-main"><div class="panel">
        <h2>新しいゲームを準備</h2>
        <p class="hint">プレイヤーNo.と口座記号（途中発表で使う記号）の紐付けは秘匿情報です。ビンゴカードは配布したカードの数字を左上から右へ入力してください。</p>
        <div class="row gap wrap">
          <label class="field">参加人数<input type="number" min="2" max="26" value="${s.count}" data-setup="count" class="narrow"></label>
          <label class="field">総ターン数<input type="number" min="1" max="99" value="${esc(s.totalTurns)}" data-setup="totalTurns" class="narrow"></label>
          <button class="btn" data-act="setup-random">No.・口座記号をランダム割当</button>
          <button class="btn ghost" data-act="setup-cards">カードをランダム生成（テスト用）</button>
        </div>
        <div class="table-wrap">
        <table class="table setup-table">
          <thead><tr><th>#</th><th>名前</th><th>No.</th><th>口座</th><th>ビンゴカード（3×3）</th></tr></thead>
          <tbody>${s.rows
            .map(
              (r, i) => `<tr>
              <td class="muted">${i + 1}</td>
              <td><input type="text" value="${esc(r.name)}" placeholder="プレイヤー名" data-row="${i}" data-key="name"></td>
              <td><input type="number" min="1" value="${esc(r.number)}" data-row="${i}" data-key="number" class="tiny"></td>
              <td><input type="text" maxlength="1" value="${esc(r.account)}" data-row="${i}" data-key="account" class="tiny upper"></td>
              <td><div class="card-in">${r.card
                .map((c, k) => `<input type="number" min="1" max="27" value="${esc(c)}" data-row="${i}" data-cell="${k}" aria-label="${esc(r.name || 'プレイヤー' + (i + 1))} マス${k + 1}">`)
                .join('')}</div></td></tr>`
            )
            .join('')}</tbody>
        </table>
        </div>
        <div class="row end"><button class="btn primary big" data-act="setup-start">ゲーム開始</button></div>
      </div></section>
      <aside class="col-side"><div class="panel">${renderDisplayControl()}</div></aside>
    </main>`;
  }

  // ---------- main ----------

  function topbar() {
    const turn = game ? (game.phase === 'finished' ? 'ゲーム終了' : `ターン <b>${Math.min(game.turn, game.settings.totalTurns)}</b> / ${game.settings.totalTurns}`) : '';
    return `<header class="topbar">
      <div class="brand"><a class="home" href="../" title="GMツール一覧">←</a><span class="logo">強奪ビンゴ</span><span class="sub">集計ツール</span></div>
      <div class="turn">${turn}</div>
      <div class="actions">
        <button class="btn ghost" data-act="open-display">発表画面を開く</button>
        <button class="btn ghost" data-act="undo" ${undoStack.length ? '' : 'disabled'}>元に戻す</button>
        ${game ? '<button class="btn ghost" data-act="export">保存</button>' : ''}
        <label class="btn ghost">読込<input type="file" accept="application/json" data-act="import" hidden></label>
        ${game ? '<button class="btn ghost danger" data-act="new-game">新規</button>' : ''}
      </div>
    </header>`;
  }

  function renderMain() {
    const steps = ['draw', 'vote', 'resolved'];
    const idx = steps.indexOf(game.phase);
    return `${topbar()}
    <main class="layout">
      <section class="col-main">
        ${
          idx >= 0
            ? `<nav class="stepper">${steps.map((st, i) => `<div class="step ${i < idx ? 'done' : i === idx ? 'now' : ''}"><span>${i + 1}</span>${B.PHASES[st]}</div>`).join('')}</nav>`
            : ''
        }
        <div class="panel">${renderPhase()}</div>
        <div class="panel">${renderBalls()}</div>
        <div class="panel">${renderLedger()}</div>
        <div class="panel">${renderHistory()}</div>
      </section>
      <aside class="col-side">
        <div class="panel">${renderDisplayControl()}</div>
        ${game.phase === 'finished' ? '' : `<div class="panel">${renderAdjust()}</div>`}
      </aside>
    </main>`;
  }

  function renderPhase() {
    switch (game.phase) {
      case 'draw':
        return renderDraw();
      case 'vote':
        return renderVote();
      case 'resolved':
        return renderResolved();
      case 'finalSteal':
        return renderFinalSteal();
      case 'settle':
        return renderSettle();
      case 'finished':
        return renderFinal();
    }
    return '';
  }

  function ballChip(n, extra) {
    return `<span class="ball ${game.balls[n]} ${extra || ''}" title="${B.BALL_STATES[game.balls[n]]}">${n}</span>`;
  }

  function startEventsBlock() {
    const ev = game.startEvents;
    const prev = game.history[game.history.length - 1];
    const items = [];
    if (prev && prev.moneyMoved) items.push(`前ターンに口座の移動がありました → <b>全口座の残高を途中発表</b>してください（発表画面「口座残高」）。`);
    if (ev && ev.io.length) {
      const done = ev.io.filter((m) => !m.skipped);
      const skipped = ev.io.filter((m) => m.skipped);
      if (done.length) items.push(`IN/OUT を反映：${done.map((m) => `${m.number} ${m.dir.toUpperCase()}`).join('、')}`);
      if (skipped.length) items.push(`<span class="muted">対象外で移動なし：${skipped.map((m) => `${m.number} ${m.dir.toUpperCase()}`).join('、')}</span>`);
    }
    if (ev && ev.refilled.length) items.push(`マシーンが空のため、プールの玉 ${ev.refilled.length} 個をマシーンに戻しました。`);
    return items.length ? `<div class="sub-block notice"><div class="label">ターン開始時の処理</div><ul class="list">${items.map((t) => `<li>${t}</li>`).join('')}</ul></div>` : '';
  }

  function renderDraw() {
    const machine = B.ballsIn(game, 'machine');
    const want = Math.min(game.settings.drawCount, machine.length);
    return `
      <h2>① 抽選</h2>
      ${startEventsBlock()}
      <p class="hint">ビンゴマシーンから出た玉を、出た順に入力してください（X → Y → Z）。マシーン内：${machine.length} 個</p>
      <div class="row gap wrap">
        ${B.SLOTS.slice(0, want)
          .map((sl) => `<label class="field">${sl}<input type="number" min="1" max="${game.settings.maxBall}" id="draw-${sl}" class="ball-in"></label>`)
          .join('')}
        <button class="btn primary big" data-act="draw">出玉を登録</button>
        <button class="btn ghost" data-act="draw-random">ランダムに引く（テスト用）</button>
      </div>
      ${want === 0 ? '<p class="bad">マシーン・プールに玉がありません。玉の状況から補正してください。</p>' : ''}`;
  }

  function stealRightsOptions(rightTurn) {
    const used = new Set(game.current.steals.map((x) => x.attackerId + ':' + x.k));
    const opts = [];
    for (const p of game.players) {
      for (const k of B.rightsFrom(p, rightTurn)) {
        if (!used.has(p.id + ':' + k)) opts.push({ id: p.id, k });
      }
    }
    return opts;
  }

  function stealBlock(rightTurn, title) {
    const opts = stealRightsOptions(rightTurn);
    const steals = game.current.steals;
    return `<div class="sub-block">
      <div class="label">${title}</div>
      ${
        opts.length
          ? `<div class="row gap wrap">
          <label class="field">強奪する側（権利）<select id="st-right">${opts
            .map((o) => {
              const r = B.rateOf(game.settings, o.k);
              return `<option value="${o.id}:${o.k}">${esc(pname(o.id))}（No.${player(o.id).number}）— ${o.k}列目・${pct(r)}</option>`;
            })
            .join('')}</select></label>
          <label class="field">強奪される側<select id="st-target">${game.players.map((p) => `<option value="${p.id}">${esc(p.name)}（No.${p.number}）</option>`).join('')}</select></label>
          <button class="btn" data-act="steal-add">申請を追加</button>
        </div>`
          : `<p class="muted">${rightTurn > 0 ? `${rightTurn}ターン目に成立した列がないため、強奪の権利を持つプレイヤーはいません。` : '1ターン目は強奪できません。'}</p>`
      }
      ${
        steals.length
          ? `<table class="table compact"><thead><tr><th>#</th><th>強奪する側</th><th>強奪される側</th><th>列</th><th class="num">割合</th><th class="num">見込み額</th><th></th></tr></thead><tbody>
        ${steals
          .map((x, i) => {
            const r = B.rateOf(game.settings, x.k);
            return `<tr><td>${i + 1}</td><td>${esc(pname(x.attackerId))}</td><td>${esc(pname(x.targetId))}</td><td>${x.k}列目</td><td class="num">${pct(r)}</td>
            <td class="num">${yen(Math.floor(player(x.targetId).balance * r))}</td><td><button class="btn small ghost" data-act="steal-del" data-i="${i}">削除</button></td></tr>`;
          })
          .join('')}</tbody></table><p class="hint">見込み額は現在残高ベース。開票時に申請順で処理します。</p>`
          : ''
      }
    </div>`;
  }

  function renderVote() {
    const d = game.current.drawn;
    const n = game.players.length;
    const io = game.current.inout;
    const ioTally = {};
    io.forEach((m) => {
      ioTally[m.number] = ioTally[m.number] || { in: 0, out: 0 };
      ioTally[m.number][m.dir] += 1;
    });
    const canExclude = game.turn >= game.settings.excludeFromTurn;
    const prices = game.settings.prices;
    return `
      <h2>② 投票・強奪受付（制限時間 5分）</h2>
      ${startEventsBlock()}
      <div class="drawn-row">${d.map((x) => `<div class="slot"><div class="sl">${x.slot}</div>${ballChip(x.number, 'big')}</div>`).join('') || '<p class="muted">出玉なし</p>'}</div>

      ${stealBlock(game.turn - 1, game.turn > 1 ? `強奪申請（${game.turn - 1}ターン目に成立した列の権利）` : '強奪申請')}

      <div class="sub-block">
        <div class="label">IN/OUT申請カード（${yen(prices.inout)}・次ターン開始時に反映）</div>
        <div class="row gap wrap">
          <label class="field">数字<input type="number" min="1" max="${game.settings.maxBall}" id="io-number" class="tiny"></label>
          <label class="field">種類<select id="io-dir"><option value="in">IN（プール/トラッシュ → マシーン）</option><option value="out">OUT（マシーン/プール → トラッシュ）</option></select></label>
          <button class="btn" data-act="io-add">申請を追加</button>
        </div>
        ${
          io.length
            ? `<div class="chips-row">${io
                .map((m, i) => `<span class="pill">${m.number} ${m.dir.toUpperCase()} <button class="x" data-act="io-del" data-i="${i}" aria-label="削除">×</button></span>`)
                .join('')}</div>
              <p class="hint">集計：${Object.entries(ioTally)
                .map(([num, t]) => `${num}（IN ${t.in} / OUT ${t.out} → ${t.in > t.out ? 'IN' : t.out > t.in ? 'OUT' : '移動なし'}）`)
                .join('、')}</p>`
            : ''
        }
      </div>

      <div class="grid2">
        <div class="sub-block">
          <div class="label">変更カード（${yen(prices.change)}・即時）</div>
          <div class="row gap wrap">
            <label class="field">プレイヤー<select id="ch-player">${game.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label>
            <label class="field">マス<select id="ch-cell">${Array.from({ length: 9 }, (_, i) => `<option value="${i}">${i + 1}（${Math.floor(i / 3) + 1}行${(i % 3) + 1}列）</option>`).join('')}</select></label>
            <label class="field">新しい数字<input type="number" min="1" max="${game.settings.maxBall}" id="ch-number" class="tiny"></label>
            <button class="btn" data-act="change">変更</button>
          </div>
        </div>
        <div class="sub-block">
          <div class="label">除外カード（${yen(prices.exclude)}・${game.settings.excludeFromTurn}ターン目以降）</div>
          ${
            canExclude
              ? `<div class="row gap wrap"><label class="field">数字<input type="number" min="1" max="${game.settings.maxBall}" id="ex-number" class="tiny"></label><button class="btn" data-act="exclude">除外</button></div>`
              : `<p class="muted">${game.settings.excludeFromTurn}ターン目から使用できます。</p>`
          }
        </div>
      </div>

      <div class="sub-block votebox">
        <div class="label">開票（有効になるには投票数 ${B.minVotes(game)} 票以上が必要：${n}人の過半数）</div>
        <div class="row gap wrap">
          ${d.map((x) => `<label class="field">${x.slot}（${x.number}）の票数<input type="number" min="0" id="v-${x.slot}" class="tiny" data-vote="${x.slot}" value="${esc(ui.voteDraft[x.slot] ?? '')}"></label>`).join('')}
          <label class="field">無効票<input type="number" min="0" id="v-invalid" class="tiny" data-vote="invalid" value="${esc(ui.voteDraft.invalid ?? '')}"></label>
        </div>
        <div id="vote-preview" class="hint">${votePreviewText()}</div>
        <div class="row end"><button class="btn primary big" data-act="resolve">開票する</button></div>
      </div>`;
  }

  function readVotes() {
    const v = {};
    for (const k of ['X', 'Y', 'Z', 'invalid']) {
      const raw = val('v-' + k);
      v[k] = raw === '' ? 0 : Number(raw);
    }
    return v;
  }

  const REASONS = {
    top: '最多票の数字が有効',
    tiePromote: '同率1位のため、次点が繰り上がり有効',
    allTie: '全て同率のため、全て有効',
    quorum: '投票数が過半数に届かず、全て無効',
    noBall: '出玉なし',
  };

  function votePreviewText() {
    if (!game || game.phase !== 'vote') return '';
    const v = readVotes();
    const j = B.judgeVotes(game.current.drawn, v, B.minVotes(game));
    return `判定プレビュー：投票数 ${j.total} 票 → ${j.valid.length ? `<b>${j.valid.join('・')}</b> が有効` : '<b class="bad">有効なし</b>'}（${REASONS[j.reason]}）`;
  }

  function renderResolved() {
    const r = game.current.result;
    const j = r.judge;
    const last = game.turn >= game.settings.totalTurns;
    return `
      <h2>③ 開票結果</h2>
      <div class="drawn-row">${j.counts
        .map((c) => `<div class="slot ${j.valid.includes(c.number) ? 'win' : 'lose'}"><div class="sl">${c.slot}</div>${ballChip(c.number, 'big')}<div class="votes">${c.votes}票</div></div>`)
        .join('')}</div>
      <p><b>${j.valid.length ? j.valid.join('・') + ' が有効' : '有効なし'}</b>　<span class="muted">${REASONS[j.reason]}（投票 ${j.total} 票・無効 ${game.current.votes.invalid} 票）</span></p>
      <div class="grid2">
        <div class="sub-block">
          <div class="label">ビンゴ成立（秘匿）</div>
          ${
            r.newLines.length
              ? `<ul class="list">${r.newLines.map((l) => `<li>${esc(pname(l.playerId))}：${B.LINE_NAMES[l.line]} → 通算 <b>${l.k}列目</b>（次ターンに ${pct(B.rateOf(game.settings, l.k))} 強奪可）</li>`).join('')}</ul>`
              : '<p class="muted">新たな成立なし</p>'
          }
        </div>
        <div class="sub-block">
          <div class="label">強奪の処理結果（秘匿）</div>
          ${
            r.steals.length
              ? `<ul class="list">${r.steals.map((x) => `<li>${esc(pname(x.attackerId))} ← ${esc(pname(x.targetId))}：${x.k}列目 ${pct(x.rate)} = <b>${yen(x.amount)}</b></li>`).join('')}</ul>`
              : '<p class="muted">強奪なし</p>'
          }
          ${r.io.length ? `<div class="label">IN/OUT（次ターン開始時に反映）</div><ul class="list">${r.io.map((m) => `<li>${m.number}：IN ${m.in} / OUT ${m.out} → ${m.dir ? m.dir.toUpperCase() : '移動なし'}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
      <div class="row end"><button class="btn primary big" data-act="next">${last ? '最終強奪の受付へ' : '次のターンへ'}</button></div>`;
  }

  function renderFinalSteal() {
    return `
      <h2>最終強奪の受付</h2>
      <p class="hint">${game.settings.totalTurns}ターン目のビンゴ成立で得た強奪の権利を受け付けます。</p>
      ${stealBlock(game.turn, `${game.turn}ターン目に成立した列の権利`)}
      <div class="row end"><button class="btn primary big" data-act="close-final">最終強奪を確定して精算へ</button></div>`;
  }

  function bonusOf(p) {
    const s = game.settings;
    return p.lines.length >= B.LINES.length ? s.bonusAllLines : p.lines.length === 0 ? -s.penaltyNoLine : 0;
  }

  function renderSettle() {
    return `
      <h2>最終精算</h2>
      <p class="hint">プレイヤーが提出した所持マネー（チップ）を入力してください。最終所持マネー = 口座残高 + 提出チップ + ボーナス/ペナルティ（全8列成立 +${yen(game.settings.bonusAllLines)}／1列も成立なし −${yen(game.settings.penaltyNoLine)}）。</p>
      <table class="table">
        <thead><tr><th>名前</th><th>No.</th><th>成立列</th><th class="num">口座残高</th><th>提出チップ</th><th class="num">ボーナス</th></tr></thead>
        <tbody>${game.players
          .map(
            (p) => `<tr><td>${esc(p.name)}</td><td>${p.number}</td><td>${p.lines.length} / 8</td><td class="num">${p.balance.toLocaleString()}</td>
            <td><input type="number" min="0" step="10000" id="chips-${p.id}" value="${esc(ui.chipsDraft[p.id] ?? '')}" data-chips="${p.id}" placeholder="例 1100000"></td>
            <td class="num ${bonusOf(p) > 0 ? 'good' : bonusOf(p) < 0 ? 'bad' : ''}">${bonusOf(p) ? signed(bonusOf(p)) : '—'}</td></tr>`
          )
          .join('')}</tbody>
      </table>
      <div class="row end"><button class="btn primary big" data-act="finish">最終結果を確定</button></div>`;
  }

  function renderFinal() {
    const f = game.final;
    return `
      <h2>最終結果</h2>
      <p class="hint">差し引き = 最終所持マネー − 初期配布 ${yen(f.initial)}。差し引きが0以上なら「事務局に対する勝利」。</p>
      <table class="table">
        <thead><tr><th>順位</th><th>名前</th><th>No.</th><th>口座</th><th>成立列</th><th class="num">口座残高</th><th class="num">チップ</th><th class="num">ボーナス</th><th class="num">最終</th><th class="num">差し引き</th></tr></thead>
        <tbody>${f.ranking
          .map((r) => {
            const p = player(r.playerId);
            return `<tr class="${r.rank === 1 ? 'winner' : ''}"><td><b>${r.rank}</b></td><td>${esc(p.name)}</td><td>${p.number}</td><td>${p.account}</td><td>${r.lines}</td>
            <td class="num">${r.balance.toLocaleString()}</td><td class="num">${r.chips.toLocaleString()}</td><td class="num">${r.bonus ? signed(r.bonus) : '—'}</td>
            <td class="num"><b>${r.total.toLocaleString()}</b></td><td class="num ${r.net >= 0 ? 'good' : 'bad'}">${signed(r.net)}</td></tr>`;
          })
          .join('')}</tbody>
      </table>`;
  }

  function renderBalls() {
    const order = game.validOrder.map((v) => v.number);
    return `
      <h2>玉の状況</h2>
      <div class="ballgrid">${Object.keys(game.balls)
        .map(Number)
        .sort((a, b) => a - b)
        .map((n) => ballChip(n))
        .join('')}</div>
      <div class="legend">${Object.entries(B.BALL_STATES)
        .map(([k, l]) => `<span><span class="ball ${k} mini"></span>${l} ${B.ballsIn(game, k).length}</span>`)
        .join('')}</div>
      <p class="hint">有効になった順：${order.length ? order.join(' → ') : 'なし'}</p>`;
  }

  function renderLedger() {
    const hide = ui.hideSecrets;
    const valid = new Set(B.ballsIn(game, 'valid'));
    const rightTurn = game.phase === 'finalSteal' ? game.turn : game.turn - 1;
    return `
      <div class="row between">
        <h2>プレイヤー台帳 <span class="tag">秘匿</span></h2>
        <label class="check"><input type="checkbox" data-act="toggle-hide" ${hide ? 'checked' : ''}> No.・口座記号を隠す</label>
      </div>
      <div class="table-wrap">
      <table class="table ledger">
        <thead><tr><th>名前</th><th>No.</th><th>口座</th><th>カード</th><th>成立列</th><th>強奪の権利</th><th class="num">口座残高</th></tr></thead>
        <tbody>${game.players
          .map((p) => {
            const lineCells = new Set(p.lines.flatMap((l) => B.LINES[l.line]));
            const rights = B.rightsFrom(p, rightTurn);
            return `<tr>
              <td>${esc(p.name)}</td><td class="secret">${hide ? '•' : p.number}</td><td class="secret">${hide ? '•' : p.account}</td>
              <td><div class="mini-card">${p.card.map((n, i) => `<span class="${valid.has(n) ? 'hit' : ''} ${lineCells.has(i) ? 'line' : ''}">${n}</span>`).join('')}</div></td>
              <td>${p.lines.length} / 8</td>
              <td>${rights.length ? rights.map((k) => `${k}列目（${pct(B.rateOf(game.settings, k))}）`).join('、') : '<span class="muted">—</span>'}</td>
              <td class="num"><b>${p.balance.toLocaleString()}</b></td></tr>`;
          })
          .join('')}</tbody>
      </table>
      </div>`;
  }

  const LEDGER_LABEL = {
    steal: (x) => `強奪：${esc(pname(x.playerId))} ← ${esc(pname(x.targetId))} ${x.k}列目 ${pct(x.rate)} ${yen(x.amount)}`,
    change: (x) => `変更カード：${esc(pname(x.playerId))} マス${x.cell + 1} ${x.before} → ${x.after}`,
    exclude: (x) => `除外カード：${x.number}（${B.BALL_STATES[x.from]}から）`,
    adjust: (x) => `補正：${esc(pname(x.playerId))} 口座 ${signed(x.delta)}${x.memo ? '　' + esc(x.memo) : ''}`,
    ball: (x) => `玉の補正：${x.number} ${B.BALL_STATES[x.from]} → ${B.BALL_STATES[x.to]}${x.memo ? '　' + esc(x.memo) : ''}`,
  };

  function renderHistory() {
    const turns = game.history.slice().reverse();
    return `<h2>履歴</h2>${
      turns.length
        ? turns
            .map((h) => {
              const entries = game.ledger.filter((x) => x.turn === h.turn);
              return `<details class="hist"><summary>ターン ${h.turn}：出玉 ${h.drawn.map((d) => d.number).join('・') || 'なし'} → 有効 ${h.judge.valid.join('・') || 'なし'}／成立 ${h.newLines.length}列／強奪 ${h.steals.length}件</summary>
                <p class="muted">票数 ${h.judge.counts.map((c) => `${c.slot}(${c.number}) ${c.votes}`).join('、')}・無効 ${h.votes.invalid}（${REASONS[h.judge.reason]}）</p>
                <ul class="list">${entries.map((x) => `<li>${LEDGER_LABEL[x.type](x)}</li>`).join('') || '<li class="muted">取引記録なし</li>'}</ul>
              </details>`;
            })
            .join('')
        : '<p class="muted">まだ確定したターンはありません</p>'
    }`;
  }

  function renderDisplayControl() {
    const modes = [
      ['title', 'タイトル'],
      ['timer', 'タイマー'],
    ];
    if (game) modes.push(['drawn', '出玉'], ['result', '開票結果'], ['board', '玉の状況'], ['balances', '口座残高'], ['io', 'IN/OUT発表']);
    if (game && game.phase === 'finished') modes.push(['final', '最終結果']);
    const running = !!ui.timer.endsAt;
    const n = game ? game.players.length : 0;
    return `
      <h2>発表画面</h2>
      <div class="mode-grid">${modes.map(([k, l]) => `<button class="btn ${ui.displayMode === k ? 'primary' : ''}" data-act="mode" data-mode="${k}">${l}</button>`).join('')}</div>
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
        <div class="row gap wrap">${[3, 5, 7, 10].map((m) => `<button class="btn small ghost" data-act="timer-set" data-min="${m}">${m}分</button>`).join('')}</div>
        <div class="row gap"><button class="btn ${running ? '' : 'primary'}" data-act="timer-toggle">${running ? '一時停止' : 'スタート'}</button><button class="btn ghost" data-act="timer-reset">リセット</button></div>
      </div>
      <p class="hint">発表画面には公開情報（出玉・票数・有効数字・玉の状況・口座記号ごとの残高など）のみが送られます。口座記号が誰のものか、誰が誰から強奪したか、各自のカードは表示されません。</p>`;
  }

  function renderAdjust() {
    const opts = game.players.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
    return `
      <h2>手動補正</h2>
      <div class="form-col">
        <label class="field">プレイヤー<select id="ad-player">${opts}</select></label>
        <label class="field">口座残高の増減（マイナス可）<input type="number" id="ad-delta" step="10000" placeholder="例: -100000"></label>
        <label class="field">理由<input type="text" id="ad-memo" placeholder="任意"></label>
        <button class="btn" data-act="adjust">口座を補正</button>
      </div>
      <details class="sub-block">
        <summary>玉の位置を補正</summary>
        <div class="form-col">
          <label class="field">数字<input type="number" min="1" max="${game.settings.maxBall}" id="bm-number"></label>
          <label class="field">移動先<select id="bm-to">${['machine', 'pool', 'trash', 'excluded'].map((k) => `<option value="${k}">${B.BALL_STATES[k]}</option>`).join('')}</select></label>
          <label class="field">理由<input type="text" id="bm-memo" placeholder="任意"></label>
          <button class="btn" data-act="ball-move">玉を移動</button>
        </div>
      </details>`;
  }

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

  const actions = {
    'open-display'() {
      const w = window.open('display.html', 'robberBingoDisplay');
      Store.registerDisplayWindow(w);
      setTimeout(publish, 600);
      setTimeout(publish, 1500);
    },
    undo,
    export() {
      const blob = new Blob([JSON.stringify({ app: 'robber-bingo', exportedAt: new Date().toISOString(), game }, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `robber-bingo-turn${game.turn}-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '')}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    },
    'new-game'() {
      if (!confirm('現在のゲームを終了して新規ゲームを準備しますか？（「元に戻す」で復帰できます）')) return;
      ui.setup = null;
      ui.reveal = 0;
      ui.chipsDraft = {};
      ui.displayMode = 'title';
      commit(null);
    },
    'setup-random'() {
      const s = ui.setup;
      const a = B.randomAssignment(s.rows.map((r) => r.name || 'x'));
      s.rows.forEach((r, i) => {
        r.number = a[i].number;
        r.account = a[i].account;
      });
      saveUi();
      render();
    },
    'setup-cards'() {
      ui.setup.rows.forEach((r) => (r.card = B.randomCard()));
      saveUi();
      render();
    },
    'setup-start'() {
      const s = ui.setup;
      attempt(
        () =>
          B.createGame(
            s.rows.map((r) => ({ name: r.name, number: r.number, account: r.account, card: r.card.map((c) => (c === '' ? NaN : Number(c))) })),
            { totalTurns: Number(s.totalTurns) || 15 }
          ),
        { ok: 'ゲームを開始しました', displayMode: 'title' }
      );
    },
    draw() {
      const want = Math.min(game.settings.drawCount, B.ballsIn(game, 'machine').length);
      const nums = B.SLOTS.slice(0, want).map((sl) => Number(val('draw-' + sl)));
      attempt(() => B.setDrawn(game, nums), { displayMode: 'drawn', ok: '出玉を登録しました' });
    },
    'draw-random'() {
      attempt(() => B.drawRandom(game), { displayMode: 'drawn' });
    },
    'steal-add'() {
      const [id, k] = val('st-right').split(':');
      attempt(() => B.addSteal(game, id, val('st-target'), Number(k)), { ok: '強奪申請を追加しました' });
    },
    'steal-del'(el) {
      attempt(() => B.removeSteal(game, Number(el.dataset.i)));
    },
    'io-add'() {
      attempt(() => B.addInOut(game, Number(val('io-number')), val('io-dir')));
    },
    'io-del'(el) {
      attempt(() => B.removeInOut(game, Number(el.dataset.i)));
    },
    change() {
      attempt(() => B.applyChange(game, val('ch-player'), Number(val('ch-cell')), Number(val('ch-number'))), { ok: 'カードを変更しました' });
    },
    exclude() {
      attempt(() => B.applyExclude(game, Number(val('ex-number'))), { ok: '玉を除外しました', displayMode: 'board' });
    },
    resolve() {
      const v = readVotes();
      if (attempt(() => B.resolveTurn(game, v), { displayMode: 'result', ok: '開票しました' })) {
        ui.voteDraft = {};
        saveUi();
      }
    },
    next() {
      const prevMoved = game.current.result.steals.some((x) => x.amount > 0);
      if (!attempt(() => B.nextTurn(game))) return;
      // 口座の移動があれば途中発表、なければ実際に玉が動いた時だけIN/OUT発表
      const ev = game.startEvents;
      const ballsMoved = ev && (ev.io.some((m) => !m.skipped) || ev.refilled.length);
      ui.displayMode = game.phase === 'finalSteal' ? 'title' : prevMoved ? 'balances' : ballsMoved ? 'io' : 'title';
      saveUi();
      render();
      publish();
    },
    'close-final'() {
      attempt(() => B.closeFinalSteal(game), { displayMode: 'balances' });
    },
    finish() {
      const chips = {};
      game.players.forEach((p) => (chips[p.id] = val('chips-' + p.id) === '' ? NaN : Number(val('chips-' + p.id))));
      if (attempt(() => B.finishGame(game, chips), { displayMode: 'final', ok: 'ゲーム終了' })) {
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
    adjust() {
      attempt(() => B.adjustBalance(game, val('ad-player'), Number(val('ad-delta')), val('ad-memo')), { ok: '口座を補正しました' });
    },
    'ball-move'() {
      attempt(() => B.setBallState(game, Number(val('bm-number')), val('bm-to'), val('bm-memo')), { ok: '玉を移動しました' });
    },
  };

  document.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act]');
    if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const fn = actions[el.dataset.act];
    if (fn) fn(el);
  });

  document.addEventListener('change', (ev) => {
    const el = ev.target;
    if (el.dataset.act === 'toggle-hide') return actions['toggle-hide'](el);
    if (el.dataset.act === 'import') return importFile(el);
    if (el.dataset.setup) {
      const s = ui.setup;
      if (el.dataset.setup === 'count') {
        const n = Math.max(2, Math.min(26, Number(el.value) || 2));
        s.count = n;
        s.rows = Array.from({ length: n }, (_, i) => s.rows[i] || makeRow(i));
        saveUi();
        render();
      } else {
        s[el.dataset.setup] = el.value;
        saveUi();
      }
    }
  });

  document.addEventListener('input', (ev) => {
    const el = ev.target;
    if (el.dataset.row !== undefined) {
      const row = ui.setup.rows[Number(el.dataset.row)];
      if (el.dataset.cell !== undefined) row.card[Number(el.dataset.cell)] = el.value;
      else {
        const key = el.dataset.key;
        row[key] = key === 'number' ? Number(el.value) : key === 'account' ? el.value.toUpperCase() : el.value;
      }
      saveUi();
    } else if (el.dataset.vote !== undefined) {
      ui.voteDraft[el.dataset.vote] = el.value;
      saveUi();
      const box = document.getElementById('vote-preview');
      if (box) box.innerHTML = votePreviewText();
    } else if (el.dataset.chips) {
      ui.chipsDraft[el.dataset.chips] = el.value;
      saveUi();
    }
  });

  function importFile(input) {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        const g = data.game || data;
        if (!g || g.game !== 'robber-bingo' || g.schema !== B.SCHEMA) throw new Error('強奪ビンゴの保存データではありません');
        commit(g);
        toast('読み込みました', 'ok');
      } catch (e) {
        toast('読込に失敗しました: ' + e.message, 'error');
      }
    };
    reader.readAsText(file);
  }

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

  window.addEventListener('storage', (ev) => {
    if (ev.key === REQUEST) publish();
  });
  try {
    new BroadcastChannel(REQUEST).onmessage = () => publish();
  } catch (e) {
    /* ignore */
  }

  render();
  publish();
})();
