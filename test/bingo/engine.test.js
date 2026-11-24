'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const B = require('../../bingo/js/engine.js');

// p1 のカード: 1..9（ヨコ1 = 1,2,3）
const CARDS = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9],
  [10, 11, 12, 13, 14, 15, 16, 17, 18],
  [19, 20, 21, 22, 23, 24, 25, 26, 27],
  [1, 10, 19, 2, 11, 20, 3, 12, 21],
  [4, 5, 6, 7, 8, 9, 13, 14, 15],
];

function newGame(n = 4, settings) {
  const players = Array.from({ length: n }, (_, i) => ({
    name: 'P' + (i + 1),
    number: i + 1,
    account: B.LETTERS[i],
    card: CARDS[i % CARDS.length],
  }));
  return B.createGame(players, settings);
}
const p = (s, id) => s.players.find((x) => x.id === id);

/** 1ターン進める：drawn の先頭を有効にする投票（過半数） */
function playTurn(s, drawn, votes, extra) {
  s = B.setDrawn(s, drawn);
  if (extra) s = extra(s);
  s = B.resolveTurn(s, votes || { X: 3 });
  return B.nextTurn(s);
}

test('createGame: 初期値とカード検証', () => {
  const s = newGame();
  assert.equal(s.players[0].balance, 2000000);
  assert.equal(B.ballsIn(s, 'machine').length, 27);
  assert.equal(s.phase, 'draw');
  assert.throws(
    () => B.createGame([{ name: 'a', number: 1, account: 'A', card: [1, 1, 2, 3, 4, 5, 6, 7, 8] }, { name: 'b', number: 2, account: 'B', card: CARDS[1] }]),
    /重複/
  );
  assert.throws(() => B.createGame([{ name: 'a', number: 1, account: 'A', card: [0, 1, 2, 3, 4, 5, 6, 7, 8] }, { name: 'b', number: 2, account: 'B', card: CARDS[1] }]), /1〜27/);
});

test('開票：最多票が有効、同率1位なら次点繰り上がり、全同率は全て有効、過半数未満は全無効', () => {
  const d = [{ slot: 'X', number: 5 }, { slot: 'Y', number: 6 }, { slot: 'Z', number: 7 }];
  assert.deepEqual(B.judgeVotes(d, { X: 5, Y: 2, Z: 1 }, 3).valid, [5]);
  assert.deepEqual(B.judgeVotes(d, { X: 4, Y: 4, Z: 1 }, 3).valid, [7]);
  assert.equal(B.judgeVotes(d, { X: 4, Y: 4, Z: 1 }, 3).reason, 'tiePromote');
  assert.deepEqual(B.judgeVotes(d, { X: 2, Y: 2, Z: 2 }, 3).valid, [5, 6, 7]);
  assert.deepEqual(B.judgeVotes(d, { X: 1, Y: 1, Z: 0 }, 3).valid, []);
  assert.equal(B.judgeVotes(d, { X: 1, Y: 1, Z: 0 }, 3).reason, 'quorum');
  // 出玉2個で同率 → 全て有効
  assert.deepEqual(B.judgeVotes(d.slice(0, 2), { X: 3, Y: 3 }, 3).valid, [5, 6]);
});

test('出玉の行き先：有効はvalid、それ以外はプール。マシーンが空ならプールを戻す', () => {
  let s = newGame(4);
  s = playTurn(s, [1, 2, 3], { X: 3 });
  assert.equal(s.balls[1], 'valid');
  assert.equal(s.balls[2], 'pool');
  assert.equal(s.balls[3], 'pool');
  assert.equal(s.turn, 2);
  // マシーンを空にする
  for (const n of B.ballsIn(s, 'machine')) s.balls[n] = 'trash';
  s.balls[4] = 'pool';
  s.phase = 'resolved';
  s.current.result = { judge: { valid: [] }, newLines: [], steals: [], io: [] };
  s = B.nextTurn(s);
  assert.deepEqual(B.ballsIn(s, 'machine').sort((a, b) => a - b), [2, 3, 4]);
  assert.deepEqual(s.startEvents.refilled, [2, 3, 4]);
});

test('ビンゴ成立と強奪：成立の次ターンのみ、列数に応じた割合で口座から奪う', () => {
  let s = newGame(4);
  s = playTurn(s, [1, 10, 19]);
  s = playTurn(s, [2, 11, 20]);
  s = playTurn(s, [3, 12, 21]); // p1 ヨコ1 成立（turn 3）
  assert.deepEqual(B.rightsFrom(p(s, 'p1'), 3), [1]);
  // 前ターン成立なので turn 4 で申請可
  s = B.setDrawn(s, [4, 13, 22]);
  assert.throws(() => B.addSteal(s, 'p1', 'p2', 2), /成立させていません/);
  s = B.addSteal(s, 'p1', 'p2', 1);
  assert.throws(() => B.addSteal(s, 'p1', 'p3', 1), /申請済み/);
  s = B.resolveTurn(s, { X: 3 });
  assert.equal(p(s, 'p2').balance, 1800000);
  assert.equal(p(s, 'p1').balance, 2200000);
  s = B.nextTurn(s);
  // turn 5 では turn 3 の権利は使えない
  s = B.setDrawn(s, [5, 14, 23]);
  assert.throws(() => B.addSteal(s, 'p1', 'p2', 1), /成立させていません/);
});

test('同時に複数列成立：それぞれの通算列数で権利、割合は 10/20/…/60/80/100%', () => {
  let s = newGame(4);
  // p1 のカードで 1,2,4,5 を先に有効にし、3と7は未
  for (const [a, b, c] of [[1, 10, 19], [2, 11, 20], [4, 13, 22], [5, 14, 23], [6, 15, 24], [8, 17, 26], [9, 18, 27]]) s = playTurn(s, [a, b, c]);
  const before = p(s, 'p1').lines.length;
  // 7 を有効にすると ヨコ3(7,8,9) とタテ1(1,4,7)、ナナメ／(3,5,7)は3が無いので不成立
  s = playTurn(s, [7, 16, 25]);
  const got = p(s, 'p1').lines.filter((l) => l.turn === s.turn - 1).map((l) => l.k);
  assert.equal(got.length, 2);
  assert.deepEqual(got, [before + 1, before + 2]);
  assert.equal(B.rateOf(s.settings, 7), 0.8);
  assert.equal(B.rateOf(s.settings, 8), 1.0);
});

test('IN/OUT：多い方が有効、同数は移動なし、次ターン開始時に反映。有効玉は対象外', () => {
  let s = newGame(4);
  s = B.setDrawn(s, [1, 2, 3]);
  assert.throws(() => B.addInOut(s, 99, 'in'), /不正/);
  s = B.addInOut(s, 2, 'out');
  s = B.addInOut(s, 2, 'out');
  s = B.addInOut(s, 2, 'in');
  s = B.addInOut(s, 10, 'out');
  s = B.addInOut(s, 11, 'out');
  s = B.addInOut(s, 11, 'in');
  s = B.resolveTurn(s, { X: 3 }); // 1 有効、2,3 プール
  assert.deepEqual(s.pendingIO, [{ number: 2, dir: 'out' }, { number: 10, dir: 'out' }]);
  s = B.nextTurn(s);
  assert.equal(s.balls[2], 'trash');
  assert.equal(s.balls[10], 'trash');
  assert.equal(s.balls[11], 'machine');
  s = B.setDrawn(s, [4, 5, 6]);
  assert.throws(() => B.addInOut(s, 1, 'in'), /有効/);
});

test('変更カード：カード内重複・有効済みの数字は不可。除外カードは9ターン目以降', () => {
  let s = newGame(4);
  s = playTurn(s, [10, 11, 12]);
  s = B.setDrawn(s, [13, 14, 15]);
  assert.throws(() => B.applyChange(s, 'p1', 0, 2), /既に/);
  assert.throws(() => B.applyChange(s, 'p1', 0, 10), /有効/);
  s = B.applyChange(s, 'p1', 0, 27);
  assert.equal(p(s, 'p1').card[0], 27);
  assert.throws(() => B.applyExclude(s, 20), /9ターン目以降/);
  s.turn = 9;
  assert.throws(() => B.applyExclude(s, 13), /出玉/);
  s = B.applyExclude(s, 20);
  assert.equal(s.balls[20], 'excluded');
  assert.throws(() => B.addInOut(s, 20, 'in'), /除外/);
});

test('最終強奪・ボーナス/ペナルティ・最終順位', () => {
  let s = newGame(5, { totalTurns: 3 });
  const tie = { X: 2, Y: 2, Z: 2 }; // 全同率 → 3つとも有効
  s = playTurn(s, [1, 10, 19], tie);
  s = playTurn(s, [2, 11, 20], tie);
  s = playTurn(s, [3, 12, 21], tie); // 最終ターンで p1 ヨコ1
  assert.equal(s.phase, 'finalSteal');
  s = B.addSteal(s, 'p1', 'p4', 1);
  s = B.closeFinalSteal(s);
  assert.equal(p(s, 'p1').balance, 2200000);
  assert.equal(s.phase, 'settle');
  assert.throws(() => B.finishGame(s, { p1: 100 }), /チップ額/);
  s = B.finishGame(s, { p1: 1100000, p2: 1100000, p3: 1100000, p4: 1300000, p5: 1100000 });
  const r = Object.fromEntries(s.final.ranking.map((x) => [x.playerId, x]));
  assert.equal(r.p1.bonus, 0);
  assert.equal(r.p5.lines, 0);
  assert.equal(r.p5.bonus, -1000000); // 1列も成立していない
  assert.equal(r.p1.total, 2200000 + 1100000);
  assert.equal(r.p1.net, 200000);
  // p4 はカードが 1,10,19 / 2,11,20 / 3,12,21 → 全マス有効で8列
  assert.equal(r.p4.lines, 8);
  assert.equal(r.p4.bonus, 1000000);
  assert.equal(r.p4.rank, 1);
  assert.equal(r.p5.rank, 5);
});

test('publicView は口座記号↔名前・強奪の当事者・カードを含まない（最終結果を除く）', () => {
  let s = newGame(4);
  s = playTurn(s, [1, 10, 19]);
  const v = B.publicView(s);
  const json = JSON.stringify(v);
  assert.ok(!json.includes('"name"'));
  assert.ok(!json.includes('card'));
  assert.ok(!/"p\d+"/.test(json));
  assert.equal(v.accounts.length, 4);
  assert.deepEqual(Object.keys(v.accounts[0]).sort(), ['account', 'balance']);
  assert.deepEqual(v.result.valid, [1]);
});
