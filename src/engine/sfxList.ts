// The game's recorded sound effects (G11): one list, read by the recorder
// (tools/make-sfx.py — ElevenLabs' sound generation, from these prompts,
// into public/audio/sfx/<id>.mp3, only what's new or changed) and by the
// game (engine/audio.ts), which plays a recording where there is one and
// its own synthesized sound where there isn't.

export interface SfxDef {
  /** what to ask for (English works best) */
  prompt: string;
  /** its length (s) — ElevenLabs charges per second */
  seconds: number;
  /** a seamless loop (engines, sirens, ambience), or a one-shot */
  loop: boolean;
  /** a two-tone siren built rather than generated (tools/siren.py): its low
   * and high tone (Hz), each tone's length (s) and the cycles in the loop —
   * ElevenLabs' sirens came out as irregular warbles that never looped */
  tones?: { lo: number; hi: number; tone: number; cycles: number };
  /** an engine that must hold one note (a race car's): the recorder measures
   * every take and records again until one does — a generated engine now and
   * then changes gear, revs or passes by, and looped every 5 s that sounded
   * broken */
  steady?: boolean;
}

export const SFX = {
  // the kid's vehicles (loops; the game changes their speed with the vehicle's)
  'engine-car': { prompt: 'modern car engine running smoothly at a steady cruising speed, even and healthy hum, no revving, no rattle, no sputter, seamless loop', seconds: 6, loop: true },
  'engine-truck': { prompt: 'big fire truck diesel engine rumbling steadily at low revs, heard from outside, seamless loop', seconds: 4, loop: true },
  'engine-kart': { prompt: 'small racing kart engine buzzing steadily at medium revs, bright and zippy, seamless loop', seconds: 4, loop: true },
  'engine-heli': { prompt: 'helicopter rotor blades chopping steadily, medium distance, cartoonish but realistic, seamless loop', seconds: 4, loop: true },
  'engine-plane': { prompt: 'small single propeller airplane flying steadily, propeller buzz, seamless loop', seconds: 4, loop: true },
  'engine-boat': { prompt: 'small motor boat outboard engine putt-putt with water splashing along the hull, seamless loop', seconds: 4, loop: true },
  'engine-train': { prompt: 'electric passenger train rolling on rails, gentle clickety-clack of the wheels over rail joints, steady, seamless loop', seconds: 4, loop: true },
  // the race cars: each its own engine (the kid's, and the rivals' from where
  // they are) — raceCars.ts names the one each car plays
  'race-f1': { prompt: 'Formula 1 race car engine at high revs, high-pitched screaming V10 whine, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-future': { prompt: 'futuristic electric race car, smooth sci-fi turbine whine with a soft electric hum, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-kartPurple': { prompt: 'small go-kart two-stroke engine buzzing brightly at medium revs, zippy, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-kartPink': { prompt: 'cute little go-kart engine with a bubbly four-stroke putter, happy and light, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-kartYellow': { prompt: 'electric go-kart, a light whirring electric motor with a gentle whine, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-kartGreen': { prompt: 'go-kart engine with a raspy lawnmower-like buzz at medium revs, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-kartBrown': { prompt: 'go-kart with a deeper chunky single-cylinder engine thump at medium revs, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-racer': { prompt: 'sporty race car engine, smooth confident growl at medium-high revs, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-speedster': { prompt: 'fast sports car engine, a sharp raspy high-revving roar, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-racerLow': { prompt: 'low sleek race car, a deep smooth burbling engine at high speed, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-vintage': { prompt: '1950s vintage race car engine, a rattly old-fashioned straight-six drone, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-drag': { prompt: 'drag racing car waiting on the start line, a huge loud supercharged V8 burbling at a steady fast idle, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  'race-monster': { prompt: 'monster truck, a big deep V8 rumbling at a steady fast idle, held at one constant engine speed and pitch, no gear changes, no revving up or down, no pass-by, no doppler, heard from a fixed spot just behind the car, seamless loop', seconds: 5, loop: true, steady: true },
  // sirens (loops, built — tools/siren.py)
  'siren-fire': { prompt: 'fire truck two-tone hi-lo siren (built: tools/siren.py)', seconds: 4.8, loop: true, tones: { lo: 435, hi: 580, tone: 0.6, cycles: 4 } },
  'siren-ambulance': { prompt: 'ambulance two-tone hi-lo siren (built: tools/siren.py)', seconds: 4.5, loop: true, tones: { lo: 520, hi: 695, tone: 0.45, cycles: 5 } },
  'siren-police': { prompt: 'police two-tone hi-lo siren (built: tools/siren.py)', seconds: 4.2, loop: true, tones: { lo: 600, hi: 800, tone: 0.3, cycles: 7 } },
  // the fire hose, a level crossing, the world around (loops)
  'pump': { prompt: 'fire hose spraying a strong jet of water, steady hiss and splash, seamless loop', seconds: 4, loop: true },
  // (a level crossing's bell: ONE strike, which the game rings at a steady
  // pace — a recorded ringing never looped cleanly)
  'crossing-ding': { prompt: 'a single strike of a railway level crossing warning bell, one clear bright ding with a short ring, nothing else', seconds: 1, loop: false },
  'amb-birds': { prompt: 'gentle daytime birdsong in a city park, a few small birds chirping, calm, seamless loop', seconds: 8, loop: true },
  'amb-crickets': { prompt: 'soft crickets chirping on a warm summer night, calm, seamless loop', seconds: 8, loop: true },
  'amb-waves': { prompt: 'gentle sea waves lapping on a sandy beach, calm and soft, seamless loop', seconds: 8, loop: true },
  // the game's moments (one-shots)
  'win-jingle': { prompt: 'cheerful short victory jingle for a kids video game, bright xylophone and bells, happy, triumphant', seconds: 2, loop: false },
  'star': { prompt: 'magical sparkly twinkle chime, a star collected in a kids video game, bright and short', seconds: 1.5, loop: false },
  'ding': { prompt: 'single clear bright bell ding, checkpoint passed in a kids video game, short', seconds: 1, loop: false },
  'beep': { prompt: 'single short race countdown beep, retro game style, clean tone', seconds: 0.5, loop: false },
  'beep-go': { prompt: 'single higher-pitched longer race start beep for GO, retro game style, clean tone', seconds: 0.8, loop: false },
  'lap': { prompt: 'short happy two-note ascending chime, a lap completed in a racing game', seconds: 1, loop: false },
  'boing': { prompt: 'cartoon boing bump sound, a soft funny bounce, for a kids game', seconds: 1, loop: false },
  'thud': { prompt: 'soft muffled bump thud, a toy car gently bumping into something', seconds: 0.6, loop: false },
  'station-bell': { prompt: 'railway station arrival chime, three pleasant bell tones ding dong ding', seconds: 2, loop: false },
  'door-chime': { prompt: 'train doors opening chime, two soft descending notes, then a gentle pneumatic hiss', seconds: 1.5, loop: false },
  'train-horn': { prompt: 'friendly passenger train horn, two-tone, short toot toot', seconds: 2, loop: false },
  'car-horn': { prompt: 'small car horn, a short polite double beep beep', seconds: 1, loop: false },
  'splash': { prompt: 'car driving through a shallow river, a big water splash', seconds: 1, loop: false },
  // the mission scenes (G4): their moments (one-shots) and what keeps going (loops)
  'sizzle': { prompt: 'water from a hose hitting a fire, a quick hissing sizzle of steam, short', seconds: 1.2, loop: false },
  'meow': { prompt: 'a cute little cat meowing once, friendly and small', seconds: 1, loop: false },
  'crowd-cheer': { prompt: 'a small crowd of people cheering and clapping happily, short, friendly', seconds: 2.5, loop: false },
  'heart': { prompt: 'a soft bubbly pop, picking up a collectible heart in a kids video game, cute and short', seconds: 0.6, loop: false },
  'dog-bark': { prompt: 'a small friendly dog barking twice, woof woof', seconds: 1, loop: false },
  'cuffs': { prompt: 'metal handcuffs clicking shut, two quick clicks', seconds: 0.8, loop: false },
  'pigeons': { prompt: 'a few pigeons flapping their wings and flying off together', seconds: 1.5, loop: false },
  'fire-crackle': { prompt: 'a fire crackling and roaring softly, wood popping, steady, seamless loop', seconds: 5, loop: true },
  'ladder-whir': { prompt: 'hydraulic motor of a fire truck aerial ladder extending, steady mechanical whir and hum, seamless loop', seconds: 4, loop: true },
  'winch': { prompt: 'electric rescue winch on a helicopter reeling a cable, steady whirring motor hum, seamless loop', seconds: 4, loop: true },
  'footsteps': { prompt: 'a few people running on a pavement, quick steady footsteps, seamless loop', seconds: 4, loop: true },
  // the pirates (G15): the battle, the dig, and the pirate ship's own creak
  'cannon': { prompt: 'a cartoon pirate ship cannon firing, one deep friendly boom with a puff, short', seconds: 1.5, loop: false },
  'wood-hit': { prompt: 'a cannonball thudding into a wooden ship, a hollow wooden crack and a creak, cartoon, short', seconds: 1.2, loop: false },
  'coins': { prompt: 'a treasure chest full of gold coins jingling and clinking, cheerful, short', seconds: 1.5, loop: false },
  'dig': { prompt: 'a shovel digging into soft sand once, a scoop and a toss, short', seconds: 0.8, loop: false },
  'parrot': { prompt: 'a cheerful cartoon parrot squawking twice, friendly, short', seconds: 1, loop: false },
  // the work trucks and the deliveries (G16, G17)
  'ramp-clank': { prompt: 'two heavy steel loading ramps dropping onto a road from a tow truck, a metallic clank and a clunk, short', seconds: 1.2, loop: false },
  'strap-click': { prompt: 'a ratchet tie-down strap being tightened, three quick ratchet clicks and a buckle snap, short', seconds: 1, loop: false },
  'bin-tip': { prompt: 'a wheelie bin tipped into a garbage truck, bags and bottles and cans tumbling and rattling in, cartoon, short', seconds: 1.5, loop: false },
  'bin-set': { prompt: 'an empty plastic wheelie bin set down on a pavement, a hollow plastic thunk, short', seconds: 0.6, loop: false },
  'truck-dump': { prompt: 'a garbage truck tipping its whole load out at a recycling depot, a long rumbling cascade of trash, bottles and cans, short', seconds: 2.5, loop: false },
  'train-doors': { prompt: 'electric train sliding doors, a short pneumatic hiss and the doors sliding with a soft thud at the end, short', seconds: 1.5, loop: false },
  'jail-door': { prompt: 'a heavy barred jail door sliding shut with a clang and a lock clicking, cartoon, short', seconds: 1.2, loop: false },
  'ship-creak': { prompt: 'a wooden sailing ship at sea creaking gently, ropes and timber, soft waves against the hull, steady, no voices, seamless loop', seconds: 6, loop: true },
} satisfies Record<string, SfxDef>;

export type SfxId = keyof typeof SFX;
