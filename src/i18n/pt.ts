// Textos em português (Portugal). Tipado contra en.ts: cada chave tem de
// estar traduzida, senão o typecheck falha. `{nome}` marca um valor.
import type { Key } from './en.js';

export const PT: Record<Key, string> = {
  // ---- a garagem ----
  'garage.pageTitle': 'A Minha Garagem',
  'garage.title': 'A Minha Garagem',
  'garage.help': 'roda o volante para escolher · carrega no pedal para ir',
  'garage.go': 'VAMOS!',
  'garage.letsGo': '{title}. Vamos lá!',
  'garage.language': 'Língua',

  // ---- os modos de jogo ----
  'mode.truck.title': 'Camião dos Bombeiros',
  'mode.truck.blurb': 'Apaga os fogos e salva os gatinhos!',
  'mode.police.title': 'Carro da Polícia',
  'mode.police.blurb': 'Persegue os carros dos ladrões!',
  'mode.ambulance.title': 'Ambulância',
  'mode.ambulance.blurb': 'Ajuda as pessoas que precisam de ti!',
  'mode.heliMedical.title': 'Helicóptero de Salvamento',
  'mode.heliMedical.blurb': 'Voa e iça as pessoas para as salvar!',
  'mode.heliPolice.title': 'Helicóptero da Polícia',
  'mode.heliPolice.blurb': 'Mantém os ladrões debaixo da tua luz!',
  'mode.plane.title': 'Avião',
  'mode.plane.blurb': 'Voa pelos anéis no céu!',
  'mode.boat.title': 'Barco',
  'mode.boat.blurb': 'Navega entre as boias!',
  'mode.train.title': 'Comboio',
  'mode.train.blurb': 'Leva o comboio a todas as estações!',
  'mode.race.title': 'Corrida de Karts',
  'mode.race.blurb': 'Três voltas — corre até à bandeira!',

  // ---- a página do jogo ----
  'city.pageTitle': 'Cidade Sem Fim',
  'city.hint': '<b>W / ↑</b> acelerar &nbsp; <b>S / ↓</b> travar &nbsp; <b>A D / ← →</b> virar &nbsp; <b>ESPAÇO / A</b> água / salvar &nbsp; <b>E</b> sirene &nbsp; <b>C</b> câmara (atrás · alto · cabine) &nbsp; <b>R</b> recomeçar<br>Volante USB: o volante e os pedais funcionam logo',
  'city.loadingPanel': 'a carregar…',
  'city.siren': 'SIRENE',
  'city.home': 'voltar à garagem (Esc)',
  'city.hud': 'ilha {bx},{by} · {mode} · {kmh} km/h · chamadas de desenho {calls} · triângulos {tris}',

  // ---- a carregar ----
  'load.ready': 'A preparar…',
  'load.island': 'A fazer crescer a tua ilha…',
  'load.kits': 'A tirar os brinquedos da caixa…',
  'load.streets': 'A construir as ruas…',
  'load.almost': 'quase!',
  'load.about': 'mais ou menos {s} s',
  'load.done': 'Pronto!',
  'load.nextIsland': '🏝️ A próxima ilha vem a caminho… {eta}',

  // ---- pontos ----
  'score.runTruck': 'agora: {fires} fogos · {cats} salvamentos',
  'score.totalTruck': 'no total: {fires} 🔥 · {cats} 🐱 salvos',
  'score.run': 'agora: {n} ⭐',
  'score.total': 'no total: {n} ⭐',

  // ---- câmara ----
  'cam.label': 'CÂMARA: {mode}',
  'cam.chase': 'ATRÁS',
  'cam.high': 'ALTO',
  'cam.cab': 'CABINE',

  // ---- chamadas ----
  'call.fireOut': '🔥 FOGO APAGADO!',
  'call.catSaved': '🐱 GATINHO SALVO!',
  'call.allSafe': '🧑‍🚒 ESTÃO TODOS A SALVO!',
  'call.personSaved': '🆘 PESSOA SALVA!',
  'call.hover': 'FICA AQUI NO AR!',
  'call.stop': 'PARA AQUI!',
  'call.drive.fire': 'VAI ATÉ AO FOGO',
  'call.drive.cat': 'VAI ATÉ AO GATINHO',
  'call.drive.rescue': 'VAI ATÉ À CASA A ARDER',
  'call.drive.patient': 'VAI ATÉ À PESSOA',
  'call.fly.fire': 'VOA ATÉ AO FOGO',
  'call.fly.cat': 'VOA ATÉ AO GATINHO',
  'call.fly.rescue': 'VOA ATÉ À CASA A ARDER',
  'call.fly.patient': 'VOA ATÉ À PESSOA',
  'call.waiting': 'à espera de uma chamada…',
  'call.newCourse': 'vem aí um percurso novo…',
  'call.oops': 'UPS! ↺',

  // ---- a perseguição ----
  'chase.caught': '🚓 LADRÃO APANHADO!',
  'chase.runs': 'ESTÁ A FUGIR — VAI ATRÁS DELE!',
  'chase.light': 'MANTÉM O CARRO NA TUA LUZ!',
  'chase.flyAfter': 'VOA ATRÁS DO CARRO DOS LADRÕES!',
  'chase.behind': 'FICA MESMO ATRÁS DELE!',
  'chase.catch': 'APANHA O CARRO DOS LADRÕES!',

  // ---- percursos ----
  'course.gates': 'PASSA PELOS ARCOS!',
  'course.rings': 'VOA PELOS ANÉIS!',
  'course.buoys': 'NAVEGA ENTRE AS BOIAS!',
  'course.gatesDone': '🏁 PATRULHA FEITA!',
  'course.ringsDone': '⭕ TODOS OS ANÉIS!',
  'course.buoysDone': '🚩 PERCURSO FEITO!',

  // ---- o comboio ----
  'train.aboard': 'TODOS A BORDO! {people}',
  'train.board': 'PARA NA PLACA AMARELA!',
  'train.slow': 'DEVAGAR…',
  'train.station': 'VAI ATÉ À ESTAÇÃO',
  'train.stop': '🚉 PARAGEM NA ESTAÇÃO!',

  // ---- a corrida ----
  'race.go': 'JÁ!',
  'race.lastLap': '🏁 ÚLTIMA VOLTA!',
  'race.lapN': 'VOLTA {n}!',
  'race.badge': 'VOLTA {lap}/{laps} · {place}',
  'race.wonRace': '🏆 GANHASTE A CORRIDA!',
  'race.placeRace': '🏁 {place} LUGAR — GRANDE CORRIDA!',
  'race.won': '🏆 GANHASTE!',
  'race.place': '🏁 {place} LUGAR!',

  // ---- as cenas das missões ----
  'scene.wellDone': 'MUITO BEM!',
  'scene.caught': '🚓 APANHADO!',
  'scene.spray': 'DEITA ÁGUA NO FOGO!',
  'scene.holdStill': 'NÃO MEXAS…',
  'scene.ladderCat': 'LEVA A ESCADA ATÉ AO GATINHO!',
  'scene.ladderOops': 'UPS! SEGURA A ESCADA QUIETA!',
  'scene.ladderPeople': 'LEVA A ESCADA ATÉ ÀS PESSOAS!',
  'scene.stretcher': 'LEVA A MACA PARA A AMBULÂNCIA!',
  'scene.tryAgain': 'UPS! TENTA OUTRA VEZ!',
  'scene.winchOver': 'PÕE-TE POR CIMA DA PESSOA!',
  'scene.winchLower': 'A DESCER…',
  'scene.winchLift': 'A SUBIR… AGUENTA FIRME!',

  // ---- os dioramas ----
  'diorama.firetruck': 'Camião dos Bombeiros — Salvamento na Cidade',
  'diorama.helicopter': 'Helicóptero de Salvamento',
  'diorama.train': 'A Pequena Linha de Comboio',
  'diorama.hud': '{name} · semente {seed} · {cam}  ·  chamadas de desenho {calls}  ·  triângulos {tris}',
  'diorama.name.firetruck': 'camião dos bombeiros',
  'diorama.name.helicopter': 'helicóptero de salvamento',
  'diorama.name.train': 'pequena linha de comboio',
};
