/*
 * 強奪ビンゴ ルールエンジン
 * ルール出典：強奪ビンゴ_ルールブック_単ページ.pdf（2026-06）
 *
 * UI から独立した純粋なロジック。ブラウザでは window.RobberBingo、
 * Node.js では require('./engine.js') で利用できる。
 * 操作関数は state を破壊せず、新しい state を返す。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.RobberBingo = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 1;
  const SLOTS = ['X', 'Y', 'Z'];
  const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');
  // 3×3カードのマス番号（左上0〜右下8）で表した8列
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // ヨコ
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // タテ
    [0, 4, 8], [2, 4, 6], // ナナメ
  ];
  const LINE_NAMES = ['ヨコ1', 'ヨコ2', 'ヨコ3', 'タテ1', 'タテ2', 'タテ3', 'ナナメ＼', 'ナナメ／'];

  const DEFAULT_SETTINGS = Object.freeze({
    totalTurns: 15,
    maxBall: 27,
    drawCount: 3,
    initialChips: 1100000,
    initialAccount: 2000000,
    // n列目の強奪割合
    stealRates: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.8, 1.0],
    excludeFromTurn: 9,
    bonusAllLines: 1000000,
    penaltyNoLine: 1000000,
    prices: { inout: 20000, change: 400000, exclude: 250000 },
  });

  const PHASES = {
    draw: '抽選',
    vote: '投票・強奪受付',
    resolved: '開票結果',
    finalSteal: '最終強奪受付',
    settle: '最終精算',
    finished: 'ゲーム終了',
  };

  const BALL_STATES = { machine: 'マシーン', drawn: '出玉', pool: 'プール', valid: '有効', trash: 'トラッシュ', excluded: '除外' };

  class RuleError extends Error {
    constructor(message) {
      super(message);
      this.name = 'RuleError';
    }
  }

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const isInt = (n) => typeof n === 'number' && Number.isInteger(n);
  function assert(cond, message) {
    if (!cond) throw new RuleError(message);
  }
  function assertPhase(state, phases) {
    assert(phases.includes(state.phase), `現在のフェーズ（${PHASES[state.phase]}）ではこの操作はできません`);
  }
  function getPlayer(state, id) {
    const p = state.players.find((x) => x.id === id);
    assert(p, `プレイヤーが見つかりません: ${id}`);
    return p;
  }
  function addLedger(state, entry) {
    state.ledger.push(Object.assign({ turn: state.turn, at: state.ledgerSeq++ }, entry));
  }
  function shuffle(arr, rng) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function mergeSettings(o) {
    const s = clone(DEFAULT_SETTINGS);
    if (o) for (const [k, v] of Object.entries(o)) if (v !== undefined) s[k] = clone(v);
    return s;
  }

  // ---------- setup ----------

  function validateCard(card, maxBall, label) {
    assert(Array.isArray(card) && card.length === 9, `${label}: ビンゴカードは9マス必要です`);
    const seen = new Set();
    card.forEach((n) => {
      assert(isInt(n) && n >= 1 && n <= maxBall, `${label}: カードの数字は1〜${maxBall}で入力してください`);
      assert(!seen.has(n), `${label}: カード内で数字 ${n} が重複しています`);
      seen.add(n);
    });
  }

  /** ランダムなビンゴカード（9マス） */
  function randomCard(rng, maxBall) {
    rng = rng || Math.random;
    return shuffle(
      Array.from({ length: maxBall || DEFAULT_SETTINGS.maxBall }, (_, i) => i + 1),
      rng
    ).slice(0, 9);
  }

  /** 番号・口座記号をランダムに割り振った初期入力（セットアップ補助） */
  function randomAssignment(names, rng) {
    rng = rng || Math.random;
    const n = names.length;
    const nums = shuffle(Array.from({ length: n }, (_, i) => i + 1), rng);
    const accs = shuffle(LETTERS.slice(0, n), rng);
    return names.map((name, i) => ({ name, number: nums[i], account: accs[i], card: randomCard(rng) }));
  }

  /** players: [{ name, number, account(口座記号), card: [9] }] */
  function createGame(playersInput, settingsOverrides) {
    const settings = mergeSettings(settingsOverrides);
    assert(Array.isArray(playersInput) && playersInput.length >= 2, 'プレイヤーを2人以上入力してください');
    const names = new Set();
    const numbers = new Set();
    const accounts = new Set();
    const players = playersInput.map((p, i) => {
      const name = String(p.name || '').trim();
      const number = Number(p.number);
      const account = String(p.account || '').trim().toUpperCase();
      assert(name, `${i + 1}行目: 名前が空です`);
      assert(!names.has(name), `名前「${name}」が重複しています`);
      assert(isInt(number) && number >= 1, `${name}: プレイヤーNo.が不正です`);
      assert(!numbers.has(number), `プレイヤーNo. ${number} が重複しています`);
      assert(/^[A-Z]$/.test(account), `${name}: 口座記号はアルファベット1文字で指定してください`);
      assert(!accounts.has(account), `口座記号 ${account} が重複しています`);
      const card = (p.card || []).map(Number);
      validateCard(card, settings.maxBall, name);
      names.add(name);
      numbers.add(number);
      accounts.add(account);
      return { id: 'p' + (i + 1), name, number, account, card, balance: settings.initialAccount, lines: [], chips: null };
    });
    const balls = {};
    for (let n = 1; n <= settings.maxBall; n++) balls[n] = 'machine';
    return {
      schema: SCHEMA,
      game: 'robber-bingo',
      settings,
      players,
      balls,
      validOrder: [],
      turn: 1,
      phase: 'draw',
      current: emptyTurn(),
      pendingIO: [],
      startEvents: null,
      history: [],
      ledger: [],
      ledgerSeq: 0,
      final: null,
    };
  }

  function emptyTurn() {
    return { drawn: [], votes: null, steals: [], inout: [], changes: [], excludes: [], result: null };
  }

  // ---------- helpers on state ----------

  function ballsIn(state, where) {
    return Object.keys(state.balls)
      .map(Number)
      .filter((n) => state.balls[n] === where)
      .sort((a, b) => a - b);
  }

  function validSet(state) {
    return new Set(ballsIn(state, 'valid'));
  }

  /** そのカードで揃っている列（マス番号ベース） */
  function completeLines(card, valid) {
    return LINES.map((cells, i) => (cells.every((c) => valid.has(card[c])) ? i : -1)).filter((i) => i >= 0);
  }

  /** プレイヤーが turn に成立させた列の通算番号（強奪の権利） */
  function rightsFrom(player, turn) {
    return player.lines.filter((l) => l.turn === turn).map((l) => l.k);
  }

  function rateOf(settings, k) {
    return settings.stealRates[Math.min(k, settings.stealRates.length) - 1];
  }

  function minVotes(state) {
    return Math.floor(state.players.length / 2) + 1;
  }

  // ---------- phase: draw ----------

  /**
   * ターン開始処理：前ターンのIN/OUTを反映し、マシーンが空ならプールを戻す。
   * draw フェーズに入る時点で自動的に呼ばれる（beginTurn）。
   */
  function beginTurn(state) {
    const s = state;
    const events = { io: [], refilled: [] };
    for (const m of s.pendingIO) {
      const where = s.balls[m.number];
      if (m.dir === 'in' && (where === 'pool' || where === 'trash')) {
        s.balls[m.number] = 'machine';
        events.io.push(m);
      } else if (m.dir === 'out' && (where === 'machine' || where === 'pool')) {
        s.balls[m.number] = 'trash';
        events.io.push(m);
      } else {
        events.io.push(Object.assign({ skipped: true }, m));
      }
    }
    s.pendingIO = [];
    if (ballsIn(s, 'machine').length === 0) {
      for (const n of ballsIn(s, 'pool')) {
        s.balls[n] = 'machine';
        events.refilled.push(n);
      }
    }
    s.startEvents = events;
    return s;
  }

  /** 出玉を登録（出た順に X, Y, Z） */
  function setDrawn(state, numbers) {
    assertPhase(state, ['draw']);
    const s = clone(state);
    const machine = ballsIn(s, 'machine');
    const want = Math.min(s.settings.drawCount, machine.length);
    assert(Array.isArray(numbers) && numbers.length === want, `出玉は ${want} 個入力してください（マシーン内 ${machine.length} 個）`);
    const seen = new Set();
    numbers.forEach((n) => {
      assert(isInt(n), '出玉の数字が不正です');
      assert(s.balls[n] === 'machine', `${n} はマシーン内にありません（${BALL_STATES[s.balls[n]] || '不明'}）`);
      assert(!seen.has(n), `出玉 ${n} が重複しています`);
      seen.add(n);
    });
    numbers.forEach((n) => (s.balls[n] = 'drawn'));
    s.current.drawn = numbers.map((n, i) => ({ slot: SLOTS[i], number: n }));
    s.phase = 'vote';
    return s;
  }

  /** マシーンからランダムに出玉を引く（物理マシーンを使わない場合・テスト用） */
  function drawRandom(state, rng) {
    const machine = ballsIn(state, 'machine');
    const want = Math.min(state.settings.drawCount, machine.length);
    return setDrawn(state, shuffle(machine, rng || Math.random).slice(0, want));
  }

  // ---------- phase: vote（投票時間中の申請） ----------

  /** 強奪申請：attacker が前ターンに成立させた k 列目の権利で target の口座から奪う */
  function addSteal(state, attackerId, targetId, k) {
    assertPhase(state, ['vote', 'finalSteal']);
    const s = clone(state);
    const a = getPlayer(s, attackerId);
    const t = getPlayer(s, targetId);
    k = Number(k);
    assert(a.id !== t.id, '自分自身からは強奪できません');
    const rightTurn = s.phase === 'finalSteal' ? s.turn : s.turn - 1;
    assert(rightsFrom(a, rightTurn).includes(k), `${a.name} は${s.phase === 'finalSteal' ? '最終ターン' : '前のターン'}に ${k} 列目を成立させていません`);
    assert(!s.current.steals.some((x) => x.attackerId === a.id && x.k === k), `${a.name} の ${k} 列目の権利は申請済みです`);
    s.current.steals.push({ attackerId: a.id, targetId: t.id, k });
    return s;
  }

  function removeSteal(state, index) {
    assertPhase(state, ['vote', 'finalSteal']);
    const s = clone(state);
    s.current.steals.splice(index, 1);
    return s;
  }

  /** IN/OUT申請カード（次ターン開始時に反映） */
  function addInOut(state, number, dir) {
    assertPhase(state, ['vote']);
    const s = clone(state);
    number = Number(number);
    assert(dir === 'in' || dir === 'out', 'IN/OUTの指定が不正です');
    assert(s.balls[number] !== undefined, '数字が不正です');
    assert(s.balls[number] !== 'valid', `${number} は既に有効になっているため対象外です`);
    assert(s.balls[number] !== 'excluded', `${number} は除外済みです`);
    s.current.inout.push({ number, dir });
    return s;
  }

  function removeInOut(state, index) {
    assertPhase(state, ['vote']);
    const s = clone(state);
    s.current.inout.splice(index, 1);
    return s;
  }

  /** 変更カード：プレイヤーのカードの1マスを任意の数字に変更（即時） */
  function applyChange(state, playerId, cell, number) {
    assertPhase(state, ['vote']);
    const s = clone(state);
    const p = getPlayer(s, playerId);
    cell = Number(cell);
    number = Number(number);
    assert(isInt(cell) && cell >= 0 && cell < 9, 'マスの指定が不正です');
    assert(isInt(number) && number >= 1 && number <= s.settings.maxBall, `数字は1〜${s.settings.maxBall}で指定してください`);
    assert(!p.card.includes(number), `${number} は既に ${p.name} のカードにあります`);
    assert(s.balls[number] !== 'valid', `${number} は既に有効になっているため指定できません`);
    const before = p.card[cell];
    p.card[cell] = number;
    s.current.changes.push({ playerId: p.id, cell, before, after: number });
    addLedger(s, { type: 'change', playerId: p.id, cell, before, after: number });
    return s;
  }

  /** 除外カード：有効になっていない玉を1つ完全に除外（9ターン目以降・即時） */
  function applyExclude(state, number) {
    assertPhase(state, ['vote']);
    const s = clone(state);
    number = Number(number);
    assert(s.turn >= s.settings.excludeFromTurn, `除外カードは${s.settings.excludeFromTurn}ターン目以降に使用できます`);
    const where = s.balls[number];
    assert(where !== undefined, '数字が不正です');
    assert(where !== 'valid', `${number} は既に有効になっています`);
    assert(where !== 'excluded', `${number} は既に除外されています`);
    assert(where !== 'drawn', `${number} は今ターンの出玉のため除外できません`);
    s.balls[number] = 'excluded';
    s.current.excludes.push({ number, from: where });
    addLedger(s, { type: 'exclude', number, from: where });
    return s;
  }

  /** 開票（投票数の集計規則） */
  function judgeVotes(drawn, votes, minRequired) {
    const counts = drawn.map((d) => ({ slot: d.slot, number: d.number, votes: Number(votes[d.slot] || 0) }));
    const total = counts.reduce((a, c) => a + c.votes, 0);
    if (!counts.length) return { counts, total, valid: [], reason: 'noBall' };
    if (total < minRequired) return { counts, total, valid: [], reason: 'quorum' };
    const max = Math.max(...counts.map((c) => c.votes));
    const top = counts.filter((c) => c.votes === max);
    if (top.length === counts.length) return { counts, total, valid: counts.map((c) => c.number), reason: 'allTie' };
    if (top.length === 1) return { counts, total, valid: [top[0].number], reason: 'top' };
    // 同率1位 → 次点が繰り上がり有効
    const rest = counts.filter((c) => c.votes < max);
    const next = Math.max(...rest.map((c) => c.votes));
    return { counts, total, valid: rest.filter((c) => c.votes === next).map((c) => c.number), reason: 'tiePromote' };
  }

  /**
   * 開票・ビンゴ判定・強奪処理・IN/OUT集計を行う。
   * votes: { X: 票数, Y: 票数, Z: 票数, invalid: 無効票数 }
   */
  function resolveTurn(state, votes) {
    assertPhase(state, ['vote']);
    const s = clone(state);
    votes = votes || {};
    for (const k of ['X', 'Y', 'Z', 'invalid']) {
      const v = Number(votes[k] || 0);
      assert(isInt(v) && v >= 0, '票数は0以上の整数で入力してください');
    }
    const judge = judgeVotes(s.current.drawn, votes, minVotes(s));
    s.current.votes = { X: Number(votes.X || 0), Y: Number(votes.Y || 0), Z: Number(votes.Z || 0), invalid: Number(votes.invalid || 0) };

    // 出玉の行き先
    for (const d of s.current.drawn) s.balls[d.number] = judge.valid.includes(d.number) ? 'valid' : 'pool';
    judge.valid.forEach((n) => s.validOrder.push({ turn: s.turn, number: n }));

    // ビンゴ成立（列は成立した時点で確定し、以後のカード変更でも取り消さない）
    const valid = validSet(s);
    const newLines = [];
    for (const p of s.players) {
      const have = new Set(p.lines.map((l) => l.line));
      const now = completeLines(p.card, valid).filter((i) => !have.has(i));
      now.forEach((line) => {
        const k = p.lines.length + 1;
        p.lines.push({ line, turn: s.turn, k });
        newLines.push({ playerId: p.id, line, k });
      });
    }

    // 強奪（申請順に処理）
    const steals = processSteals(s);

    // IN/OUT 集計 → 次ターン開始時に反映
    const tally = {};
    for (const m of s.current.inout) {
      tally[m.number] = tally[m.number] || { in: 0, out: 0 };
      tally[m.number][m.dir] += 1;
    }
    const io = Object.entries(tally)
      .map(([n, t]) => ({ number: Number(n), in: t.in, out: t.out, dir: t.in > t.out ? 'in' : t.out > t.in ? 'out' : null }))
      .sort((a, b) => a.number - b.number);
    s.pendingIO = io.filter((x) => x.dir).map((x) => ({ number: x.number, dir: x.dir }));

    s.current.result = { judge, newLines, steals, io };
    s.phase = 'resolved';
    return s;
  }

  function processSteals(s) {
    const results = [];
    for (const st of s.current.steals) {
      const a = getPlayer(s, st.attackerId);
      const t = getPlayer(s, st.targetId);
      const rate = rateOf(s.settings, st.k);
      const amount = Math.max(0, Math.floor(t.balance * rate));
      t.balance -= amount;
      a.balance += amount;
      results.push({ attackerId: a.id, targetId: t.id, k: st.k, rate, amount });
      addLedger(s, { type: 'steal', playerId: a.id, targetId: t.id, k: st.k, rate, amount });
    }
    return results;
  }

  /** ターンを確定して次へ（最終ターン後は最終強奪受付へ） */
  function nextTurn(state) {
    assertPhase(state, ['resolved']);
    const s = clone(state);
    const r = s.current.result;
    s.history.push({
      turn: s.turn,
      drawn: s.current.drawn,
      votes: s.current.votes,
      judge: r.judge,
      newLines: r.newLines,
      steals: r.steals,
      inout: s.current.inout,
      io: r.io,
      changes: s.current.changes,
      excludes: s.current.excludes,
      startEvents: s.startEvents,
      balances: Object.fromEntries(s.players.map((p) => [p.id, p.balance])),
      moneyMoved: r.steals.some((x) => x.amount > 0),
    });
    s.current = emptyTurn();
    if (s.turn >= s.settings.totalTurns) {
      s.phase = 'finalSteal';
      s.startEvents = null;
      return s;
    }
    s.turn += 1;
    s.phase = 'draw';
    return beginTurn(s);
  }

  /** 最終強奪を処理して最終精算へ */
  function closeFinalSteal(state) {
    assertPhase(state, ['finalSteal']);
    const s = clone(state);
    const steals = processSteals(s);
    s.finalSteals = steals;
    s.current = emptyTurn();
    s.phase = 'settle';
    return s;
  }

  // ---------- 最終精算 ----------

  /** chips: { playerId: 提出されたチップ額 } */
  function finishGame(state, chips) {
    assertPhase(state, ['settle']);
    const s = clone(state);
    const set = s.settings;
    const initial = set.initialAccount + set.initialChips;
    for (const p of s.players) {
      const c = Number(chips && chips[p.id]);
      assert(isInt(c) && c >= 0, `${p.name} の提出チップ額を入力してください`);
      p.chips = c;
    }
    const rows = s.players.map((p) => {
      const lineCount = p.lines.length;
      const bonus = lineCount >= LINES.length ? set.bonusAllLines : lineCount === 0 ? -set.penaltyNoLine : 0;
      const total = p.balance + p.chips + bonus;
      return { playerId: p.id, balance: p.balance, chips: p.chips, lines: lineCount, bonus, total, net: total - initial };
    });
    rows.forEach((r) => (r.rank = 1 + rows.filter((q) => q.total > r.total).length));
    rows.sort((a, b) => a.rank - b.rank || getPlayer(s, a.playerId).number - getPlayer(s, b.playerId).number);
    s.final = { initial, ranking: rows };
    s.phase = 'finished';
    return s;
  }

  // ---------- 手動補正 ----------

  function adjustBalance(state, playerId, delta, memo) {
    assert(state.phase !== 'finished', 'ゲームは終了しています');
    assert(isInt(delta) && delta !== 0, '補正額は0以外の整数で入力してください');
    const s = clone(state);
    const p = getPlayer(s, playerId);
    p.balance += delta;
    addLedger(s, { type: 'adjust', playerId: p.id, delta, memo: memo || '' });
    return s;
  }

  function setBallState(state, number, where, memo) {
    assert(state.phase !== 'finished', 'ゲームは終了しています');
    assert(['machine', 'pool', 'trash', 'excluded'].includes(where), '移動先が不正です');
    const s = clone(state);
    assert(s.balls[number] !== undefined, '数字が不正です');
    assert(s.balls[number] !== 'valid' && s.balls[number] !== 'drawn', '有効の玉・出玉は移動できません');
    const from = s.balls[number];
    s.balls[number] = where;
    addLedger(s, { type: 'ball', number, from, to: where, memo: memo || '' });
    return s;
  }

  // ---------- 公開情報 ----------

  /**
   * 発表画面に渡してよい情報のみ。
   * 非公開：どの口座記号が誰か、誰が誰から強奪したか、各自のビンゴカード・成立列。
   */
  function publicView(state) {
    const set = state.settings;
    const balls = Object.keys(state.balls)
      .map(Number)
      .sort((a, b) => a - b)
      .map((n) => ({ number: n, state: state.balls[n] }));
    const accounts = state.players
      .map((p) => ({ account: p.account, balance: p.balance }))
      .sort((a, b) => a.account.localeCompare(b.account));
    const lastMoney = state.history.length ? state.history[state.history.length - 1].moneyMoved : false;
    const view = {
      schema: SCHEMA,
      game: 'robber-bingo',
      turn: state.turn,
      totalTurns: set.totalTurns,
      phase: state.phase,
      phaseLabel: PHASES[state.phase],
      playerCount: state.players.length,
      minVotes: minVotes(state),
      drawn: state.current.drawn,
      balls,
      validOrder: state.validOrder,
      startEvents: state.startEvents,
      accounts,
      balancesMoved: lastMoney || (state.phase === 'settle' && !!(state.finalSteals || []).length),
      result: null,
      final: null,
    };
    let src = null;
    if (state.phase === 'resolved') src = { turn: state.turn, votes: state.current.votes, judge: state.current.result.judge, io: state.current.result.io };
    else if (state.history.length) {
      const h = state.history[state.history.length - 1];
      src = { turn: h.turn, votes: h.votes, judge: h.judge, io: h.io };
    }
    if (src) {
      view.result = {
        turn: src.turn,
        counts: src.judge.counts,
        invalid: src.votes ? src.votes.invalid : 0,
        total: src.judge.total,
        valid: src.judge.valid,
        reason: src.judge.reason,
      };
    }
    if (state.final) {
      view.final = {
        initial: state.final.initial,
        ranking: state.final.ranking.map((r) => {
          const p = getPlayer(state, r.playerId);
          return { rank: r.rank, name: p.name, number: p.number, account: p.account, lines: r.lines, bonus: r.bonus, total: r.total, net: r.net };
        }),
      };
    }
    return view;
  }

  return {
    SCHEMA,
    SLOTS,
    LINES,
    LINE_NAMES,
    LETTERS,
    PHASES,
    BALL_STATES,
    DEFAULT_SETTINGS,
    RuleError,
    createGame,
    randomCard,
    randomAssignment,
    ballsIn,
    completeLines,
    rightsFrom,
    rateOf,
    minVotes,
    judgeVotes,
    beginTurn: (state) => beginTurn(clone(state)),
    setDrawn,
    drawRandom,
    addSteal,
    removeSteal,
    addInOut,
    removeInOut,
    applyChange,
    applyExclude,
    resolveTurn,
    nextTurn,
    closeFinalSteal,
    finishGame,
    adjustBalance,
    setBallState,
    publicView,
  };
});
