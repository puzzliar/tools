/*
 * 制限すごろく ルール説明スライド
 * 構成は「削減アミダクジ」発表ツールに準拠：タイトル → RULE 01〜N → GAME START
 * 数値はすべて rulesInfo()（ゲーム設定）から差し込む。
 */
(function (root) {
  'use strict';

  const yen = (n) => Number(n).toLocaleString('ja-JP');
  const pct = (r) => Math.round(r * 100) + '%';
  const lapName = (i) => `${i + 1}周目`;

  // ---------- slide list ----------

  const RULES = [
    { id: 'goal', title: '目的' },
    { id: 'initial', title: '初期配布' },
    { id: 'secret', title: '秘匿情報' },
    { id: 'board', title: 'ボード' },
    { id: 'flow', title: 'ゲームの流れ' },
    { id: 'capacity', title: '定員' },
    { id: 'vote', title: '同時提出' },
    { id: 'judge', title: '開票・成立と全滅' },
    { id: 'capcard', title: '枠数変更カード' },
    { id: 'swapcard', title: '順位入れ替えカード' },
    { id: 'lapbonus', title: '周回ボーナス' },
    { id: 'steal', title: '％奪取' },
    { id: 'steal-limits', title: '％奪取の不成立' },
    { id: 'transfer', title: '送受金' },
    { id: 'penalty', title: 'ペナルティ' },
    { id: 'winner', title: '勝者' },
    { id: 'prohibited', title: '禁止事項' },
    { id: 'dealer', title: 'ディーラーの裁定' },
    { id: 'qa', title: '質疑応答' },
  ];

  function slideList() {
    return [{ id: 'game-title', title: 'タイトル' }]
      .concat(RULES.map((r, i) => Object.assign({ ruleIdx: i + 1, ruleTotal: RULES.length }, r)))
      .concat([{ id: 'eyecatch', title: 'GAME START' }]);
  }

  // ---------- helpers ----------

  /** 見出し「タイトル ― サブ」・説明・図版の共通レイアウト */
  function rule(slide, title, desc, art, cls) {
    const [main, ...rest] = title.split('―').map((s) => s.trim());
    const sub = rest.join(' ― ');
    return `<div class="rule-wrap ${cls || ''}">
      <div class="rule-counter">RULE ${String(slide.ruleIdx).padStart(2, '0')} / ${slide.ruleTotal}</div>
      <div class="rule-title">${main}</div>
      ${sub ? `<div class="rule-title-sub">${sub}</div>` : ''}
      <div class="rule-desc">${desc
        .split('<br>')
        .map((line) => `<p>${line}</p>`)
        .join('')}</div>
      <div class="rule-art">${art}</div>
    </div>`;
  }

  function list(items, cls) {
    return `<div class="r-list ${cls || ''}">${items
      .map((t, i) => `<div class="r-item" style="--d:${0.45 + i * 0.1}s"><span class="r-mark">${cls === 'ng' ? '✕' : '◆'}</span><span>${t}</span></div>`)
      .join('')}</div>`;
  }

  /** 20マス周回ボード（外周マス）のSVG */
  function ringSvg(B, opts) {
    opts = opts || {};
    const side = Math.ceil(B / 4) + 1;
    const cells = [];
    for (let c = 0; c < side; c++) cells.push([0, c]);
    for (let r = 1; r < side; r++) cells.push([r, side - 1]);
    for (let c = side - 2; c >= 0; c--) cells.push([side - 1, c]);
    for (let r = side - 2; r >= 1; r--) cells.push([r, 0]);
    const S = 60;
    const G = 6;
    const W = side * S + (side - 1) * G;
    const tokens = opts.tokens || {};
    const body = cells
      .slice(0, B)
      .map(([r, c], sq) => {
        const x = c * (S + G);
        const y = r * (S + G);
        const start = sq === 0;
        const tok = tokens[sq] || [];
        return `<g>
          <rect x="${x}" y="${y}" width="${S}" height="${S}" rx="7" class="${start ? 'rs-start' : 'rs-cell'}"/>
          <text x="${x + 7}" y="${y + 16}" class="rs-num">${start ? 'START' : sq}</text>
          ${tok
            .map(
              (t, i) =>
                `<rect x="${x + 10 + i * 22}" y="${y + 26}" width="19" height="22" rx="4" class="rs-tok"/><text x="${x + 19.5 + i * 22}" y="${y + 42}" class="rs-tok-t">${t}</text>`
            )
            .join('')}
        </g>`;
      })
      .join('');
    const mid = W / 2;
    const center = opts.center
      ? `<text x="${mid}" y="${mid - 6}" class="rs-center">${opts.center}</text><text x="${mid}" y="${mid + 30}" class="rs-center-sub">${opts.centerSub || ''}</text>`
      : '';
    return `<svg class="ring-svg" viewBox="-4 -4 ${W + 8} ${W + 8}" xmlns="http://www.w3.org/2000/svg">${body}${center}</svg>`;
  }

  function capCards(arr, opts) {
    opts = opts || {};
    return `<div class="r-caps">${arr
      .map(
        (c, i) => `<div class="r-cap ${opts.ok && opts.ok[i] === false ? 'ng' : ''}" style="--d:${0.4 + i * 0.08}s">
          <div class="n">${i + 1}</div><div class="l">定員</div><div class="v">${c}</div></div>`
      )
      .join('')}</div>`;
  }

  // ---------- slides ----------

  function render(slide, info) {
    const R = info;
    const B = R.boardSize;
    const n = R.playerCount;
    switch (slide.id) {
      case 'game-title': {
        return `<div class="gtitle">
          <div class="gtitle-ring">${ringSvg(B)}</div>
          <div class="gtitle-eyebrow">PUZZLIAR &nbsp;·&nbsp; PRESENTS</div>
          <div class="gtitle-line"></div>
          <div class="gtitle-main">制限すごろく</div>
          <div class="gtitle-line"></div>
          <div class="gtitle-en">LIMITED &nbsp; DICE</div>
        </div>`;
      }

      case 'eyecatch':
        return `<div class="ec-wrap">
          <div class="ec-game">LIMITED DICE</div>
          <div class="ec-title">GAME START</div>
          <div class="ec-sub">全 ${R.totalTurns} ターン</div>
        </div>`;

      case 'goal':
        return rule(
          slide,
          '目的 ― 最終得点を最も高くせよ',
          `最終残高（<em>口座残高 ＋ チップ</em>）から初期配布額 <em>${yen(R.initialAccount + R.initialChips)} L$</em> を差し引いた値が最終得点。<br>最終得点が最も高いプレイヤーがこのゲームの勝者です。`,
          `<div class="r-formula">
            <div class="r-box"><div class="k">最終残高</div><div class="v">口座 ＋ チップ</div></div>
            <div class="r-op">−</div>
            <div class="r-box"><div class="k">初期配布額</div><div class="v">${yen(R.initialAccount + R.initialChips)}</div></div>
            <div class="r-op">＝</div>
            <div class="r-box gold"><div class="k">最終得点</div><div class="v">HIGH SCORE</div></div>
          </div>
          <div class="r-note">例：最終残高 5,000,000 L$ → 最終得点 ${yen(5000000 - R.initialAccount - R.initialChips)} L$ ／ 最終得点はマイナスになることもあります</div>`
        );

      case 'initial':
        return rule(
          slide,
          '初期配布 ― チップと口座',
          `各プレイヤーに <em>チップ ${yen(R.initialChips)} L$</em> と <em>口座残高 ${yen(R.initialAccount)} L$</em> が配布されます（合計 ${yen(R.initialChips + R.initialAccount)} L$）。`,
          `<div class="r-pair">
            <div class="r-card" style="--d:.4s"><div class="t">チップ</div><div class="big">${yen(R.initialChips)}<small>L$</small></div><div class="s">アイテム購入専用<br>（枠数変更カード・順位入れ替えカード）</div></div>
            <div class="r-card" style="--d:.55s"><div class="t">口座残高</div><div class="big">${yen(R.initialAccount)}<small>L$</small></div><div class="s">送受金・周回ボーナス・％奪取の対象</div></div>
          </div>
          <div class="r-chips">
            <span>駒（アルファベット1文字）</span><span>プレイヤーナンバー</span><span>投票用紙 ×${R.totalTurns}ターン分</span><span>ルールブック</span><span>筆記具</span>
          </div>`
        );

      case 'secret':
        return rule(
          slide,
          '秘匿情報 ― 駒とプレイヤーナンバー',
          `駒のアルファベットは <em>自分だけ</em> が把握し、他のプレイヤーには非公開。<br>プレイヤーナンバー（1〜${n || 15}）も <em>プレイヤー間で共有されない秘匿情報</em> です。番号と駒の紐付けはGMのみが管理します。`,
          `<div class="r-pair">
            <div class="r-card secret" style="--d:.4s"><div class="t">駒</div><div class="mystery">?</div><div class="s">誰がどの駒かは非公開</div></div>
            <div class="r-card secret" style="--d:.55s"><div class="t">プレイヤーナンバー</div><div class="mystery">No.?</div><div class="s">プレイヤー間で共有されない</div></div>
          </div>
          <div class="r-note">この2つの組み合わせが、後述の <b>％奪取</b> の鍵になります。</div>`
        );

      case 'board':
        return rule(
          slide,
          `ボード ― ${B}マスの周回型`,
          `駒は <em>時計回り</em> に進みます。スタートを通過すると <em>周回</em>。<br>同じマスにある駒は <em>同順位</em> として扱い、到着順などの優劣はつけません。`,
          ringSvg(B, { tokens: { 0: ['A'], 3: ['B', 'C'], 7: ['D'], 12: ['E'] }, center: '時計回り →', centerSub: `START を通過すると周回` }),
          'board'
        );

      case 'flow': {
        const steps = ['定員公開', 'アイテム宣言A', '同時提出', '開票・定員確定', '移動', '周回処理', '口座・チップ更新'];
        return rule(
          slide,
          `ゲームの流れ ― 全${R.totalTurns}ターン`,
          `1ターンは以下の7ステップで進行し、これを <em>${R.totalTurns}回</em> 繰り返します。`,
          `<div class="r-flow">${steps
            .map(
              (s, i) =>
                `<div class="r-step" style="--d:${0.4 + i * 0.09}s"><div class="no">${i + 1}</div><div class="nm">${s}</div></div>${i < steps.length - 1 ? '<div class="r-arrow">→</div>' : ''}`
            )
            .join('')}</div>`,
          'wide'
        );
      }

      case 'capacity': {
        const counts = [12, 13, 14, 15].filter((k) => R.baseCapacities[k]);
        const arr = n ? R.baseCapacities[n] : R.baseCapacities[counts[0]];
        return rule(
          slide,
          '定員 ― 数字ごとに進める人数が決まっている',
          `GMは人数に応じた <em>基礎定員配列</em> を毎ターン <em>シャッフル</em> し、数字1〜6に割り当てて公開します。`,
          `<div class="r-capbox">
            <div class="r-sub">${n ? `${n}人プレイ` : `${counts[0]}人プレイ`}の基礎定員配列 [${arr.join(', ')}] ／ シャッフル例</div>
            ${capCards(shuffleExample(arr))}
            <table class="r-table small">
              <tr><th>人数</th>${counts.map((k) => `<td class="${k === n ? 'hl' : ''}">${k}人</td>`).join('')}</tr>
              <tr><th>基礎定員配列</th>${counts.map((k) => `<td class="${k === n ? 'hl' : ''}">[${R.baseCapacities[k].join(', ')}]</td>`).join('')}</tr>
            </table>
          </div>`
        );
      }

      case 'vote':
        return rule(
          slide,
          '同時提出 ― 進む数を秘匿で投票',
          `投票用紙に <em>進む数（1〜6）</em> を1つ記入して提出。<br>枠数変更カードを使う場合は <em>同時に秘匿で投函</em> します。全員の投票は同時に開票されます。`,
          `<div class="r-ballot">
            <div class="r-paper" style="--d:.4s"><div class="h">投票用紙　TURN 3</div><div class="q">進む数</div><div class="a">4</div></div>
            <div class="r-plus">＋</div>
            <div class="r-cardsm" style="--d:.6s"><div class="h">枠数変更カード</div><div class="a">+1</div><div class="q">数字「4」</div></div>
          </div>
          <div class="r-note">時間内に提出しなかった場合は無提出（移動0）となります</div>`
        );

      case 'judge':
        return rule(
          slide,
          '開票 ― 定員以内なら成立、超えたら全滅',
          `<em>最終定員 ＝ 基礎定員 ＋ 枠数変更カードの総枚数</em>。<br>投票数が最終定員以内の数字だけが成立し、選んだ数だけ進みます。<em>超過した数字は全員移動0</em>（抽選は行いません）。`,
          `<div class="r-judge">
            <div class="r-jcard ok" style="--d:.45s"><div class="n">4</div><div class="vs">3 <span>/</span> 3</div><div class="l">投票 / 定員</div><div class="stamp">成立</div><div class="eff">全員 4マス進む</div></div>
            <div class="r-jcard ng" style="--d:.7s"><div class="n">2</div><div class="vs">3 <span>/</span> 2</div><div class="l">投票 / 定員</div><div class="stamp">全滅</div><div class="eff">全員 移動0</div></div>
          </div>`
        );

      case 'capcard':
        return rule(
          slide,
          `枠数変更カード ― ${yen(R.capCardPrice)} L$（チップ払い）`,
          `指定した数字の <em>定員を1増やす</em> カード。投票と同時に秘匿で投函します。`,
          `<div class="r-itemrow">
            <div class="r-bigcard" style="--d:.4s"><div class="h">枠数変更カード</div><div class="a">+1</div><div class="p">${yen(R.capCardPrice)} L$</div></div>
            ${list([
              '使用枚数の上限なし。<b>複数人・複数枚の重ね掛け</b>が可能',
              '誰が何枚出したかは非公開。<b>最終定員のみ</b>が公開される',
              '効果は<b>当該ターンのみ</b>',
              '数字が不成立になっても<b>返金なし</b>',
            ])}
          </div>`
        );

      case 'swapcard':
        return rule(
          slide,
          `順位入れ替えカード ― ${yen(R.swapCardPrice)} L$（チップ払い）`,
          `宣言者は <em>任意の相手と盤上の位置を入れ替え</em> られます。投票前の <em>アイテム宣言フェーズA</em> で公開宣言します。`,
          `<div class="r-itemrow">
            <div class="r-swap" style="--d:.4s"><span class="tok">A</span><span class="sw">⇄</span><span class="tok">B</span></div>
            ${list([
              '<b>各プレイヤー1枚限り</b>・譲渡不可',
              '宣言は投票前のみ。宣言後は取り消せない',
              '入れ替えによる移動は<b>周回扱いにならない</b>（周回ボーナス・％奪取なし）',
              '複数人が同時に宣言した場合の処理はGMが裁定',
            ])}
          </div>`
        );

      case 'lapbonus': {
        const rates = R.lapBonusRates;
        const ex = rates[1] != null ? rates[1] : rates[0];
        return rule(
          slide,
          '周回ボーナス ― 後続人数 × 単価',
          `スタートを通過したプレイヤーは、<em>後続人数（まだその周回を達成していない人数）× 単価</em> を口座に受け取ります。<br>財源はバンク。ターンの終わりに支払われます。`,
          `<div class="r-itemrow">
            <table class="r-table">
              <tr><th>周回</th><th>単価（後続1人あたり）</th></tr>
              ${rates.map((r, i) => `<tr><td>${lapName(i)}${i === rates.length - 1 ? '以降' : ''}</td><td class="gold">${yen(r)} L$</td></tr>`).join('')}
            </table>
            <div class="r-example" style="--d:.6s">
              <div class="k">例：${rates[1] != null ? '2周目' : '1周目'}・後続5人</div>
              <div class="v">5 × ${yen(ex)} ＝ <b>${yen(5 * ex)} L$</b></div>
              <div class="s">同一ターンに複数人が周回しても各自この式で受給<br>端数は切り捨て</div>
            </div>
          </div>`
        );
      }

      case 'steal':
        return rule(
          slide,
          `％奪取 ― 下位${R.bottomN}位以内で周回した者の権利`,
          `周回直後の順位が <em>下位${R.bottomN}位以内</em>（${R.bottomN}位タイは全員含む）なら宣言できます。<br>対象の <em>プレイヤーナンバー</em> と <em>駒アルファベット</em> を <em>完全一致</em> で宣言すると、<br>対象の口座残高の <em>最大${pct(R.stealMaxRate)}</em> を奪取。`,
          `<div class="r-bubble" style="--d:.45s">「プレイヤーナンバー <b>7</b> の駒 <b>A</b> から <b>100,000 L$</b> 奪取します！」</div>
          <div class="r-pair small">
            <div class="r-card" style="--d:.7s"><div class="t">対象の口座残高</div><div class="big">2,000,000<small>L$</small></div><div class="s">→ 最大 ${yen(Math.floor(2000000 * R.stealMaxRate))} L$ を奪取可能</div></div>
            <div class="r-card" style="--d:.85s"><div class="t">対象の口座残高</div><div class="big">1,500,000<small>L$</small></div><div class="s">→ 最大 ${yen(Math.floor(1500000 * R.stealMaxRate))} L$ を奪取可能</div></div>
          </div>`
        );

      case 'steal-limits':
        return rule(
          slide,
          '％奪取の不成立 ― 失敗しても周回ボーナスは受け取れる',
          `以下の場合は ％奪取が <em>不成立</em> となり、通常の周回ボーナスのみを受け取ります。`,
          `${list(
            [
              '対象のプレイヤーナンバーと駒アルファベットが<b>一致しない</b>',
              '<b>同一の対象を連続するターンで指名</b>した',
              '<b>1回の周回で複数回</b>宣言した',
              '<b>同一ターン・同一対象</b>への成功がすでに存在する（最初の成功のみ有効）',
            ],
            'ng'
          )}
          <div class="r-note">奪取額の端数は切り捨て。対象の口座残高は0未満になりません。</div>`
        );

      case 'transfer':
        return rule(
          slide,
          '送受金 ― 口座残高はプレイヤー間で移動できる',
          `プレイヤー間で <em>口座残高の送受金</em> が可能です（処理はディーラーが行います）。<br>口座残高は送受金・周回ボーナス・％奪取の対象。チップはアイテム購入にのみ使用します。`,
          `<div class="r-transfer">
            <div class="r-acc" style="--d:.4s"><div class="t">口座</div><div class="tok">?</div></div>
            <div class="r-flowline"><span>L$</span></div>
            <div class="r-acc" style="--d:.6s"><div class="t">口座</div><div class="tok">?</div></div>
          </div>`
        );

      case 'penalty':
        return rule(
          slide,
          'ペナルティ ― 無提出と周回未達成',
          `投票の無提出と、ゲーム終了時点での周回未達成にはペナルティがあります。`,
          `<div class="r-pair">
            <div class="r-card warn" style="--d:.4s"><div class="t">無提出（白票）</div><div class="big">移動 0</div><div class="s">繰り返した場合は運営判断で<br>口座 −${yen(R.noSubmitPenalty)} L$</div></div>
            <div class="r-card warn" style="--d:.55s"><div class="t">ゲーム終了時に1周未満</div><div class="big">−${yen(R.underLapPenalty)}<small>L$</small></div><div class="s">口座から回収</div></div>
          </div>`
        );

      case 'winner':
        return rule(
          slide,
          '本ゲームの勝者 ― 最終得点が最も高いプレイヤー',
          `${R.totalTurns}ターン終了時の <em>口座残高 ＋ チップ − ${yen(R.initialAccount + R.initialChips)} L$</em> が最終得点。<br>最終得点が最も高いプレイヤーが勝者です（マイナスの得点でも勝者判定の対象）。`,
          `<div class="podium">
            <div class="pd s2"><div class="rk">2位</div></div>
            <div class="pd s1"><div class="crown">♛</div><div class="rk">1位</div></div>
            <div class="pd s3"><div class="rk">3位</div></div>
          </div>`
        );

      case 'prohibited':
        return rule(
          slide,
          '禁止事項',
          `以下の行為は禁止とし、違反は <em>ペナルティ・退場・失格</em> の対象となります。`,
          list(
            [
              'すごろくのボード・駒など、ディーラーが管理している物品に触れること',
              '投票用紙・カードの偽造・複製',
              '契約書や外部契約、ゲーム外での金銭・物品の授受',
              '暴力行為・過度な煽り・中傷・窃盗',
            ],
            'ng'
          )
        );

      case 'dealer':
        return rule(
          slide,
          'ディーラーの裁定が最終決定',
          `本ゲームの進行・裁定は <em>運営ディーラーの判断</em> に従ってください。<br>運営判断は最終決定とし、原則として覆りません。`,
          `<div class="r-gavel">⚖</div>`
        );

      case 'qa':
        return rule(
          slide,
          '質疑応答 ― 「はい」「いいえ」形式のみ',
          `質問は <em>「はい」または「いいえ」</em> で答えられる形式に限定して受け付けます。<br>戦略・アイテムの使い方等の助言は行えません。`,
          `<div class="r-qa"><div class="qa yes">はい</div><div class="or">or</div><div class="qa no">いいえ</div></div>`
        );
    }
    return `<div class="rule-wrap"><div class="rule-title">${slide.title}</div></div>`;
  }

  /** 見た目用の固定シャッフル例（毎回同じ並び） */
  function shuffleExample(arr) {
    const order = [2, 0, 5, 1, 4, 3];
    return order.map((i) => arr[i]);
  }

  root.LimitedDiceRules = { slideList, render, RULES };
})(typeof self !== 'undefined' ? self : this);
