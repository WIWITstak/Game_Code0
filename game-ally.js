// Ally AI — the Azure Compact runs its own background colony: it accrues
// resources, works through a development tree, grows, scouts and claims
// neutral sectors, and periodically sends the player offers (accepted/declined
// through the story dialogue panel).
//
// Pure module: Ally.tick(state, sol) -> a plain result object; game.js applies
// it to component state in _runEconomyTick. Loaded after game-story.js, before
// game.js. Save field: `ally` (see Ally.fresh).
'use strict';

const ALLY_FACTION = 'azure';

// Development tree — each node unlocks a capability once the ally banks its
// `cost` in research points (rp output scales with strength + sectors held).
// `needs` is a prerequisite node id.
const ALLY_TECH = [
  { id: 'a1', needs: null, cost: 45,  name: { ru: 'Замкнутый цикл',        en: 'Closed loop' },        fx: { resGen: 2 } },
  { id: 'a2', needs: 'a1', cost: 80,  name: { ru: 'Солнечные фермы',       en: 'Solar farms' },        fx: { crGen: 95 } },
  { id: 'a3', needs: 'a1', cost: 120, name: { ru: 'Разведсеть',            en: 'Survey network' },     fx: { canScout: true } },
  { id: 'a4', needs: 'a3', cost: 180, name: { ru: 'Колониальный устав',    en: 'Colonial charter' },   fx: { canClaim: true } },
  { id: 'a5', needs: 'a2', cost: 230, name: { ru: 'Пакт взаимопомощи',     en: 'Mutual aid pact' },    fx: { canAid: true } },
  { id: 'a6', needs: 'a5', cost: 320, name: { ru: 'Глубокая рекуперация',  en: 'Deep reclamation' },   fx: { resGen: 4 } },
  { id: 'a7', needs: 'a4', cost: 400, name: { ru: 'Совместная логистика',  en: 'Joint logistics' },    fx: { canGiftSector: true } },
  { id: 'a8', needs: 'a6', cost: 520, name: { ru: 'Орбитальная верфь',     en: 'Orbital yard' },       fx: { crGen: 130 } },
  { id: 'a9', needs: 'a8', cost: 700, name: { ru: 'Терраформ-подготовка',  en: 'Terraform prep' },     fx: { resGen: 8, crGen: 200 } },
];

function allyPick(o, lang) { return (o && (o[lang] || o.ru || o.en)) || ''; }

const Ally = {
  faction: ALLY_FACTION,
  tech: ALLY_TECH,

  fresh() {
    return {
      faction: ALLY_FACTION,
      strength: 5,
      cr: 4200,
      res: { OR: 220, WT: 220, TI: 60, H3: 40 },
      tech: [],
      research: null,          // { id, progress }
      buildings: 6,
      sectorsClaimed: [],      // sector ids the ally has claimed itself (s11 is implicit)
      sectorsScouted: [],      // sector ids the ally has scouted (data shared with the player)
      lastAidSol: -99,
      lastOfferSol: -6,        // lets an offer land within the first several sols
      pendingOfferId: null,    // dynamic-dialogue id currently in front of the player
      log: [],                 // [{ sol, text:{ru,en} }] newest-first, capped
    };
  },

  // Every sector whose effective status is 'allied' belongs to the ally.
  sectors(state) {
    var out = [];
    if (typeof SECTORS !== 'undefined') {
      SECTORS.forEach(function (sc) {
        var st = ((state.sectorState || {})[sc.id]) || sc.status;
        if (st === 'allied') out.push(sc.id);
      });
    }
    return out;
  },

  caps(ally) {
    var c = { resGen: 1, crGen: 36, canScout: false, canClaim: false, canAid: false, canGiftSector: false };
    (ally.tech || []).forEach(function (id) {
      var n = ALLY_TECH.find(function (x) { return x.id === id; });
      if (!n) return;
      for (var k in n.fx) {
        if (typeof n.fx[k] === 'number') c[k] = (c[k] || 0) + n.fx[k];
        else c[k] = n.fx[k];
      }
    });
    return c;
  },

  standing(state) {
    var rel = (state.diploRelations && state.diploRelations[ALLY_FACTION] != null)
      ? state.diploRelations[ALLY_FACTION]
      : ((typeof FACTIONS !== 'undefined' && (FACTIONS.find(function (f) { return f.id === ALLY_FACTION; }) || {}).relation) || 50);
    var key = (typeof standingKey === 'function') ? standingKey(rel) : 'neutral';
    return { rel: rel, key: key };
  },

  // A pristine sector the ally can scout: unexplored, untouched by the player.
  _scoutTarget(state) {
    if (typeof SECTORS === 'undefined') return null;
    var ss = state.sectorState || {};
    return SECTORS.find(function (sc) {
      return sc.id !== 's12' && sc.status === 'unexplored' && !ss[sc.id];
    }) || null;
  },
  // A sector the ally can claim for itself: pristine, OR one it scouted earlier
  // and the player hasn't taken.
  _claimTarget(state, a) {
    if (typeof SECTORS === 'undefined') return null;
    var ss = state.sectorState || {};
    var scouted = a.sectorsScouted || [];
    return SECTORS.find(function (sc) {
      if (sc.id === 's12' || sc.status !== 'unexplored') return false;
      var cur = ss[sc.id];
      if (!cur) return true;                                   // pristine
      return cur === 'scouted' && scouted.indexOf(sc.id) !== -1; // ally-scouted, still free
    }) || null;
  },

  // One sol of ally life. Never throws. Returns:
  //   { ally, events:[{kind,text}], scout:sectorId|null, claim:sectorId|null,
  //     aid:{CODE:n}|null, offer:<dynamic-dialogue>|null }
  tick(state, sol) {
    var res = { ally: null, events: [], scout: null, claim: null, aid: null, offer: null };
    var a;
    try { a = JSON.parse(JSON.stringify(state.ally || Ally.fresh())); }
    catch (e) { a = Ally.fresh(); }
    if (!a.res) a.res = {};
    if (!a.tech) a.tech = [];
    res.ally = a;

    var caps = Ally.caps(a);
    var stand = Ally.standing(state);
    var held = Ally.sectors(state).length + (a.sectorsClaimed || []).length;
    var log = function (text) { a.log = [{ sol: sol, text: text }].concat(a.log || []).slice(0, 20); };

    // 1 — income
    a.cr += Math.round(caps.crGen * (0.7 + a.strength * 0.06) + held * 110);
    ['OR', 'WT', 'H3', 'TI'].forEach(function (code) {
      a.res[code] = (a.res[code] || 0) + Math.round(caps.resGen * (0.5 + a.strength * 0.04) + held);
    });

    // 2 — research
    var rp = Math.round(6 + a.strength * 1.5 + held * 3);
    if (!a.research) {
      var next = ALLY_TECH.find(function (n) {
        return a.tech.indexOf(n.id) === -1 && (!n.needs || a.tech.indexOf(n.needs) !== -1);
      });
      if (next) a.research = { id: next.id, progress: 0 };
    }
    if (a.research) {
      a.research.progress += rp;
      var rn = ALLY_TECH.find(function (x) { return x.id === a.research.id; });
      if (rn && a.research.progress >= rn.cost) {
        a.tech.push(rn.id);
        a.research = null;
        var tt = { ru: 'Лазурный Пакт освоил: ' + rn.name.ru, en: 'Azure Compact researched: ' + rn.name.en };
        res.events.push({ kind: 'tech', text: tt });
        log(tt);
        caps = Ally.caps(a);
      }
    }

    // 3 — sector activity (one action per few sols; claim beats scout).
    //     Keep a CR reserve when the ally can claim, so it can actually afford one.
    var claimReserve = caps.canClaim ? 5000 : 0;
    if ((caps.canScout || caps.canClaim) && stand.key !== 'strained' && sol % 3 === 0) {
      var claimT = caps.canClaim && a.cr >= 4200 ? Ally._claimTarget(state, a) : null;
      if (claimT) {
        a.cr -= 4200;
        res.claim = claimT.id;
        a.sectorsClaimed = (a.sectorsClaimed || []).concat([claimT.id]);
        var ct = { ru: 'Лазурный Пакт занял Сектор ' + claimT.num, en: 'Azure Compact claimed Sector ' + claimT.num };
        res.events.push({ kind: 'claim', text: ct });
        log(ct);
      } else if (caps.canScout) {
        var scoutT = Ally._scoutTarget(state);
        if (scoutT) {
          res.scout = scoutT.id;
          a.sectorsScouted = (a.sectorsScouted || []).concat([scoutT.id]);
          var scT = { ru: 'Лазурный Пакт разведал Сектор ' + scoutT.num + ' — данные переданы вам', en: 'Azure Compact scouted Sector ' + scoutT.num + ' — data shared' };
          res.events.push({ kind: 'scout', text: scT });
          log(scT);
        }
      }
    }

    // 4 — build & grow. Hold off while saving for a claim target.
    var savingForClaim = caps.canClaim && a.cr < 5200 && !!Ally._claimTarget(state, a);
    if (a.cr >= 900 + claimReserve && sol % 2 === 0 && !savingForClaim) {
      a.cr -= 900;
      a.buildings += 1;
      if (a.buildings % 4 === 0) {
        a.strength += 1;
        var gt = { ru: 'Лазурный Пакт расширил колонию · сила ' + a.strength, en: 'Azure Compact expanded — strength ' + a.strength };
        res.events.push({ kind: 'grow', text: gt });
        log(gt);
      }
    }

    // 5 — emergency aid (allied, real shortfall, cooldown)
    if (caps.canAid && stand.key === 'allied' && (sol - a.lastAidSol) >= 4) {
      var food = (typeof Economy !== 'undefined' && Economy.foodStatus) ? Economy.foodStatus(state) : 1;
      var water = (typeof Economy !== 'undefined' && Economy.waterStatus) ? Economy.waterStatus(state) : 1;
      if (food < 0.62 || water < 0.62) {
        a.lastAidSol = sol;
        res.aid = { WT: 1300, BM: 450 };
        var at = { ru: 'Лазурный Пакт прислал экстренную помощь', en: 'Azure Compact sent emergency relief' };
        res.events.push({ kind: 'aid', text: at });
        log(at);
      }
    }

    // 6 — an offer (cooldown, not while one is already pending, not if strained)
    if (!a.pendingOfferId && stand.key !== 'strained' && (sol - a.lastOfferSol) >= 6) {
      var offer = Ally._makeOffer(state, a, caps, stand);
      if (offer) {
        res.offer = offer;
        a.pendingOfferId = offer.id;
        a.lastOfferSol = sol;
      }
    }

    return res;
  },

  // Build one offer as a single-node dialogue (story-panel shape). Returns null
  // when nothing fits. Choice `effects` reuse the story vocab + `sectorGrant`.
  _makeOffer(state, a, caps, stand) {
    var pool = [];
    var cr = (state.resources && state.resources.CR) || 0;

    // routine solidarity shipment — always available, pure upside
    pool.push({
      w: 3,
      text: { ru: 'Администратор, плановая поставка солидарности от Пакта. Вода и немного кредитов — сочтёмся позже.', en: 'Administrator, a scheduled solidarity shipment from the Compact. Water and a little credit — we’ll settle up later.' },
      choices: [
        { text: { ru: 'Принять с благодарностью', en: 'Accept with thanks' }, effects: { res: { WT: 700 }, cr: 900, relation: { azure: 2 } } },
        { text: { ru: 'Не сейчас', en: 'Not now' }, decline: true },
      ],
    });

    // resource trade — the ally sells surplus
    var sellCode = (a.res.RE > 200) ? 'RE' : (a.res.TI > 300 ? 'TI' : 'OR');
    var sellAmt = 400;
    var price = sellCode === 'RE' ? 3200 : (sellCode === 'TI' ? 2200 : 1800);
    if (cr >= price) {
      pool.push({
        w: 3,
        text: { ru: 'У нас излишек — ' + sellAmt + ' ед. сырья. Отдадим за ' + price + ' CR. Выгоднее, чем везти с пояса.', en: 'We have a surplus — ' + sellAmt + ' units of feedstock, yours for ' + price + ' CR. Cheaper than hauling it from the belt.' },
        choices: [
          { text: { ru: 'Купить · ' + price + ' CR', en: 'Buy · ' + price + ' CR' }, effects: { res: (function () { var o = {}; o[sellCode] = sellAmt; return o; })(), cr: -price } },
          { text: { ru: 'Отказаться', en: 'Decline' }, decline: true },
        ],
      });
    }

    // tech share (once the ally is a few nodes deep)
    if (a.tech.length >= 3 && cr >= 3000) {
      pool.push({
        w: 2,
        text: { ru: 'Наши инженеры готовы поделиться наработками по замкнутым системам. 3 000 CR — и ваши переработчики станут заметно эффективнее.', en: 'Our engineers will share the closed-loop work. 3,000 CR and your reclaimers get noticeably more efficient.' },
        choices: [
          { text: { ru: 'Принять обмен · 3 000 CR', en: 'Accept the exchange · 3,000 CR' }, effects: { cr: -3000, res: { WT: 300, BM: 200, SC: 60 }, relation: { azure: 3 } } },
          { text: { ru: 'В другой раз', en: 'Another time' }, decline: true },
        ],
      });
    }

    // sector gift — allied + joint-logistics tech + the ally holds > 1 sector
    if (caps.canGiftSector && stand.key === 'allied') {
      var gift = (a.sectorsClaimed || []).find(function (id) {
        return ((state.sectorState || {})[id]) === 'allied' || (typeof SECTORS !== 'undefined' && (SECTORS.find(function (s) { return s.id === id; }) || {}).status === 'allied');
      });
      if (gift) {
        var gn = (typeof SECTORS !== 'undefined' && (SECTORS.find(function (s) { return s.id === gift; }) || {}).num) || '';
        pool.push({
          w: 4,
          text: { ru: 'Меридиан-Стейшн ближе к Сектору ' + gn + ', чем мы. Пакт уступает его вам — работайте с ним лучше, чем смогли бы мы.', en: 'Meridian Station is closer to Sector ' + gn + ' than we are. The Compact cedes it to you — do more with it than we could.' },
          choices: [
            { text: { ru: 'Принять сектор', en: 'Accept the sector' }, effects: { sectorGrant: gift, relation: { azure: 4 } } },
            { text: { ru: 'Пусть остаётся у вас', en: 'Keep it' }, decline: true, effects: { relation: { azure: 1 } } },
          ],
        });
      }
    }

    // joint pressure on the rival (allied, s13 still hostile, not yet softened)
    var s13 = ((state.sectorState || {})['s13']) || 's13ai';
    var softened = state.story && state.story.flags && state.story.flags.s13Softened;
    if (stand.key === 'allied' && s13 === 'ai' && !softened && cr >= 4000) {
      pool.push({
        w: 3,
        text: { ru: 'Мы можем надавить на операцию соперника в Секторе 13 с орбиты. 4 000 CR на нашу долю — и выбить их оттуда станет вдвое дешевле.', en: 'We can lean on the rival operation in Sector 13 from orbit. 4,000 CR toward our share and driving them out gets far cheaper.' },
        choices: [
          { text: { ru: 'Согласиться · 4 000 CR', en: 'Agree · 4,000 CR' }, effects: { cr: -4000, flag: { s13Softened: true }, relation: { azure: 3 } } },
          { text: { ru: 'Справимся сами', en: 'We’ll handle it' }, decline: true },
        ],
      });
    }

    if (!pool.length) return null;
    var total = pool.reduce(function (s, o) { return s + o.w; }, 0);
    var seed = (state.cycle || 0) + (a.buildings || 0) * 7 + a.tech.length * 13;
    var r = (seed % 997) / 997 * total;
    var chosen = pool[pool.length - 1];
    for (var i = 0; i < pool.length; i++) { r -= pool[i].w; if (r <= 0) { chosen = pool[i]; break; } }

    return {
      id: '__ally_' + (state.cycle || 0),
      start: 'a',
      nodes: {
        a: {
          speaker: 'azure',
          text: chosen.text,
          choices: chosen.choices.map(function (c) {
            return { text: c.text, effects: c.effects || null, __end: true };
          }),
        },
      },
    };
  },
};

if (typeof window !== 'undefined') { window.Ally = Ally; window.ALLY_TECH = ALLY_TECH; }
