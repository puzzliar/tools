/*
 * 制限すごろく ルールエンジン
 *
 * UI から独立した純粋なロジック。ブラウザでは window.LimitedDice、
 * Node.js では require('./engine.js') で利用できる。
 * すべての操作関数は state を破壊せず、新しい state を返す。
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.LimitedDice = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const SCHEMA = 1;
  const NUMBERS = [1, 2, 3, 4, 5, 6];
  const PIECES = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

  const DEFAULT_SETTINGS = Object.freeze({
    boardSize: 20,
    totalTurns: 15,
    initialChips: 1000000,
    initialAccount: 2000000,
    capCardPrice: 200000,
    swapCardPrice: 500000,
    // n周目の周回ボーナス単価（後続1人あたり）。配列より先の周回は最後の値を使う。
    lapBonusRates: [50000, 80000, 120000],
    stealMaxRate: 0.5,
    bottomN: 3,
    noSubmitPenalty: 100000,
    underLapPenalty: 1000000,
    baseCapacities: {
      12: [2, 3, 2, 2, 2, 1],
      13: [2, 3, 3, 2, 2, 1],
      14: [2, 3, 3, 3, 2, 1],
      15: [2, 4, 3, 3, 2, 1],
    },
  });

  const PHASES = {
    capacity: '定員公開',
    swap: 'アイテム宣言フェーズA',
    vote: '同時提出フェーズ',
    steal: '周回処理・％奪取',
    finished: 'ゲーム終了',
  };

  const STEAL_FAIL_REASONS = {
    mismatch: 'プレイヤーナンバーと駒が一致しない',
    self: '自分自身を指名',
    consecutive: '前ターンに指名された対象を連続指名',
    multiple: '1回の周回で複数回宣言',
    duplicate: '同一ターン・同一対象への成功が既に存在',
  };

  class RuleError extends Error {
    constructor(message) {
      super(message);
      this.name = 'RuleError';
    }
  }

  // ---------- helpers ----------

  const clone = (v) => JSON.parse(JSON.stringify(v));
  const floor = (n) => Math.floor(n + 1e-9);

  function assert(cond, message) {
    if (!cond) throw new RuleError(message);
  }

  function isInt(n) {
    return typeof n === 'number' && Number.isInteger(n);
  }

  function mergeSettings(overrides) {
    const s = clone(DEFAULT_SETTINGS);
    if (!overrides) return s;
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) continue;
      if (k === 'baseCapacities') s.baseCapacities = Object.assign({}, s.baseCapacities, clone(v));
      else s[k] = clone(v);
    }
    return s;
  }

  function getPlayer(state, id) {
    const p = state.players.find((x) => x.id === id);
    assert(p, `プレイヤーが見つかりません: ${id}`);
    return p;
  }

  function lapOf(state, progress) {
    return floor(progress / state.settings.boardSize);
  }

  function squareOf(state, progress) {
    return progress % state.settings.boardSize;
  }

  function lapRate(settings, lap) {
    const rates = settings.lapBonusRates;
    return rates[Math.min(lap, rates.length) - 1];
  }

  /** 口座から差し引く（0下限）。実際に引けた額を返す。 */
  function debitAccount(player, amount) {
    const actual = Math.min(player.account, Math.max(0, amount));
    player.account -= actual;
    return actual;
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

  // ---------- setup ----------

  function baseCapacityArray(settings, playerCount) {
    const arr = settings.baseCapacities[playerCount];
    assert(Array.isArray(arr) && arr.length === 6, `${playerCount}人用の基礎定員配列が定義されていません`);
    return arr.slice();
  }

  /**
   * ゲームを作成する。
   * players: [{ name, number, piece }]
   */
  function createGame(playersInput, settingsOverrides) {
    const settings = mergeSettings(settingsOverrides);
    assert(Array.isArray(playersInput) && playersInput.length > 0, 'プレイヤーを入力してください');
    const n = playersInput.length;
    baseCapacityArray(settings, n); // 人数チェック

    const names = new Set();
    const numbers = new Set();
    const pieces = new Set();
    const players = playersInput.map((p, i) => {
      const name = String(p.name || '').trim();
      const number = Number(p.number);
      const piece = String(p.piece || '').trim().toUpperCase();
      assert(name, `${i + 1}行目: 名前が空です`);
      assert(!names.has(name), `名前「${name}」が重複しています`);
      assert(isInt(number) && number >= 1, `${name}: プレイヤーナンバーが不正です`);
      assert(!numbers.has(number), `プレイヤーナンバー ${number} が重複しています`);
      assert(/^[A-Z]$/.test(piece), `${name}: 駒はアルファベット1文字で指定してください`);
      assert(!pieces.has(piece), `駒 ${piece} が重複しています`);
      names.add(name);
      numbers.add(number);
      pieces.add(piece);
      return {
        id: 'p' + (i + 1),
        name,
        number,
        piece,
        account: settings.initialAccount,
        chips: settings.initialChips,
        progress: 0,
        maxLapRewarded: 0,
        swapUsed: false,
        noSubmitCount: 0,
      };
    });

    return {
      schema: SCHEMA,
      settings,
      players,
      turn: 1,
      phase: 'capacity',
      current: emptyTurn(),
      history: [],
      ledger: [],
      ledgerSeq: 0,
      final: null,
    };
  }

  function emptyTurn() {
    return { baseCaps: null, swaps: [], ballots: {}, result: null };
  }

  /** 番号・駒をランダムに割り振った初期入力を作る（セットアップ補助） */
  function randomAssignment(names, rng) {
    rng = rng || Math.random;
    const n = names.length;
    const nums = shuffle(
      Array.from({ length: n }, (_, i) => i + 1),
      rng
    );
    const pcs = shuffle(PIECES.slice(0, n), rng);
    return names.map((name, i) => ({ name, number: nums[i], piece: pcs[i] }));
  }

  // ---------- phase: capacity ----------

  function shuffleBaseCaps(state, rng) {
    assertPhase(state, ['capacity', 'swap']);
    assert(state.current.swaps.length === 0, '入れ替え宣言後は定員を変更できません');
    const s = clone(state);
    s.current.baseCaps = shuffle(baseCapacityArray(s.settings, s.players.length), rng || Math.random);
    s.phase = 'swap';
    return s;
  }

  function setBaseCaps(state, caps) {
    assertPhase(state, ['capacity', 'swap']);
    assert(state.current.swaps.length === 0, '入れ替え宣言後は定員を変更できません');
    assert(Array.isArray(caps) && caps.length === 6, '定員は数字1〜6の6つを指定してください');
    caps.forEach((c) => assert(isInt(c) && c >= 0, '定員は0以上の整数で指定してください'));
    const s = clone(state);
    s.current.baseCaps = caps.slice();
    s.phase = 'swap';
    return s;
  }

  // ---------- phase: swap (アイテム宣言フェーズA) ----------

  function declareSwap(state, byId, targetId) {
    assertPhase(state, ['swap']);
    const s = clone(state);
    const by = getPlayer(s, byId);
    const target = getPlayer(s, targetId);
    assert(by.id !== target.id, '自分自身とは入れ替えできません');
    assert(!by.swapUsed, `${by.name} は順位入れ替えカードを既に使用しています（1人1枚限り）`);
    assert(by.chips >= s.settings.swapCardPrice, `${by.name} のチップが不足しています`);
    by.chips -= s.settings.swapCardPrice;
    by.swapUsed = true;
    const before = { by: by.progress, target: target.progress };
    [by.progress, target.progress] = [target.progress, by.progress];
    s.current.swaps.push({ byId: by.id, targetId: target.id, before, after: { by: by.progress, target: target.progress } });
    addLedger(s, { type: 'swap', playerId: by.id, targetId: target.id, chips: -s.settings.swapCardPrice });
    return s;
  }

  function endSwapPhase(state) {
    assertPhase(state, ['swap']);
    const s = clone(state);
    s.phase = 'vote';
    return s;
  }

  // ---------- phase: vote (同時提出フェーズ) ----------

  /**
   * 投票用紙の内容を登録する。
   * ballot: { vote: 1..6 | null(無提出), cards: { "1": 枚数, ... } }
   */
  function setBallot(state, playerId, ballot) {
    assertPhase(state, ['vote']);
    const s = clone(state);
    const p = getPlayer(s, playerId);
    const vote = ballot.vote == null || ballot.vote === '' ? null : Number(ballot.vote);
    assert(vote === null || NUMBERS.includes(vote), '進む数は1〜6で指定してください');
    const cards = normalizeCards(ballot.cards);
    const cost = cardCount(cards) * s.settings.capCardPrice;
    assert(cost <= p.chips, `${p.name} のチップが不足しています（必要 ${cost.toLocaleString()} / 所持 ${p.chips.toLocaleString()}）`);
    s.current.ballots[p.id] = { vote, cards };
    return s;
  }

  function clearBallot(state, playerId) {
    assertPhase(state, ['vote']);
    const s = clone(state);
    delete s.current.ballots[playerId];
    return s;
  }

  function normalizeCards(cards) {
    const out = {};
    for (const n of NUMBERS) {
      const v = cards ? Number(cards[n] || 0) : 0;
      assert(isInt(v) && v >= 0, '枠数変更カードの枚数が不正です');
      if (v > 0) out[n] = v;
    }
    return out;
  }

  function cardCount(cards) {
    return Object.values(cards || {}).reduce((a, b) => a + b, 0);
  }

  /** 開票前のプレビュー（現在の入力での定員・票数） */
  function tallyPreview(state) {
    const base = state.current.baseCaps || [0, 0, 0, 0, 0, 0];
    const rows = NUMBERS.map((n, i) => ({ number: n, base: base[i], cards: 0, finalCap: base[i], votes: 0, ok: true }));
    for (const b of Object.values(state.current.ballots)) {
      for (const [n, c] of Object.entries(b.cards)) rows[n - 1].cards += c;
      if (b.vote) rows[b.vote - 1].votes += 1;
    }
    rows.forEach((r) => {
      r.finalCap = r.base + r.cards;
      r.ok = r.votes <= r.finalCap;
    });
    return rows;
  }

  /**
   * 開票・定員確定・移動・周回判定を行う。
   * options.penaltyExempt: 反復無提出の軽罰を免除するプレイヤーID配列（運営判断）
   */
  function resolveVotes(state, options) {
    assertPhase(state, ['vote']);
    options = options || {};
    const exempt = new Set(options.penaltyExempt || []);
    const s = clone(state);
    const set = s.settings;
    const B = set.boardSize;

    // チップ精算（枠数変更カード）
    const cardSpend = {};
    for (const p of s.players) {
      const b = s.current.ballots[p.id];
      const cost = b ? cardCount(b.cards) * set.capCardPrice : 0;
      assert(cost <= p.chips, `${p.name} のチップが不足しています`);
      if (cost > 0) {
        p.chips -= cost;
        cardSpend[p.id] = cost;
        addLedger(s, { type: 'capCard', playerId: p.id, chips: -cost, cards: clone(b.cards) });
      }
    }

    const numbers = tallyPreview(s);

    // 移動
    const moves = [];
    const penalties = [];
    for (const p of s.players) {
      const b = s.current.ballots[p.id];
      const vote = b ? b.vote : null;
      if (vote === null) {
        const repeat = p.noSubmitCount >= 1;
        p.noSubmitCount += 1;
        let penalty = 0;
        if (repeat && !exempt.has(p.id)) {
          penalty = debitAccount(p, set.noSubmitPenalty);
          penalties.push({ playerId: p.id, amount: penalty, reason: 'noSubmit' });
          addLedger(s, { type: 'penalty', playerId: p.id, account: -penalty, reason: '無提出（反復）' });
        }
        moves.push({ playerId: p.id, vote: null, ok: false, move: 0, from: p.progress, to: p.progress, noSubmit: true });
        continue;
      }
      const row = numbers[vote - 1];
      const move = row.ok ? vote : 0;
      const from = p.progress;
      p.progress += move;
      moves.push({ playerId: p.id, vote, ok: row.ok, move, from, to: p.progress, noSubmit: false });
    }

    // 周回判定（同一ターン内の複数周回者も各自の式で計算）
    const laps = [];
    for (const m of moves) {
      if (m.move <= 0) continue;
      const p = getPlayer(s, m.playerId);
      const fromLap = floor(m.from / B);
      const toLap = floor(m.to / B);
      for (let k = fromLap + 1; k <= toLap; k++) {
        if (k <= p.maxLapRewarded) continue; // 既に周回扱いを受けた周回数は対象外
        p.maxLapRewarded = k;
        const followers = s.players.filter((q) => q.id !== p.id && q.progress < k * B).length;
        laps.push({ playerId: p.id, lap: k, followers, rate: lapRate(set, k), bonus: floor(followers * lapRate(set, k)) });
      }
    }

    // 下位N位以内（N位タイを含む）判定 → ％奪取権
    const lapPlayers = [...new Set(laps.map((l) => l.playerId))];
    const stealEligible = lapPlayers.filter((id) => isBottomN(s, id));

    s.current.result = { numbers, moves, laps, stealEligible, penalties, cardSpend };
    s.phase = 'steal';
    return s;
  }

  /** 下位N位以内か（自分より厳密に後ろの人数 < N なら該当。N位タイは全員含む） */
  function isBottomN(state, playerId) {
    const me = getPlayer(state, playerId);
    const behind = state.players.filter((q) => q.progress < me.progress).length;
    return behind < state.settings.bottomN;
  }

  /** 順位（同一位置は同順位）。返り値: { playerId: rank } */
  function boardRanks(state) {
    const ranks = {};
    for (const p of state.players) {
      ranks[p.id] = 1 + state.players.filter((q) => q.progress > p.progress).length;
    }
    return ranks;
  }

  // ---------- phase: steal (周回処理・％奪取) ----------

  /** 前ターンに指名（番号・駒が一致）された対象 */
  function previousNamedTargets(state) {
    const prev = state.history[state.history.length - 1];
    if (!prev || prev.turn !== state.turn - 1) return new Set();
    return new Set(prev.namedTargets || []);
  }

  /**
   * ％奪取を処理し、周回ボーナスを支払ってターンを確定する。
   * steals: [{ attackerId, number, piece, amount(null=上限) }]（宣言順）
   */
  function finalizeTurn(state, steals) {
    assertPhase(state, ['steal']);
    steals = steals || [];
    const s = clone(state);
    const set = s.settings;
    const res = s.current.result;
    const eligible = new Set(res.stealEligible);
    const prevNamed = previousNamedTargets(s);
    const declared = new Set();
    const succeeded = new Set();
    const named = new Set();
    const stealResults = [];

    for (const d of steals) {
      const attacker = getPlayer(s, d.attackerId);
      assert(eligible.has(attacker.id), `${attacker.name} には今ターンの％奪取権がありません`);
      const number = Number(d.number);
      const piece = String(d.piece || '').toUpperCase();
      const declaredAmount = d.amount == null || d.amount === '' ? null : Number(d.amount);
      assert(declaredAmount === null || (isFinite(declaredAmount) && declaredAmount >= 0), '奪取額が不正です');
      const r = { attackerId: attacker.id, number, piece, declaredAmount, success: false, amount: 0, targetId: null, reason: null };

      const target = s.players.find((p) => p.number === number && p.piece === piece) || null;
      if (target) {
        r.targetId = target.id;
        named.add(target.id);
      }
      if (declared.has(attacker.id)) r.reason = 'multiple';
      else if (!target) r.reason = 'mismatch';
      else if (target.id === attacker.id) r.reason = 'self';
      else if (prevNamed.has(target.id)) r.reason = 'consecutive';
      else if (succeeded.has(target.id)) r.reason = 'duplicate';
      declared.add(attacker.id);

      if (!r.reason) {
        const cap = floor(target.account * set.stealMaxRate);
        const amount = declaredAmount === null ? cap : Math.min(floor(declaredAmount), cap);
        const actual = debitAccount(target, amount);
        attacker.account += actual;
        r.success = true;
        r.amount = actual;
        r.cap = cap;
        succeeded.add(target.id);
        addLedger(s, { type: 'steal', playerId: attacker.id, targetId: target.id, account: actual });
      }
      stealResults.push(r);
    }

    // 周回ボーナス（バンク支給・ターン終了時）
    for (const l of res.laps) {
      if (l.bonus > 0) {
        getPlayer(s, l.playerId).account += l.bonus;
        addLedger(s, { type: 'lapBonus', playerId: l.playerId, account: l.bonus, lap: l.lap });
      }
    }

    s.history.push({
      turn: s.turn,
      baseCaps: s.current.baseCaps,
      swaps: s.current.swaps,
      ballots: s.current.ballots,
      numbers: res.numbers,
      moves: res.moves,
      laps: res.laps,
      penalties: res.penalties,
      cardSpend: res.cardSpend,
      stealEligible: res.stealEligible,
      steals: stealResults,
      namedTargets: [...named],
      positions: Object.fromEntries(s.players.map((p) => [p.id, p.progress])),
    });

    if (s.turn >= set.totalTurns) return finishGame(s);
    s.turn += 1;
    s.current = emptyTurn();
    s.phase = 'capacity';
    return s;
  }

  // ---------- anytime: transfers & adjustments ----------

  /** プレイヤー間送受金。kind: 'account' | 'chips' */
  function transfer(state, fromId, toId, amount, kind, memo) {
    assert(state.phase !== 'finished', 'ゲームは終了しています');
    kind = kind || 'account';
    assert(kind === 'account' || kind === 'chips', '種別が不正です');
    assert(isInt(amount) && amount > 0, '金額は1以上の整数で指定してください');
    const s = clone(state);
    const from = getPlayer(s, fromId);
    const to = getPlayer(s, toId);
    assert(from.id !== to.id, '送金元と送金先が同じです');
    assert(from[kind] >= amount, `${from.name} の${kind === 'account' ? '口座残高' : 'チップ'}が不足しています`);
    from[kind] -= amount;
    to[kind] += amount;
    addLedger(s, { type: 'transfer', kind, playerId: from.id, targetId: to.id, amount, memo: memo || '' });
    return s;
  }

  /** 運営による手動補正。kind: 'account' | 'chips' | 'progress' */
  function adjust(state, playerId, kind, delta, memo) {
    assert(state.phase !== 'finished', 'ゲームは終了しています');
    assert(['account', 'chips', 'progress'].includes(kind), '種別が不正です');
    assert(isInt(delta) && delta !== 0, '補正値は0以外の整数で指定してください');
    const s = clone(state);
    const p = getPlayer(s, playerId);
    assert(p[kind] + delta >= 0, '補正後の値がマイナスになります');
    p[kind] += delta;
    addLedger(s, { type: 'adjust', kind, playerId: p.id, delta, memo: memo || '' });
    return s;
  }

  // ---------- end of game ----------

  function finishGame(state) {
    const s = clone(state);
    const set = s.settings;
    const initial = set.initialAccount + set.initialChips;
    const penalties = [];
    for (const p of s.players) {
      if (lapOf(s, p.progress) < 1) {
        const amt = debitAccount(p, set.underLapPenalty);
        penalties.push({ playerId: p.id, amount: amt });
        addLedger(s, { type: 'penalty', playerId: p.id, account: -amt, reason: '周回未達成' });
      }
    }
    const rows = s.players.map((p) => ({
      playerId: p.id,
      account: p.account,
      chips: p.chips,
      balance: p.account + p.chips,
      score: p.account + p.chips - initial,
    }));
    rows.forEach((r) => {
      r.rank = 1 + rows.filter((q) => q.score > r.score).length;
    });
    rows.sort((a, b) => a.rank - b.rank || a.playerId.localeCompare(b.playerId, 'en', { numeric: true }));
    s.final = { initial, penalties, ranking: rows };
    s.phase = 'finished';
    s.current = emptyTurn();
    return s;
  }

  // ---------- public view (発表ツールに渡す情報のみ) ----------

  /**
   * 発表画面に渡してよい公開情報だけを抽出する。
   * 個人の投票内容・枠数変更カードの使用者・番号↔駒↔名前の紐付けは含めない。
   */
  function publicView(state) {
    const set = state.settings;
    const B = set.boardSize;
    const pieceOf = (id) => getPlayer(state, id).piece;
    const nameOf = (id) => getPlayer(state, id).name;
    const ranks = boardRanks(state);

    const board = state.players
      .map((p) => ({ piece: p.piece, progress: p.progress, lap: lapOf(state, p.progress), square: squareOf(state, p.progress), rank: ranks[p.id] }))
      .sort((a, b) => b.progress - a.progress || a.piece.localeCompare(b.piece));

    const view = {
      schema: SCHEMA,
      turn: state.turn,
      totalTurns: set.totalTurns,
      boardSize: B,
      playerCount: state.players.length,
      phase: state.phase,
      phaseLabel: PHASES[state.phase],
      baseCaps: state.current.baseCaps,
      swaps: state.current.swaps.map((x) => ({ byName: nameOf(x.byId) })),
      board,
      result: null,
      final: null,
    };

    let src = null;
    if (state.phase === 'steal') src = { turn: state.turn, ...state.current.result, steals: null };
    else if (state.history.length) src = state.history[state.history.length - 1];
    if (src) {
      view.result = {
        turn: src.turn,
        numbers: src.numbers.map((r) => ({ number: r.number, base: r.base, finalCap: r.finalCap, votes: r.votes, ok: r.ok })),
        laps: src.laps.map((l) => ({ piece: pieceOf(l.playerId), lap: l.lap, bonus: l.bonus })),
        stealEligibleCount: src.stealEligible.length,
        steals: src.steals
          ? src.steals.map((x) => ({ attackerName: nameOf(x.attackerId), number: x.number, piece: x.piece, success: x.success, amount: x.amount }))
          : null,
      };
    }

    if (state.final) {
      view.final = {
        initial: state.final.initial,
        ranking: state.final.ranking.map((r) => ({
          rank: r.rank,
          name: nameOf(r.playerId),
          number: getPlayer(state, r.playerId).number,
          piece: pieceOf(r.playerId),
          balance: r.balance,
          score: r.score,
        })),
      };
    }
    return view;
  }

  /**
   * ルール説明スライド用の公開パラメータ（秘匿情報を含まない）。
   * settings はゲームの設定（未作成なら既定値）、playerCount は参加人数（未定なら null）。
   */
  function rulesInfo(settings, playerCount) {
    const s = mergeSettings(settings);
    const n = Number(playerCount);
    return {
      playerCount: s.baseCapacities[n] ? n : null,
      totalTurns: s.totalTurns,
      boardSize: s.boardSize,
      initialChips: s.initialChips,
      initialAccount: s.initialAccount,
      capCardPrice: s.capCardPrice,
      swapCardPrice: s.swapCardPrice,
      lapBonusRates: s.lapBonusRates.slice(),
      stealMaxRate: s.stealMaxRate,
      bottomN: s.bottomN,
      noSubmitPenalty: s.noSubmitPenalty,
      underLapPenalty: s.underLapPenalty,
      baseCapacities: clone(s.baseCapacities),
    };
  }

  function assertPhase(state, phases) {
    assert(phases.includes(state.phase), `現在のフェーズ（${PHASES[state.phase]}）ではこの操作はできません`);
  }

  return {
    SCHEMA,
    NUMBERS,
    PIECES,
    PHASES,
    STEAL_FAIL_REASONS,
    DEFAULT_SETTINGS,
    RuleError,
    createGame,
    randomAssignment,
    baseCapacityArray,
    shuffleBaseCaps,
    setBaseCaps,
    declareSwap,
    endSwapPhase,
    setBallot,
    clearBallot,
    tallyPreview,
    resolveVotes,
    finalizeTurn,
    transfer,
    adjust,
    finishGame,
    publicView,
    rulesInfo,
    boardRanks,
    isBottomN,
    lapOf,
    squareOf,
    cardCount,
  };
});
