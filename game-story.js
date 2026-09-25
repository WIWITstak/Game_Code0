// Story / dialogue system — pure data + pure helpers, no `this`/DOM/React.
// Loaded after game-economy.js, before game.js (same global scope).
//
// A dialogue is a small graph of nodes shown in a non-blocking bottom-centre
// panel (the sim keeps running). Each node has a speaker, a body, and 1..n
// choices; a choice can carry `effects` (credits / resources / faction
// relations / story flags) and either advances to another node (`goto`) or
// ends the dialogue.
//
// game.js owns the wiring: once per economy tick it calls Story.pick(state);
// if that returns a dialogue id it shows the panel. On a choice it calls
// Story.applyChoice(...) for the state patch, then advances or closes.
//
// Save state adds one field:  story: { seen:{}, flags:{}, activeId:null, node:null }
'use strict';

/* ------------------------------------------------------------------ */
/* speakers                                                            */
/* ------------------------------------------------------------------ */
const STORY_SPEAKERS = {
  ares:     { glyph: 'AR', color: '#5b8cff', name: { ru: 'ЦУП «Арес»',      en: 'Ares Mission Control' }, role: { ru: 'Земля · Хьюстон',        en: 'Earth · Houston' } },
  meridian: { glyph: 'AI', color: '#a98bff', name: { ru: 'МЕРИДИАН',        en: 'MERIDIAN' },             role: { ru: 'ИИ колонии',            en: 'Colony intelligence' } },
  azure:    { glyph: 'AZ', color: '#0bc6ab', name: { ru: 'Консул Вэрин',    en: 'Consul Vaerin' },        role: { ru: 'Лазурный Пакт',         en: 'Azure Compact' } },
  ironreach:{ glyph: 'IR', color: '#eea743', name: { ru: 'Смотритель Коль', en: 'Overseer Kohl' },        role: { ru: 'Айронрич Комбинат',     en: 'Ironreach Combine' } },
  verdant:  { glyph: 'VD', color: '#5cb572', name: { ru: 'Хранитель Ильза', en: 'Steward Ílsa' },         role: { ru: 'Круг Вердант',          en: 'Verdant Circle' } },
  admin:    { glyph: '//', color: '#858d92', name: { ru: 'Администратор',   en: 'Administrator' },         role: { ru: 'Меридиан-Стейшн',       en: 'Meridian Station' } },
};

/* ------------------------------------------------------------------ */
/* the opening arc                                                     */
/* ------------------------------------------------------------------ */
// helpers for triggers — `s` is live component state, `f` is story.flags
const sol   = (s) => Math.floor((s.cycle || 0) / 24);
const pop   = (s) => s.population || 0;
const built = (s) => (s.placed || []).length;
const techN = (s) => (typeof Economy !== 'undefined' && Economy.objectiveValue)
  ? Economy.objectiveValue(s, { type: 'tech' }) : 0;
const foodLow = (s) => (typeof Economy !== 'undefined' && Economy.foodStatus)
  ? Economy.foodStatus(s) < 0.5 : false;
const waterLow = (s) => (typeof Economy !== 'undefined' && Economy.waterStatus)
  ? Economy.waterStatus(s) < 0.5 : false;

const STORY_DIALOGUES = [

  /* 1 — arrival ---------------------------------------------------------- */
  {
    id: 'arrival', once: true, priority: 100,
    trigger: (s) => s.launched,
    start: 'a',
    nodes: {
      a: {
        speaker: 'ares',
        text: {
          ru: 'Меридиан-Стейшн, это «Арес». Посадка подтверждена, реактор в норме, шлюзы держат давление. Поздравляю, администратор — вы первый постоянный экипаж на этой стороне Луны.',
          en: 'Meridian Station, this is Ares. Touchdown confirmed, reactor nominal, airlocks holding pressure. Congratulations, Administrator — you are the first permanent crew on this side of the Moon.',
        },
        next: 'b',
      },
      b: {
        speaker: 'meridian',
        text: {
          ru: 'Системы жизнеобеспечения активны. Я — Меридиан, распределённый интеллект станции. Буду вести учёт, логистику и предупреждать вас до того, как что-то станет некрологом. С чего начнём, администратор?',
          en: 'Life support online. I am MERIDIAN, the station’s distributed intelligence. I keep the ledgers, the logistics, and the warnings that arrive before the obituaries. Where would you like to begin, Administrator?',
        },
        choices: [
          {
            text: { ru: 'Сначала выживание. Вода, воздух, еда — потом амбиции.', en: 'Survival first. Water, air, food — ambition later.' },
            effects: { flag: { doctrine: 'cautious' }, res: { WT: 200 } },
            goto: 'c_cautious',
          },
          {
            text: { ru: 'Мы здесь, чтобы построить город, а не бункер. Расширяемся.', en: 'We came to build a city, not a bunker. We expand.' },
            effects: { flag: { doctrine: 'bold' }, cr: 3000 },
            goto: 'c_bold',
          },
        ],
      },
      c_cautious: {
        speaker: 'meridian',
        text: {
          ru: 'Разумно. Я зарезервировала аварийный запас воды и отметила ближайшие ледяные залежи в кратерных тенях. Осторожная колония живёт дольше — по крайней мере, поначалу.',
          en: 'Sensible. I’ve set aside an emergency water reserve and flagged the nearest ice deposits in the crater shadows. A careful colony lives longer — at first, anyway.',
        },
        end: true,
      },
      c_bold: {
        speaker: 'meridian',
        text: {
          ru: '«Арес» перевёл стартовый грант раньше срока — считайте это авансом доверия. Тратьте с умом: следующий транш зависит от отчёта о населении.',
          en: 'Ares released the founding grant early — consider it an advance on their trust. Spend it well: the next tranche depends on your population report.',
        },
        end: true,
      },
    },
  },

  /* 2 — first lunar night --------------------------------------------- */
  {
    id: 'first_night', once: true, priority: 60,
    trigger: (s) => sol(s) >= 13,
    start: 'a',
    nodes: {
      a: {
        speaker: 'meridian',
        text: {
          ru: 'Солнце уходит за край кратера. Впереди четырнадцать сол настоящей ночи — солнечные панели станут декорацией. Надеюсь, вы это учли в энергобалансе.',
          en: 'The sun is dropping below the crater rim. Fourteen sols of real night ahead — the solar arrays become decoration. I hope you planned the power budget for this.',
        },
        choices: [
          {
            text: { ru: 'Урезать второстепенное потребление на ночь.', en: 'Cut non-essential draw for the night.' },
            effects: { flag: { rationedNight: true } },
            goto: 'b_ration',
          },
          {
            text: { ru: 'Держим всё как есть. Люди не должны мёрзнуть в темноте.', en: 'Keep everything running. People shouldn’t freeze in the dark.' },
            effects: { flag: { rationedNight: false } },
            goto: 'b_hold',
          },
        ],
      },
      b_ration: {
        speaker: 'meridian',
        text: {
          ru: 'Принято. Приглушаю оранжереи и внешнее освещение до рассвета. Колонисты поворчат, но батареи доживут до утра.',
          en: 'Acknowledged. Dimming the greenhouses and exterior lighting until dawn. The colonists will grumble, but the batteries will make it to morning.',
        },
        end: true,
      },
      b_hold: {
        speaker: 'meridian',
        text: {
          ru: 'Как скажете. Я буду следить за резервом. Если увидите красную полосу под верхней панелью — это я намекаю, что пора строить реактор.',
          en: 'As you wish. I’ll watch the reserve. If you see the red strip under the top bar — that’s me suggesting it’s time to build a reactor.',
        },
        end: true,
      },
    },
  },

  /* 3 — Azure Compact makes contact --------------------------------- */
  {
    id: 'azure_contact', once: true, priority: 55,
    trigger: (s) => sol(s) >= 6 && built(s) >= 7,
    start: 'a',
    nodes: {
      a: {
        speaker: 'azure',
        text: {
          ru: 'Администратор Меридиана. Я — Вэрин, от Лазурного Пакта. Мы строили замкнутые системы жизнеобеспечения, когда ваши инженеры ещё чертили их на салфетках. Пакт предлагает знакомство — пока только знакомство.',
          en: 'Administrator of Meridian. I am Vaerin, of the Azure Compact. We were building closed-loop life support when your engineers were still sketching it on napkins. The Compact offers an introduction — an introduction only, for now.',
        },
        choices: [
          {
            text: { ru: 'Рад знакомству. Нам есть чему у вас поучиться.', en: 'Glad to meet you. We have much to learn from you.' },
            effects: { relation: { azure: 8 }, flag: { metAzure: true, azureTone: 'warm' } },
            goto: 'b_warm',
          },
          {
            text: { ru: 'Знакомство принято. Об остальном поговорим, когда будет о чём.', en: 'Introduction noted. We’ll talk further when there’s something to discuss.' },
            effects: { relation: { azure: 2 }, flag: { metAzure: true, azureTone: 'neutral' } },
            goto: 'b_neutral',
          },
          {
            text: { ru: 'Земля уже обеспечивает нас технологиями. Спасибо, мы сами.', en: 'Earth already supplies our technology. Thank you, we manage.' },
            effects: { relation: { azure: -6 }, flag: { metAzure: true, azureTone: 'cool' } },
            goto: 'b_cool',
          },
        ],
      },
      b_warm: {
        speaker: 'azure',
        text: {
          ru: 'Хорошо. Я оставлю канал открытым. Когда ваши переработчики воды заработают, сравните цифры с нашими — думаю, вы удивитесь, сколько теряете.',
          en: 'Good. I’ll leave the channel open. When your water reclaimers come online, compare the numbers to ours — I think you’ll be surprised how much you lose.',
        },
        end: true,
      },
      b_neutral: {
        speaker: 'azure',
        text: {
          ru: 'Осторожность. Это я уважаю. Канал остаётся открытым — инициатива за вами.',
          en: 'Caution. That I respect. The channel stays open — the next move is yours.',
        },
        end: true,
      },
      b_cool: {
        speaker: 'azure',
        text: {
          ru: 'Земля далеко, администратор, и её грузовые окна открываются раз в месяц. Но пусть будет по-вашему. Мы здесь никуда не денемся.',
          en: 'Earth is far away, Administrator, and its cargo windows open once a month. But have it your way. We’re not going anywhere.',
        },
        end: true,
      },
    },
  },

  /* 4 — first supply crisis ---------------------------------------- */
  {
    id: 'the_shortage', once: true, priority: 90,
    trigger: (s) => sol(s) >= 4 && (foodLow(s) || waterLow(s)),
    start: 'a',
    nodes: {
      a: {
        speaker: 'meridian',
        text: {
          ru: 'Администратор, у нас дефицит по жизнеобеспечению. Запасы падают быстрее, чем восполняются. Ещё несколько сол такого — и я начну считать не колонистов, а потери.',
          en: 'Administrator, we have a life-support shortfall. Reserves are falling faster than they refill. A few more sols of this and I start counting losses, not colonists.',
        },
        choices: [
          {
            text: { ru: 'Запросить экстренный груз у «Ареса».', en: 'Request an emergency shipment from Ares.' },
            effects: { res: { WT: 1400, BM: 400 }, flag: { calledEarth: true, earthDebt: true } },
            goto: 'b_earth',
          },
          {
            text: { ru: 'Обойдёмся своими силами. Ввести нормирование.', en: 'We manage on our own. Impose rationing.' },
            effects: { flag: { resilient: true } },
            goto: 'b_self',
          },
          {
            text: { ru: 'Попросить помощи у Лазурного Пакта.', en: 'Ask the Azure Compact for help.' },
            requireFlag: { metAzure: true },
            effects: { res: { WT: 1000 }, relation: { azure: -10 }, flag: { azureDebt: true } },
            goto: 'b_azure',
          },
        ],
      },
      b_earth: {
        speaker: 'ares',
        text: {
          ru: 'Груз ушёл в следующее окно. Меридиан, это не благотворительность — стоимость вычтут из вашего гранта, а в отчёте будет строка «неспособность к автономному снабжению». Держитесь крепче.',
          en: 'The shipment is on the next window. Meridian, this isn’t charity — the cost comes out of your grant, and the report will carry a line reading "failure of autonomous supply". Hold it together.',
        },
        end: true,
      },
      b_self: {
        speaker: 'meridian',
        text: {
          ru: 'Нормы введены. Порции урезаны, вода по расписанию. Будет тяжело, и кто-то этого не забудет. Но колония, которая пережила это сама, — уже другая колония.',
          en: 'Rationing is in effect. Portions cut, water on a schedule. It will be hard, and some won’t forget it. But a colony that gets through this alone is a different colony afterward.',
        },
        end: true,
      },
      b_azure: {
        speaker: 'azure',
        text: {
          ru: 'Танкер уже в пути. Мы не выставляем счёт, администратор, — но мы запоминаем. Когда-нибудь Пакт попросит об ответной услуге, и отказать будет неловко.',
          en: 'The tanker is already underway. We won’t send a bill, Administrator — but we remember. One day the Compact will ask a favour in return, and refusing will be awkward.',
        },
        end: true,
      },
    },
  },

  /* 5 — Ironreach industry offer ---------------------------------- */
  {
    id: 'ironreach_offer', once: true, priority: 50,
    trigger: (s) => sol(s) >= 18 && built(s) >= 12,
    start: 'a',
    nodes: {
      a: {
        speaker: 'ironreach',
        text: {
          ru: 'Меридиан. Коль, Айронрич Комбинат. Мы видим ваши буровые площадки — любительский уровень, но порода хорошая. Комбинат поставит вам тяжёлое оборудование и выкупит излишки руды по фиксированной цене. Вы растёте вдвое быстрее. Мы получаем сырьё.',
          en: 'Meridian. Kohl, Ironreach Combine. We see your drill sites — amateur work, but the rock is good. The Combine will ship you heavy equipment and buy your surplus ore at a fixed price. You grow twice as fast. We get feedstock.',
        },
        choices: [
          {
            text: { ru: 'Согласны. Оборудование сейчас, руда потом.', en: 'Agreed. Equipment now, ore later.' },
            effects: { cr: 4000, res: { OR: 600 }, relation: { ironreach: 12, azure: -6 }, flag: { ironreachDeal: true } },
            goto: 'b_accept',
          },
          {
            text: { ru: 'Нет. Наши недра — не сырьевой придаток чужой промышленности.', en: 'No. Our ground is not a feedstock annex for someone else’s industry.' },
            effects: { relation: { ironreach: -8 }, flag: { ironreachDeal: false } },
            goto: 'b_decline',
          },
          {
            text: { ru: 'Оборудование берём. Но цену на руду фиксировать не будем.', en: 'We’ll take the equipment. But we’re not fixing the ore price.' },
            effects: { cr: 1500, relation: { ironreach: 3 }, flag: { ironreachDeal: 'partial' } },
            goto: 'b_counter',
          },
        ],
      },
      b_accept: {
        speaker: 'ironreach',
        text: {
          ru: 'Разумно. Первый транспорт с буровыми модулями стартует в это окно. И, Меридиан, — Лазурный Пакт будет недоволен. Они всегда недовольны, когда кто-то выбирает работу вместо их проповедей о балансе.',
          en: 'Sensible. The first transport with drilling modules leaves this window. And, Meridian — the Azure Compact won’t like it. They never like it when someone picks work over their sermons about balance.',
        },
        end: true,
      },
      b_decline: {
        speaker: 'ironreach',
        text: {
          ru: 'Гордость. Дорогая штука на Луне. Предложение остаётся в силе — вернётесь, когда посчитаете, сколько теряете на ручной добыче.',
          en: 'Pride. Expensive thing on the Moon. The offer stands — come back when you’ve counted what hand-mining costs you.',
        },
        end: true,
      },
      b_counter: {
        speaker: 'ironreach',
        text: {
          ru: 'Хм. Половина сделки — половина скидки. Оборудование придёт, но урезанное. Вы упрямый, администратор. Мне это даже нравится.',
          en: 'Hm. Half a deal, half the discount. The equipment comes, but stripped down. You’re stubborn, Administrator. I almost like it.',
        },
        end: true,
      },
    },
  },

  /* 6 — Verdant Circle on ethics -------------------------------- */
  {
    id: 'verdant_appeal', once: true, priority: 45,
    trigger: (s) => techN(s) >= 4,
    start: 'a',
    nodes: {
      a: {
        speaker: 'verdant',
        text: {
          ru: 'Администратор, я Ильза, из Круга Вердант. Ваши исследователи подошли к терраформным технологиям. Прежде чем вы измените эту Луну навсегда — Круг просит об одном: не троньте площадки «Аполлона» и старые кратеры высадок. Это не ресурс. Это память вида.',
          en: 'Administrator, I am Ílsa, of the Verdant Circle. Your researchers are approaching terraforming technology. Before you change this Moon forever — the Circle asks one thing: leave the Apollo sites and the old landing craters untouched. They are not a resource. They are the species’ memory.',
        },
        choices: [
          {
            text: { ru: 'Даю слово. Наследие «Аполлона» — под защитой колонии.', en: 'You have my word. The Apollo legacy is under colony protection.' },
            effects: { relation: { verdant: 10 }, flag: { ecoStance: 'preserve' } },
            goto: 'b_preserve',
          },
          {
            text: { ru: 'Мы взвесим каждый случай. Обещать заранее не буду.', en: 'We’ll weigh each case. I won’t promise in advance.' },
            effects: { relation: { verdant: 1 }, flag: { ecoStance: 'pragmatic' } },
            goto: 'b_pragmatic',
          },
          {
            text: { ru: 'Колония важнее реликвий. Если понадобится — снесём.', en: 'The colony matters more than relics. If we must, we’ll clear them.' },
            effects: { relation: { verdant: -12 }, flag: { ecoStance: 'develop' } },
            goto: 'b_develop',
          },
        ],
      },
      b_preserve: {
        speaker: 'verdant',
        text: {
          ru: 'Спасибо. Круг это запомнит — и когда придёт время терраформинга, наши агрономы будут работать рядом с вашими, а не против них.',
          en: 'Thank you. The Circle will remember — and when terraforming begins, our agronomists will work beside yours, not against them.',
        },
        end: true,
      },
      b_pragmatic: {
        speaker: 'verdant',
        text: {
          ru: 'Честно. Нечестно было бы обещать и нарушить. Мы будем наблюдать, администратор. Внимательно.',
          en: 'Honest. It would be less honest to promise and break it. We’ll be watching, Administrator. Closely.',
        },
        end: true,
      },
      b_develop: {
        speaker: 'verdant',
        text: {
          ru: 'Тогда нам не о чем говорить — пока. Но знайте: то, что вы уничтожите здесь, нельзя будет отстроить заново. Никогда.',
          en: 'Then we have nothing to discuss — for now. But know this: what you destroy here cannot be rebuilt. Ever.',
        },
        end: true,
      },
    },
  },

  /* 7 — Earth tightens the leash -------------------------------- */
  {
    id: 'earth_audit', once: true, priority: 40,
    trigger: (s) => sol(s) >= 26 && pop(s) >= 60,
    start: 'a',
    nodes: {
      a: {
        speaker: 'ares',
        text: {
          ru: 'Меридиан, совет директоров получил ваши отчёты. Колония растёт — и растут вопросы. Вы заключаете сделки с орбитальными фракциями без согласования с Землёй. «Арес» напоминает: устав подписан здесь, в Хьюстоне.',
          en: 'Meridian, the board has your reports. The colony is growing — and so are the questions. You’re cutting deals with orbital factions without clearing them with Earth. Ares reminds you: the charter was signed here, in Houston.',
        },
        choices: [
          {
            text: { ru: 'Устав подписан на Земле. Но выполняется здесь — нами.', en: 'The charter was signed on Earth. But it’s carried out here — by us.' },
            effects: { flag: { earthStance: 'defiant' } },
            goto: 'b_defiant',
          },
          {
            text: { ru: 'Понял. Впредь крупные соглашения — через согласование.', en: 'Understood. Major agreements go through review from now on.' },
            effects: { cr: 2500, flag: { earthStance: 'compliant' } },
            goto: 'b_compliant',
          },
        ],
      },
      b_defiant: {
        speaker: 'ares',
        text: {
          ru: 'Записано дословно. Надеюсь, вы понимаете, что говорите это на канале, который слушает весь совет. Следующее грузовое окно... возможно, задержится.',
          en: 'Logged verbatim. I hope you realise you’re saying this on a channel the whole board is listening to. The next cargo window... may run late.',
        },
        end: true,
      },
      b_compliant: {
        speaker: 'ares',
        text: {
          ru: 'Благоразумно. Совет ценит сотрудничество — и подтверждает следующий транш гранта. Продолжайте в том же духе, администратор.',
          en: 'Prudent. The board values cooperation — and confirms the next grant tranche. Keep it up, Administrator.',
        },
        end: true,
      },
    },
  },

  /* 8 — the crossroads (arc finale) ---------------------------- */
  {
    id: 'the_crossroads', once: true, priority: 30,
    trigger: (s) => sol(s) >= 40 || pop(s) >= 120,
    start: 'a',
    nodes: {
      a: {
        speaker: 'meridian',
        text: {
          ru: 'Администратор. Колония перешла порог: мы больше не эксперимент, мы поселение. И это значит, что пора решить, чем мы становимся. «Арес» ждёт вашего заявления о статусе. Фракции ждут тоже.',
          en: 'Administrator. The colony has crossed a threshold: we are no longer an experiment, we are a settlement. Which means it’s time to decide what we become. Ares is waiting for your statement of status. So are the factions.',
        },
        next: 'b',
      },
      b: {
        speaker: 'admin',
        text: {
          ru: 'Меридиан-Стейшн, сектор 12. Настоящим объявляю о статусе колонии:',
          en: 'Meridian Station, Sector 12. I hereby declare the colony’s status:',
        },
        choices: [
          {
            text: { ru: 'Территория Земли. Мы — форпост, и гордимся этим.', en: 'Territory of Earth. We are an outpost, and proud of it.' },
            effects: { cr: 8000, flag: { arc1: 'loyal' } },
            goto: 'c_loyal',
          },
          {
            text: { ru: 'Свободное поселение. Устав переписываем здесь.', en: 'A free settlement. We rewrite the charter here.' },
            effects: { relation: { azure: 6, ironreach: 6, verdant: 4 }, flag: { arc1: 'autonomous' } },
            goto: 'c_autonomous',
          },
          {
            text: { ru: 'Автономия в составе. Земля — партнёр, не хозяин.', en: 'Autonomy within the framework. Earth is a partner, not an owner.' },
            effects: { cr: 3000, relation: { azure: 3 }, flag: { arc1: 'balanced' } },
            goto: 'c_balanced',
          },
        ],
      },
      c_loyal: {
        speaker: 'ares',
        text: {
          ru: 'Совет доволен. Меридиан-Стейшн получает статус приоритетного форпоста — двойные грузовые окна, прямая линия финансирования. Земля своих не бросает, администратор. Помните это.',
          en: 'The board is pleased. Meridian Station receives priority outpost status — double cargo windows, a direct funding line. Earth doesn’t abandon its own, Administrator. Remember that.',
        },
        end: true,
      },
      c_autonomous: {
        speaker: 'azure',
        text: {
          ru: 'Смело. И одиноко — на первое время. Но Пакт, Комбинат и Круг только что услышали, что с вами можно говорить как с равными. На Луне это дороже, чем гранты с Земли.',
          en: 'Bold. And lonely — at first. But the Compact, the Combine and the Circle just heard that you can be spoken to as equals. On the Moon that’s worth more than grants from Earth.',
        },
        end: true,
      },
      c_balanced: {
        speaker: 'meridian',
        text: {
          ru: 'Средний путь. Самый узкий из трёх — и самый долгий. Земля не аплодирует, фракции не ликуют, но обе стороны продолжают разговаривать. Пока этого достаточно.',
          en: 'The middle path. The narrowest of the three — and the longest. Earth doesn’t applaud, the factions don’t cheer, but both keep talking. For now that’s enough.',
        },
        end: true,
      },
    },
  },
];

/* ------------------------------------------------------------------ */
/* pure helpers used by game.js                                        */
/* ------------------------------------------------------------------ */
const Story = {
  speakers: STORY_SPEAKERS,
  dialogues: STORY_DIALOGUES,

  // Dynamically-registered one-off dialogues (ally offers etc.) — same shape as
  // a STORY_DIALOGUES entry ({ id, start, nodes }). game.js registers one, sets
  // story.activeId to its id, and clears it when the panel closes.
  _dynamic: {},
  registerDynamic(dlg) { if (dlg && dlg.id) Story._dynamic[dlg.id] = dlg; return dlg && dlg.id; },
  clearDynamic(id) { delete Story._dynamic[id]; },

  speaker(id) { return STORY_SPEAKERS[id] || STORY_SPEAKERS.admin; },
  dialogue(id) { return STORY_DIALOGUES.find((d) => d.id === id) || Story._dynamic[id] || null; },

  // Highest-priority dialogue whose trigger fires and that hasn't been seen.
  // Returns an id or null. Never throws.
  pick(state) {
    const story = state.story || {};
    const seen = story.seen || {};
    const flags = story.flags || {};
    if (story.activeId) return null;
    let best = null;
    for (const d of STORY_DIALOGUES) {
      if (d.once && seen[d.id]) continue;
      let ok = false;
      try { ok = !!d.trigger(state, flags); } catch (e) { ok = false; }
      if (!ok) continue;
      if (!best || (d.priority || 0) > (best.priority || 0)) best = d;
    }
    return best ? best.id : null;
  },

  // Resolve a node into { speaker, text, choices:[{ text, index, disabled }] }
  // for the given language. `next`/`end` shorthands become a single choice.
  node(dialogueId, nodeKey, lang, flags) {
    const d = Story.dialogue(dialogueId);
    if (!d) return null;
    const n = d.nodes[nodeKey];
    if (!n) return null;
    const L = (o) => (o && (o[lang] || o.ru || o.en)) || '';
    let choices = n.choices;
    if (!choices) {
      choices = n.end ? [{ __end: true, text: { ru: 'Закрыть', en: 'Close' } }]
                      : [{ goto: n.next, text: { ru: 'Далее', en: 'Continue' } }];
    }
    return {
      speaker: n.speaker || 'admin',
      text: L(n.text),
      choices: choices.map((c, i) => ({
        index: i,
        label: L(c.text),
        locked: !!(c.requireFlag && !Object.keys(c.requireFlag).every((k) => (flags || {})[k] === c.requireFlag[k])),
      })),
    };
  },

  // Apply choice `i` of (dialogueId, nodeKey). Returns:
  //   { patch, flags, nextNode | null (dialogue ends) }
  // `patch` is a state patch (resources / diploRelations); `flags` is the delta
  // to merge into story.flags. Pure — caller does the setState.
  applyChoice(state, dialogueId, nodeKey, i) {
    const d = Story.dialogue(dialogueId);
    const n = d && d.nodes[nodeKey];
    let choice;
    if (n && n.choices) choice = n.choices[i];
    else if (n && n.end) choice = { __end: true };
    else if (n) choice = { goto: n.next };
    if (!choice) return { patch: {}, flags: {}, nextNode: null };

    const patch = {};
    const flags = {};
    const fx = choice.effects || {};

    if (fx.cr) {
      patch.resources = Object.assign({}, state.resources);
      patch.resources.CR = Math.max(0, Math.round((patch.resources.CR || 0) + fx.cr));
    }
    if (fx.res) {
      patch.resources = patch.resources || Object.assign({}, state.resources);
      for (const k in fx.res) patch.resources[k] = Math.max(0, Math.round((patch.resources[k] || 0) + fx.res[k]));
    }
    if (fx.relation) {
      const base = {};
      if (typeof FACTIONS !== 'undefined') FACTIONS.forEach((f) => { base[f.id] = f.relation; });
      patch.diploRelations = Object.assign({}, state.diploRelations || {});
      for (const id in fx.relation) {
        const cur = patch.diploRelations[id] != null ? patch.diploRelations[id] : (base[id] != null ? base[id] : 50);
        patch.diploRelations[id] = Math.max(0, Math.min(100, Math.round((cur + fx.relation[id]) * 100) / 100));
      }
    }
    if (fx.flag) for (const k in fx.flag) flags[k] = fx.flag[k];

    const nextNode = choice.__end ? null : (choice.goto || null);
    return { patch, flags, nextNode, effects: fx };
  },

  // Short localized summary of a choice's mechanical effect, for the UI.
  effectHint(effects, lang) {
    if (!effects) return '';
    const p = [];
    if (effects.cr) p.push((effects.cr > 0 ? '+' : '') + effects.cr + ' CR');
    if (effects.res) for (const k in effects.res) p.push((effects.res[k] > 0 ? '+' : '') + effects.res[k] + ' ' + k);
    if (effects.relation) for (const id in effects.relation) {
      const nm = (typeof FACTIONS !== 'undefined' && (FACTIONS.find((f) => f.id === id) || {}).name) || id;
      p.push((effects.relation[id] > 0 ? '+' : '') + effects.relation[id] + ' ' + String(nm).split(' ')[0]);
    }
    if (effects.sectorGrant) p.push((lang === 'en' ? 'Sector ' : 'Сектор ') + String(effects.sectorGrant).replace(/^s0?/, ''));
    return p.join('  ·  ');
  },
};

if (typeof window !== 'undefined') { window.Story = Story; window.STORY_SPEAKERS = STORY_SPEAKERS; }
