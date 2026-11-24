/* 強奪ビンゴ 発表ツール（プロジェクター用）
 * 集計ツールから送られる公開情報（publicView）だけを表示する。 */
(function () {
  'use strict';

  const Store = window.RobberBingoStore;
  const $stage = document.getElementById('stage');
  const REQUEST = 'robberBingo.request.v1';
  let payload = Store.loadPublic();
  let lastKey = '';

  const STATE_LABEL = { machine: 'マシーン', drawn: '出玉', pool: 'プール', valid: '有効', trash: 'トラッシュ', excluded: '除外' };
  const REASONS = {
    top: '最多票の数字が有効',
    tiePromote: '同率1位のため、次点が繰り上がり有効',
    allTie: '全て同率のため、全て有効',
    quorum: '投票数が過半数に届かず、このターンの投票は全て無効',
    noBall: '出玉なし',
  };

  const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const money = (n) => Number(n).toLocaleString('ja-JP');
  const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + Math.abs(n).toLocaleString('ja-JP');
  const fmtTime = (ms) => {
    const t = Math.ceil(Math.max(0, ms) / 1000);
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  };
  function timer() {
    return (payload && payload.display && payload.display.timer) || null;
  }
  function remaining() {
    const t = timer();
    return t ? (t.endsAt ? t.endsAt - Date.now() : t.remainingMs) : 0;
  }
  function running() {
    const t = timer();
    return !!(t && t.endsAt && t.endsAt > Date.now());
  }

  function header(v, title) {
    return `<header class="hd">
      <div class="hd-l"><span class="mark">強奪ビンゴ</span>${title ? `<span class="hd-title">${title}</span>` : ''}</div>
      <div class="hd-r"><span class="mini-timer" data-timer></span>${v ? `<span class="turn">TURN <b>${Math.min(v.turn, v.totalTurns)}</b><small> / ${v.totalTurns}</small></span>` : ''}</div>
    </header>`;
  }

  function ball(n, cls, d) {
    return `<span class="ball ${cls || ''}" ${d != null ? `style="--d:${d}ms"` : ''}>${n}</span>`;
  }

  function sceneTitle(v) {
    return `<section class="scene title">
      <div class="kicker">PUZZLIAR &nbsp;·&nbsp; ROBBER BINGO</div>
      <h1>強奪ビンゴ</h1>
      <div class="title-sub">${!v ? 'まもなく開始' : v.phase === 'finished' ? 'GAME OVER' : v.phase === 'finalSteal' || v.phase === 'settle' ? 'FINAL' : `TURN ${v.turn} / ${v.totalTurns}`}</div>
    </section>`;
  }

  function sceneDrawn(v) {
    const d = v.drawn || [];
    return `${header(v, `TURN ${v.turn} 出玉`)}
    <section class="scene">
      ${
        d.length
          ? `<div class="slots">${d
              .map((x, i) => `<div class="slot reveal-in" style="--d:${i * 500}ms"><div class="sl">${x.slot}</div>${ball(x.number, 'huge drawn')}</div>`)
              .join('')}</div>
            <p class="foot">X・Y・Z のいずれかを ○ で囲んで投票してください。最多票の数字が有効になります。</p>`
          : `<div class="center-msg">抽選中…</div>`
      }
    </section>`;
  }

  function sceneResult(v) {
    const r = v.result;
    if (!r) return `${header(v, '開票結果')}<section class="scene"><div class="center-msg">開票前です</div></section>`;
    const max = Math.max(1, ...r.counts.map((c) => c.votes));
    return `${header(v, `TURN ${r.turn} 開票結果`)}
    <section class="scene">
      <div class="slots">${r.counts
        .map((c, i) => {
          const win = r.valid.includes(c.number);
          return `<div class="slot result ${win ? 'win' : 'lose'} reveal-in" style="--d:${i * 300}ms">
            <div class="sl">${c.slot}</div>${ball(c.number, 'huge ' + (win ? 'valid' : 'pool'))}
            <div class="bar"><span style="width:${(c.votes / max) * 100}%"></span></div>
            <div class="votes">${c.votes}<small>票</small></div>
            ${win ? '<div class="stamp">有効</div>' : ''}
          </div>`;
        })
        .join('')}</div>
      <p class="verdict reveal-in" style="--d:1200ms">${REASONS[r.reason]}<small>投票 ${r.total} 票・無効 ${r.invalid} 票・有効に必要 ${v.minVotes} 票以上</small></p>
    </section>`;
  }

  function sceneBoard(v) {
    const counts = {};
    v.balls.forEach((b) => (counts[b.state] = (counts[b.state] || 0) + 1));
    return `${header(v, '玉の状況')}
    <section class="scene board">
      <div class="ballgrid">${v.balls.map((b) => ball(b.number, b.state)).join('')}</div>
      <div class="legend">${Object.keys(STATE_LABEL)
        .map((k) => `<span>${ball('', 'dot ' + k)}${STATE_LABEL[k]} <b>${counts[k] || 0}</b></span>`)
        .join('')}</div>
      <div class="order">有効になった順：${v.validOrder.length ? v.validOrder.map((o) => `<b>${o.number}</b>`).join(' → ') : 'なし'}</div>
    </section>`;
  }

  function sceneBalances(v) {
    return `${header(v, '口座残高 途中発表')}
    <section class="scene">
      <div class="accounts">${v.accounts
        .map(
          (a, i) => `<div class="acc reveal-in" style="--d:${i * 70}ms"><div class="letter">${esc(a.account)}</div><div class="bal">${money(a.balance)}<small>L$</small></div></div>`
        )
        .join('')}</div>
      <p class="foot">どの口座が誰のものか、誰が誰から強奪したかは公開されません。</p>
    </section>`;
  }

  function sceneIO(v) {
    const ev = v.startEvents || { io: [], refilled: [] };
    const done = ev.io.filter((m) => !m.skipped);
    const ins = done.filter((m) => m.dir === 'in').map((m) => m.number);
    const outs = done.filter((m) => m.dir === 'out').map((m) => m.number);
    const block = (label, nums, cls) =>
      `<div class="io-col"><div class="io-label ${cls}">${label}</div><div class="io-balls">${nums.length ? nums.map((n, i) => ball(n, 'big ' + (cls === 'in' ? 'machine' : 'trash') + ' reveal-in', i * 200)).join('') : '<span class="none">なし</span>'}</div></div>`;
    return `${header(v, `TURN ${v.turn} 開始前の玉の移動`)}
    <section class="scene">
      <div class="io">${block('IN', ins, 'in')}${block('OUT', outs, 'out')}</div>
      ${ev.io.some((m) => m.skipped) ? `<p class="foot">対象外のため移動なし：${ev.io.filter((m) => m.skipped).map((m) => `${m.number} ${m.dir.toUpperCase()}`).join('、')}</p>` : ''}
      ${ev.refilled.length ? `<p class="foot">マシーンが空になったため、プールの玉 ${ev.refilled.length} 個をマシーンに戻しました。</p>` : ''}
    </section>`;
  }

  function sceneTimer(v) {
    return `${header(v, '投票受付')}
    <section class="scene timer-scene">
      <div class="big-timer" data-timer-big></div>
      <div class="timer-label" data-timer-label></div>
    </section>`;
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
          <td class="id">${shown ? `No.${r.number}・口座${esc(r.account)}・${r.lines}列` : ''}</td>
          <td class="tot">${shown ? `${money(r.total)}<small> L$</small>` : ''}</td>
          <td class="net ${shown ? (r.net >= 0 ? 'pos' : 'neg') : ''}">${shown ? signed(r.net) : ''}${shown && r.net >= 0 ? '<span class="badge">事務局に勝利</span>' : ''}</td>
        </tr>`;
      })
      .join('');
    const champ = reveal === n ? f.ranking.filter((r) => r.rank === 1) : [];
    return `${header(v, '最終結果')}
    <section class="scene final" style="--rows:${n}">
      ${champ.length ? `<div class="winner reveal-in">WINNER<b>${champ.map((c) => esc(c.name)).join('・')}</b></div>` : ''}
      <table class="ranking"><tbody>${rows}</tbody></table>
      <p class="foot">最終所持マネー = 口座残高 + チップ + ボーナス/ペナルティ　／　差し引き = 最終 − ${money(f.initial)} L$</p>
    </section>`;
  }

  const SCENES = { title: sceneTitle, drawn: sceneDrawn, result: sceneResult, board: sceneBoard, balances: sceneBalances, io: sceneIO, timer: sceneTimer, final: sceneFinal };

  function render() {
    const v = payload && payload.view;
    let mode = (payload && payload.display && payload.display.mode) || 'title';
    if (!v && mode !== 'timer') mode = 'title';
    const scene = SCENES[mode] || sceneTitle;
    const key = JSON.stringify([mode, v, payload && payload.display && payload.display.reveal]);
    if (key !== lastKey) {
      lastKey = key;
      $stage.className = 'stage mode-' + mode;
      $stage.innerHTML = scene(v);
    }
    tick();
  }

  function tick() {
    const rem = remaining();
    const run = running();
    const mini = document.querySelector('[data-timer]');
    if (mini) {
      mini.textContent = run ? fmtTime(rem) : '';
      mini.classList.toggle('urgent', run && rem <= 60000);
    }
    const big = document.querySelector('[data-timer-big]');
    if (big) {
      const over = rem <= 0;
      big.textContent = over ? 'TIME UP' : fmtTime(rem);
      big.classList.toggle('urgent', rem <= 60000);
      big.classList.toggle('over', over);
      big.classList.toggle('paused', !run && !over);
      const label = document.querySelector('[data-timer-label]');
      if (label) label.textContent = over ? '投票を締め切りました' : run ? '残り時間' : '一時停止中';
    }
  }

  Store.subscribe((msg) => {
    payload = msg;
    render();
  });
  setInterval(tick, 200);

  try {
    new BroadcastChannel(REQUEST).postMessage('hello');
  } catch (e) {
    /* ignore */
  }
  try {
    localStorage.setItem(REQUEST, String(Date.now()));
  } catch (e) {
    /* ignore */
  }

  function toggleFs() {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (document.documentElement.requestFullscreen) document.documentElement.requestFullscreen().catch(() => {});
  }
  document.getElementById('fs').addEventListener('click', toggleFs);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'f' || e.key === 'F') toggleFs();
  });

  render();
})();
